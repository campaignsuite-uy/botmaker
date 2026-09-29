/**
 * Motor de conversación: decide qué contesta el bot en cada turno. Es el mismo en el simulador, la web y WhatsApp;
 * cada canal traduce su entrada y su salida (botones, listas, límites).
 *
 *   turno(definición, sesión, entrada, servicios) → mensajes a mandar, sesión nueva, eventos y la decisión.
 *
 * No toca la base ni la red: los motores de IA, el material y el reloj entran como `servicios`. Así se prueba con
 * guiones de conversación sin cuentas.
 *
 * Reglas de la definición (Definición de producto, "Motor de conversación"):
 *  - un botón viejo (de una opción que ya no existe, o de otra caja) se trata como texto libre;
 *  - si la caja donde esperaba ya no existe (se publicó otra versión), el texto va a interpretar;
 *  - hay un tope de pasos por turno (un ciclo entre cajas no cuelga la conversación);
 *  - sin motor de IA disponible (tope de gasto o fallas), el bot sigue con menús;
 *  - antes de interpretar, las reglas resuelven lo obvio (cortesía, baja, adjuntos) sin IA;
 *  - en doble lectura, si los dos motores eligen intenciones que llevan a lugares distintos, el bot pregunta.
 */
import type { EntradaInterpretar, EntradaResponder, Interpretacion, RespuestaConBase, SeccionMaterial, Turno } from '../motores/contratos';
import { MAX_TURNOS } from '../motores/contratos';
import { opcionesDe, ubicar, type Caja, type CajaDe, type Definicion } from './definicion';
import { reglaAntesDelMotor } from './reglas';

// ── Sesión, entrada y salida ────────────────────────────────────────────────────────────────────

export type Espera =
  | { tipo: 'opciones'; cajaId: string }
  | { tipo: 'dato'; cajaId: string; intentos: number }
  | { tipo: 'texto'; cajaId: string }
  | { tipo: 'aclaracion'; opciones: { letra: string; intencion: string }[]; texto: string };

export interface Sesion {
  /** Qué espera el bot de la persona (null: nada en particular; un texto va a la caja de texto libre). */
  espera: Espera | null;
  /** Las variables del contacto (contacto.nombre…). */
  variables: Record<string, string>;
  estado: 'bot' | 'derivada';
  /** Los últimos turnos, para dar contexto a los motores (sin datos de la base). */
  turnos: Turno[];
  iniciada: boolean;
}

export function sesionNueva(): Sesion {
  return { espera: null, variables: {}, estado: 'bot', turnos: [], iniciada: false };
}

/** Lo que manda la persona. `opcion` es un botón o una fila de lista: la caja y la letra, y el título que vio. */
export type Entrada =
  | { tipo: 'inicio' }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'opcion'; cajaId: string; letra: string; titulo: string };

/** Caja de las opciones de una aclaración (no es una caja de la definición). */
export const CAJA_ACLARACION = 'aclaracion';

export interface OpcionSalida {
  letra: string;
  texto: string;
  descripcion?: string;
}

export interface MensajeSalida {
  texto: string;
  /** La caja que lo mandó (null: un mensaje del sistema o una respuesta con base). */
  cajaId: string | null;
  opciones?: OpcionSalida[];
  modo?: 'botones' | 'lista';
  /** Las opciones son de esta caja (para armar el id de cada botón). */
  opcionesDe?: string;
}

export interface Evento {
  nombre:
    | 'conversacion_iniciada' | 'caja' | 'opcion' | 'boton_viejo' | 'regla' | 'interpretado' | 'aclaracion' | 'sin_motor'
    | 'respuesta' | 'sin_dato' | 'dato_guardado' | 'dato_invalido' | 'derivada' | 'baja' | 'tope_pasos' | 'mensaje_en_derivada';
  cajaId?: string;
  datos?: Record<string, unknown>;
}

/** Por qué contestó lo que contestó: queda en cada mensaje (bots.messages.decision) y se ve en el simulador. */
export interface Decision {
  recorrido: string[];
  regla?: string;
  intencion?: string;
  tema?: string;
  lectura?: { principal: string | null; respaldo: string | null; resultado: string } | null;
  motor?: string | null;
  secciones?: string[];
  costoUsd: number;
}

