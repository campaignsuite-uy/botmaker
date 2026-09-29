/**
 * Validador del flujo (tarea 2.08): lo que se revisa antes de poder pedir publicar. No impide guardar el borrador (la
 * capa de operaciones ya rechaza lo que lo rompe: destinos que no existen, ids repetidos); marca lo que no se puede
 * publicar (errores) y lo que conviene mirar (avisos), cada cosa con su caja para mostrarla en el diagrama.
 *
 * Errores: referencias rotas, límites de canal (3 botones de 20 caracteres, listas de 10 opciones de 24), intenciones
 * sin destino, una respuesta con base que se queda muda sin el dato, un inicio que espera en silencio, ciclos sin
 * espera (el motor corta a los 25 pasos) y condiciones sin ninguna salida.
 * Avisos: cajas a las que no se llega, opciones que terminan sin responder, contenidos sin uso, variables del bot sin
 * valor, intenciones sin frases, un pedido de dato que termina en silencio si falla, cajas que no se probaron en el
 * simulador (si se pasan las probadas) y las condiciones de los motores para este caso.
 */
import { avisosMotores } from './avisos';
import {
  buscarDireccion, contenidosDe, LIMITES, opcionesDe, problemasDeReferencias, salidasDe, ubicar, type Caja, type Definicion,
} from './definicion';
import type { FichaMotor } from './motores';
import type { Bot, MotorFuncion } from './tipos';

export interface Hallazgo {
  nivel: 'error' | 'aviso';
  codigo: string;
  mensaje: string;
  /** Dirección ("3.4 › B") o parte ("intención propuesta"). */
  donde: string;
  /** La caja donde se marca en el diagrama, si es de una caja. */
  cajaId?: string;
  letra?: string;
}

export interface ContextoRevision {
  bot?: Pick<Bot, 'caso' | 'personalizacion'>;
  motores?: readonly MotorFuncion[];
  fichas?: readonly FichaMotor[];
  /** Las cajas que pasaron por el simulador con este borrador. Sin esto no se avisa "sin probar". */
  probadas?: ReadonlySet<string>;
}

export interface Revision {
  errores: Hallazgo[];
  avisos: Hallazgo[];
  /** Hallazgos por caja, para marcar el diagrama. */
  porCaja: Map<string, Hallazgo[]>;
}

/** Las cajas que siguen solas, sin esperar a la persona: un ciclo entre ellas no termina nunca. */
function siguenSolas(c: Caja): (string | null)[] {
  if (c.tipo === 'mensaje' && !c.opciones.length) return [c.siguiente];
  if (c.tipo === 'condicion') return [...c.casos.map((k) => k.destino), c.sino];
  if (c.tipo === 'ir_a_flujo') return [c.caja];
  return [];
}