export interface ResultadoTurno {
  mensajes: MensajeSalida[];
  sesion: Sesion;
  eventos: Evento[];
  decision: Decision;
}

/** Lo que el motor necesita de afuera. En producción, la capa de motores; en las pruebas, funciones fijas. */
export interface Servicios {
  interpretar(e: EntradaInterpretar): Promise<{
    salida: Interpretacion | null;
    lectura: { principal: string | null; respaldo: string | null; resultado: 'coinciden' | 'distintas' | 'una' | 'ninguna' } | null;
    motorId: string | null;
    costoUsd: number;
  }>;
  responder(e: EntradaResponder): Promise<{ salida: RespuestaConBase | null; motorId: string | null; costoUsd: number }>;
  /** Las secciones del material para estos temas (vacío: todo). Etapa 3. */
  material(temas: string[]): SeccionMaterial[];
  /** ¿Está el equipo atendiendo? */
  dentroDeHorario(): boolean;
}

export const TOPE_PASOS = 25;

// ── Validación de datos pedidos ─────────────────────────────────────────────────────────────────

export function validarDato(dato: CajaDe<'pedir_dato'>['dato'], texto: string): string | null {
  const t = texto.trim();
  switch (dato) {
    case 'nombre': return /^[\p{L}][\p{L}' .-]{1,79}$/u.test(t) ? t.replace(/\s+/g, ' ') : null;
    case 'correo': return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(t) ? t.toLowerCase() : null;
    case 'telefono': {
      const d = t.replace(/[\s().-]/g, '');
      return /^\+?\d{7,15}$/.test(d) ? d : null;
    }
    case 'texto': return t.length >= 1 && t.length <= 500 ? t : null;
  }
}

// ── El turno ────────────────────────────────────────────────────────────────────────────────────

class Turnero {
  mensajes: MensajeSalida[] = [];
  eventos: Evento[] = [];
  decision: Decision = { recorrido: [], costoUsd: 0 };
  pasos = 0;
  /** El texto de la persona que todavía no se usó (interpretar y responder con base lo consumen). */
  pendiente: string | null = null;
  /** La conversación hasta el turno anterior: el contexto que reciben los motores. */
  previos: Turno[];

  constructor(readonly def: Definicion, readonly s: Sesion, readonly sv: Servicios) {
    this.previos = [...s.turnos];
  }

  // Textos con variables: {{bot.horario}} sale de la definición; {{contacto.nombre}}, de la sesión.
  rellenar(texto: string): string {
    const bot = new Map(this.def.variables.map((v) => [v.nombre, v.valor ?? '']));
    return texto
      .replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (_, n: string) => (n.startsWith('contacto.') ? this.s.variables[n] ?? '' : bot.get(n) ?? ''))
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/,([.!?])/g, '$1')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  contenido(id: string): string {
    const c = this.def.contenidos.find((x) => x.id === id);
    return c ? this.rellenar(c.texto) : '';
  }

  decir(texto: string, cajaId: string | null, extra: Partial<MensajeSalida> = {}) {
    if (!texto && !extra.opciones?.length) return;
    this.mensajes.push({ texto, cajaId, ...extra });
    this.s.turnos = [...this.s.turnos, { quien: 'bot' as const, texto }].slice(-MAX_TURNOS);
  }

  sistema(clave: keyof Definicion['sistema']) {
    this.decir(this.contenido(this.def.sistema[clave]), null);
  }

  /** Recorre desde una caja hasta que el bot tenga que esperar a la persona (o se termine el recorrido). */
  async recorrer(desde: string | null): Promise<void> {
    let id = desde;
    while (id) {
      if (++this.pasos > TOPE_PASOS) {
        this.eventos.push({ nombre: 'tope_pasos', cajaId: id });
        this.s.espera = null;
        return;
      }
      const u = ubicar(this.def, id);
      if (!u) {
        this.s.espera = null;
        return;
      }
      this.decision.recorrido.push(id);
      this.eventos.push({ nombre: 'caja', cajaId: id });
      id = await this.ejecutar(u.caja);
    }
  }

  /** Ejecuta una caja; devuelve la siguiente, o null si hay que esperar o terminó. */
  private async ejecutar(c: Caja): Promise<string | null> {
    switch (c.tipo) {
      case 'mensaje': {
        const opciones = c.opciones.map((o) => ({ letra: o.letra, texto: o.texto }));
        this.decir(this.contenido(c.contenido), c.id, opciones.length ? { opciones, modo: 'botones', opcionesDe: c.id } : {});
        if (c.accion === 'dar_de_baja') this.eventos.push({ nombre: 'baja', cajaId: c.id });
        if (opciones.length) {
          this.s.espera = { tipo: 'opciones', cajaId: c.id };
          return null;
        }
        this.s.espera = null;
        return c.siguiente;
      }
      case 'menu': {
        this.decir(this.contenido(c.contenido), c.id, {
          opciones: c.opciones.map((o) => ({ letra: o.letra, texto: o.texto, ...(o.descripcion ? { descripcion: o.descripcion } : {}) })),
          modo: c.modo,
          opcionesDe: c.id,
        });
        this.s.espera = { tipo: 'opciones', cajaId: c.id };
        return null;
      }
      case 'interpretar': {
        if (this.pendiente === null) {
          this.s.espera = { tipo: 'texto', cajaId: c.id };
          return null;
        }
        return this.interpretar(c, this.consumir()!);
      }
      case 'respuesta_base': {
        if (this.pendiente === null && !c.pregunta) {
          this.s.espera = { tipo: 'texto', cajaId: c.id };
          return null;
        }
        const pregunta = this.consumir() ?? this.rellenar(c.pregunta!);
        const r = await this.sv.responder({ pregunta, turnos: this.previos, material: this.sv.material(c.temas) });
        this.decision.costoUsd += r.costoUsd;
        this.decision.motor = r.motorId;
        if (r.salida && r.salida.tiene_respuesta !== 'no') {
          this.decision.secciones = r.salida.secciones;
          this.decir(r.salida.respuesta, null);
          this.eventos.push({ nombre: 'respuesta', cajaId: c.id, datos: { secciones: r.salida.secciones, completa: r.salida.tiene_respuesta === 'si' } });
          return c.conDato;
        }
        this.eventos.push({ nombre: r.salida ? 'sin_dato' : 'sin_motor', cajaId: c.id });
        return c.sinDato;
      }
      case 'pedir_dato': {
        this.decir(this.contenido(c.contenido), c.id);
        this.s.espera = { tipo: 'dato', cajaId: c.id, intentos: 0 };
        return null;
      }
      case 'condicion': {
        for (const k of c.casos) if (this.cumple(k.si)) return k.destino;
        return c.sino;
      }
      case 'derivacion': {
        this.decir(this.contenido(c.contenido), c.id);
        this.s.estado = 'derivada';
        this.s.espera = null;
        this.eventos.push({ nombre: 'derivada', cajaId: c.id, datos: { motivo: c.motivo } });
        return null;
      }
      case 'ir_a_flujo':
        return c.caja;
    }
  }

  private cumple(si: CajaDe<'condicion'>['casos'][number]['si']): boolean {
    if (si.tipo === 'horario') return this.sv.dentroDeHorario() === si.dentro;
    const v = si.variable.startsWith('contacto.') ? this.s.variables[si.variable] : this.def.variables.find((x) => x.nombre === si.variable)?.valor;
    const valor = (si.valor ?? '').trim().toLowerCase();
    const actual = (v ?? '').trim().toLowerCase();
    switch (si.operador) {
      case 'existe': return !!actual;
      case 'no_existe': return !actual;
      case 'igual': return actual === valor;
      case 'distinto': return actual !== valor;
      case 'contiene': return !!valor && actual.includes(valor);
    }
  }

  private consumir(): string | null {
    const t = this.pendiente;
    this.pendiente = null;
    return t;
  }

  /** Adónde lleva una intención desde esta caja de interpretar. */
  private destinoDe(c: CajaDe<'interpretar'>, intencion: string): string | null {
    if (intencion in c.rutas) return c.rutas[intencion] ?? null;
    return this.def.intenciones.find((i) => i.id === intencion)?.destino ?? null;
  }

  private async interpretar(c: CajaDe<'interpretar'>, texto: string): Promise<string | null> {
    const r = await this.sv.interpretar({
      mensaje: texto,
      turnos: this.previos,
      intenciones: this.def.intenciones.map((i) => ({ id: i.id, descripcion: i.descripcion, ...(i.limite ? { limite: i.limite } : {}), ejemplos: i.frases })),
      temas: this.def.temas.map((t) => ({ id: t.id, nombre: t.nombre })),
    });
    this.decision.costoUsd += r.costoUsd;
    this.decision.motor = r.motorId;
    this.decision.lectura = r.lectura;
    if (!r.salida) {
      this.eventos.push({ nombre: 'sin_motor', cajaId: c.id });
      this.sistema('sinMotor');
      return c.noEntendio;
    }
    const { intencion, tema } = r.salida;
    this.decision.intencion = intencion;
    this.decision.tema = tema;
    this.eventos.push({ nombre: 'interpretado', cajaId: c.id, datos: { intencion, tema, lectura: r.lectura?.resultado ?? null } });

    // Doble lectura sin acuerdo: si las dos intenciones llevan al mismo lugar, no hace falta preguntar.
    if (r.lectura?.resultado === 'distintas') {
      const otra = r.salida.alternativas[0]?.intencion;
      if (otra && this.destinoDe(c, otra) !== this.destinoDe(c, intencion)) {
        const nombre = (id: string) => this.def.intenciones.find((i) => i.id === id)?.nombre ?? id;
        const opciones = [{ letra: 'A', intencion }, { letra: 'B', intencion: otra }];
        const textos = opciones.map((o) => ({ letra: o.letra, texto: nombre(o.intencion) }));
        this.decir(this.contenido(this.def.sistema.aclaracion), null, {
          opciones: textos, modo: textos.some((t) => t.texto.length > 20) ? 'lista' : 'botones', opcionesDe: CAJA_ACLARACION,
        });
        this.s.espera = { tipo: 'aclaracion', opciones, texto };
        this.eventos.push({ nombre: 'aclaracion', cajaId: c.id, datos: { opciones: opciones.map((o) => o.intencion) } });
        return null;
      }
    }
    return this.seguirIntencion(c, intencion, texto);
  }

  private seguirIntencion(c: CajaDe<'interpretar'> | null, intencion: string, texto: string): string | null {
    const destino = c ? this.destinoDe(c, intencion) : this.def.intenciones.find((i) => i.id === intencion)?.destino ?? null;
    if (!destino) {
      this.sistema('noEntendi');
      return c?.noEntendio ?? null;
    }
    // El texto sigue pendiente: si la intención lleva a una respuesta con base, esa caja lo contesta.
    this.pendiente = texto;
    return destino;
  }

  /** Un texto de la persona, según lo que el bot estaba esperando. */
  async texto(texto: string): Promise<void> {
    const e = this.s.espera;
    // Si la caja donde esperaba ya no existe (otra versión publicada), el texto va a la caja de texto libre.
    const cajaEspera = e && e.tipo !== 'aclaracion' ? ubicar(this.def, e.cajaId)?.caja ?? null : null;
    if (e && e.tipo !== 'aclaracion' && !cajaEspera) this.s.espera = null;

    if (e?.tipo === 'dato' && cajaEspera?.tipo === 'pedir_dato') {
      const valor = validarDato(cajaEspera.dato, texto);
      if (valor !== null) {
        this.s.variables = { ...this.s.variables, [cajaEspera.variable]: valor };
        this.eventos.push({ nombre: 'dato_guardado', cajaId: cajaEspera.id, datos: { variable: cajaEspera.variable } });
        this.s.espera = null;
        return this.recorrer(cajaEspera.siguiente);
      }
      this.eventos.push({ nombre: 'dato_invalido', cajaId: cajaEspera.id });
      if (e.intentos < cajaEspera.reintentos) {
        this.sistema('noEntendi');
        this.decir(this.contenido(cajaEspera.contenido), cajaEspera.id);
        this.s.espera = { ...e, intentos: e.intentos + 1 };
        return;
      }
      this.s.espera = null;
      return this.recorrer(cajaEspera.siFalla);
    }

    // Reglas antes del motor: lo obvio, sin IA.
    const regla = reglaAntesDelMotor(texto);
    if (regla) {
      this.decision.regla = regla.regla;
      this.decision.intencion = regla.intencion;
      this.eventos.push({ nombre: 'regla', datos: { regla: regla.regla, intencion: regla.intencion } });
      this.s.espera = null;
      if (regla.intencion === 'cortesia' && regla.momento === 'cierre' && this.previos.length > 0) {
        this.sistema('cierre');
        return;
      }
      return this.recorrer(this.seguirIntencion(null, regla.intencion, texto));
    }

    // Un texto en vez de tocar una opción de menú: la salida de texto libre del menú (normalmente, interpretar).
    this.pendiente = texto;
    if ((e?.tipo === 'opciones' && cajaEspera?.tipo === 'menu') || (e?.tipo === 'texto' && cajaEspera)) {
      const destino = cajaEspera.tipo === 'menu' ? cajaEspera.textoLibre : cajaEspera.id;
      this.s.espera = null;
      return this.recorrer(destino ?? this.def.textoLibre);
    }
    this.s.espera = null;
    return this.recorrer(this.def.textoLibre);
  }

  /** Un botón o una fila de lista. */
  async opcion(cajaId: string, letra: string, titulo: string): Promise<void> {
    const e = this.s.espera;
    if (cajaId === CAJA_ACLARACION && e?.tipo === 'aclaracion') {
      const o = e.opciones.find((x) => x.letra === letra);
      if (o) {
        this.s.espera = null;
        this.decision.intencion = o.intencion;
        this.eventos.push({ nombre: 'opcion', datos: { aclaracion: o.intencion } });
        return this.recorrer(this.seguirIntencion(ubicar(this.def, this.def.textoLibre)?.caja.tipo === 'interpretar' ? ubicar(this.def, this.def.textoLibre)!.caja as CajaDe<'interpretar'> : null, o.intencion, e.texto));
      }
    }
    const caja = ubicar(this.def, cajaId)?.caja;
    const op = caja ? opcionesDe(caja).find((x) => x.letra === letra) : undefined;
    // Solo vale un botón de la caja donde el bot está esperando: uno viejo (de antes, u otra versión) es texto libre.
    if (!caja || !op || e?.tipo !== 'opciones' || e.cajaId !== cajaId) {
      this.eventos.push({ nombre: 'boton_viejo', cajaId, datos: { letra } });
      return this.texto(titulo);
    }
    this.eventos.push({ nombre: 'opcion', cajaId, datos: { letra } });
    this.s.espera = null;
    return this.recorrer(op.destino);
  }
}

/**
 * Un turno de la conversación. No cambia la sesión que recibe: devuelve una nueva.
 * Una conversación derivada a una persona no la contesta el bot hasta que el equipo la devuelva (etapa 6).
 */
export async function turno(def: Definicion, sesion: Sesion, entrada: Entrada, servicios: Servicios): Promise<ResultadoTurno> {
  const s: Sesion = structuredClone(sesion);
  const t = new Turnero(def, s, servicios);
  if (entrada.tipo !== 'inicio') {
    const texto = entrada.tipo === 'texto' ? entrada.texto : entrada.titulo;
    s.turnos = [...s.turnos, { quien: 'persona' as const, texto }].slice(-MAX_TURNOS);
  }
  if (s.estado === 'derivada') {
    t.eventos.push({ nombre: 'mensaje_en_derivada' });
    return { mensajes: [], sesion: s, eventos: t.eventos, decision: t.decision };
  }
  if (entrada.tipo === 'inicio' || !s.iniciada) {
    s.iniciada = true;
    t.eventos.push({ nombre: 'conversacion_iniciada' });
    if (entrada.tipo === 'inicio') {
      await t.recorrer(def.inicio);
      return { mensajes: t.mensajes, sesion: s, eventos: t.eventos, decision: t.decision };
    }
  }
  if (entrada.tipo === 'texto') await t.texto(entrada.texto);
  else if (entrada.tipo === 'opcion') await t.opcion(entrada.cajaId, entrada.letra, entrada.titulo);
  return { mensajes: t.mensajes, sesion: s, eventos: t.eventos, decision: t.decision };
}

/** Devolver al bot una conversación derivada (lo hace el equipo desde la bandeja): sigue en la caja alVolver. */
export async function devolverAlBot(def: Definicion, sesion: Sesion, derivacionId: string, servicios: Servicios): Promise<ResultadoTurno> {
  const s: Sesion = { ...structuredClone(sesion), estado: 'bot', espera: null };
  const t = new Turnero(def, s, servicios);
  const c = ubicar(def, derivacionId)?.caja;
  await t.recorrer(c?.tipo === 'derivacion' ? c.alVolver : null);
  return { mensajes: t.mensajes, sesion: s, eventos: t.eventos, decision: t.decision };
}