export function revisarBot(def: Definicion, ctx: ContextoRevision = {}): Revision {
  const hallazgos: Hallazgo[] = [];
  const dir = (cajaId: string, letra?: string) => {
    const u = ubicar(def, cajaId);
    return u ? `${u.flujo.codigo}.${u.caja.codigo}${letra ? ` › ${letra}` : ''}` : cajaId;
  };
  const error = (codigo: string, mensaje: string, donde: string, cajaId?: string, letra?: string) =>
    hallazgos.push({ nivel: 'error', codigo, mensaje, donde, ...(cajaId ? { cajaId } : {}), ...(letra ? { letra } : {}) });
  const aviso = (codigo: string, mensaje: string, donde: string, cajaId?: string, letra?: string) =>
    hallazgos.push({ nivel: 'aviso', codigo, mensaje, donde, ...(cajaId ? { cajaId } : {}), ...(letra ? { letra } : {}) });

  // Referencias (normalmente ya las frena la capa de operaciones; un YAML o una versión vieja pueden traerlas).
  for (const p of problemasDeReferencias(def)) {
    const b = buscarDireccion(def, p.donde);
    error(p.codigo, p.mensaje, p.donde, b?.cajaId, b?.letra);
  }

  const cajas = def.flujos.flatMap((f) => f.cajas);
  const usados = new Set<string>(Object.values(def.sistema));

  for (const c of cajas) {
    const d = dir(c.id);
    for (const x of contenidosDe(c)) usados.add(x);
    const opciones = opcionesDe(c);
    const sonBotones = c.tipo === 'mensaje' || (c.tipo === 'menu' && c.modo === 'botones');
    if (sonBotones && opciones.length > LIMITES.botones) {
      error('botones_de_mas', `${d} tiene ${opciones.length} botones: WhatsApp admite ${LIMITES.botones}. Pasalo a lista o quitá opciones.`, d, c.id);
    }
    for (const o of opciones) {
      const tope = sonBotones ? LIMITES.textoBoton : LIMITES.textoOpcionLista;
      if (o.texto.length > tope) {
        error('texto_opcion_largo', `El texto de ${dir(c.id, o.letra)} tiene ${o.texto.length} caracteres: ${sonBotones ? 'un botón' : 'una opción de lista'} admite ${tope}.`, dir(c.id, o.letra), c.id, o.letra);
      }
      if (o.destino === null) {
        aviso('opcion_sin_destino', `La opción ${dir(c.id, o.letra)} ("${o.texto}") termina la conversación sin responder nada.`, dir(c.id, o.letra), c.id, o.letra);
      }
    }
    if (c.tipo === 'respuesta_base' && c.sinDato === null) {
      error('sin_dato_mudo', `Si ${d} no encuentra el dato en el material, el bot no dice nada: elegí adónde sigue "Sin dato".`, d, c.id);
    }
    if (c.tipo === 'condicion' && c.sino === null && c.casos.every((k) => k.destino === null)) {
      error('condicion_sin_salida', `${d} no tiene ninguna salida: la conversación se queda sin respuesta.`, d, c.id);
    }
    if (c.tipo === 'pedir_dato' && c.siFalla === null) {
      aviso('dato_sin_salida', `Si la persona no da el dato en ${d}, el bot deja de responder: elegí adónde sigue "No lo dio".`, d, c.id);
    }
  }

  // El inicio no puede quedarse esperando sin decir nada.
  const inicio = ubicar(def, def.inicio)?.caja;
  if (inicio && (inicio.tipo === 'interpretar' || (inicio.tipo === 'respuesta_base' && !inicio.pregunta))) {
    error('inicio_mudo', `La conversación empieza en ${dir(inicio.id)}, que espera un texto sin decir nada. Empezá con un mensaje o un menú.`, dir(inicio.id), inicio.id);
  }
  const libre = ubicar(def, def.textoLibre)?.caja;
  if (libre && libre.tipo !== 'interpretar' && libre.tipo !== 'respuesta_base' && libre.tipo !== 'menu') {
    aviso('texto_libre', `Los textos libres van a ${dir(libre.id)}, que no interpreta ni responde: lo que escriba la persona no se va a entender.`, dir(libre.id), libre.id);
  }

  // Intenciones.
  for (const i of def.intenciones) {
    if (i.destino === null) error('intencion_sin_destino', `La intención "${i.nombre}" no tiene destino: elegí adónde lleva.`, `intención ${i.id}`);
    if (!i.frases.length) aviso('intencion_sin_frases', `La intención "${i.nombre}" no tiene frases de ejemplo: el motor la reconoce peor.`, `intención ${i.id}`);
  }

  // Ciclos entre cajas que siguen solas.
  const enCiclo = new Set<string>();
  for (const c of cajas) {
    const visto = new Set<string>();
    let pila: string[] = siguenSolas(c).filter((x): x is string => !!x);
    while (pila.length) {
      const id = pila.pop()!;
      if (id === c.id) {
        enCiclo.add(c.id);
        break;
      }
      if (visto.has(id)) continue;
      visto.add(id);
      const u = ubicar(def, id);
      if (u) pila = pila.concat(siguenSolas(u.caja).filter((x): x is string => !!x));
    }
  }
  for (const id of enCiclo) error('ciclo', `${dir(id)} vuelve a sí misma sin esperar a la persona: la conversación se cortaría.`, dir(id), id);

  // Cajas a las que no se llega.
  const alcanzables = new Set<string>();
  const pendientes = [def.inicio, def.textoLibre, ...def.intenciones.map((i) => i.destino)].filter((x): x is string => !!x);
  while (pendientes.length) {
    const id = pendientes.pop()!;
    if (alcanzables.has(id)) continue;
    alcanzables.add(id);
    const u = ubicar(def, id);
    if (u) for (const s of salidasDe(u.caja)) if (s.destino) pendientes.push(s.destino);
  }
  for (const c of cajas) {
    if (!alcanzables.has(c.id)) aviso('inalcanzable', `A ${dir(c.id)} no se llega desde el inicio, los menús ni las intenciones.`, dir(c.id), c.id);
    else if (ctx.probadas && !ctx.probadas.has(c.id)) aviso('sin_probar', `${dir(c.id)} todavía no pasó por el simulador.`, dir(c.id), c.id);
  }

  // Contenidos y variables.
  for (const c of def.contenidos) if (!usados.has(c.id)) aviso('contenido_sin_uso', `El contenido "${c.nombre}" no lo usa ninguna caja.`, `contenido ${c.nombre}`);
  const enTextos = new Set(def.contenidos.flatMap((c) => [...c.texto.matchAll(/\{\{\s*([a-z.0-9_]+)\s*\}\}/g)].map((m) => m[1]!)));
  for (const v of def.variables) {
    if (v.nombre.startsWith('bot.') && !(v.valor ?? '').trim() && enTextos.has(v.nombre)) {
      aviso('variable_sin_valor', `La variable ${v.nombre} no tiene valor y se usa en los textos: el bot la va a dejar en blanco.`, v.nombre);
    }
  }

  // Condiciones de los motores para este caso (avisar, no bloquear).
  if (ctx.bot && ctx.motores) {
    for (const a of avisosMotores(ctx.bot, ctx.motores, ctx.fichas)) if (a.nivel === 'atencion') aviso('motor', a.texto, 'motores');
  }

  const porCaja = new Map<string, Hallazgo[]>();
  for (const h of hallazgos) if (h.cajaId) porCaja.set(h.cajaId, [...(porCaja.get(h.cajaId) ?? []), h]);
  return { errores: hallazgos.filter((h) => h.nivel === 'error'), avisos: hallazgos.filter((h) => h.nivel === 'aviso'), porCaja };
}
