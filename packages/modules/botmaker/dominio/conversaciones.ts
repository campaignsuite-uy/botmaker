/**
 * Conversaciones (etapas 5 y 6): contactos, conversaciones, mensajes y eventos de analítica, y las reglas que no
 * dependen de la base: límites del canal web, cuándo empieza otra conversación, qué evento sale de cada paso del motor
 * (sin textos de personas), qué respuestas entran en la revisión por muestreo y las condiciones por defecto.
 *
 * Espejo de las tablas bots.contacts, bots.sessions, bots.messages, bots.events y bots.terms
 * (packages/db/migraciones/bots_0006_canal_web.sql).
 */
import type { Decision, Evento, Sesion } from './motor';
import { mercado } from './mercados';
import type { Trato } from './tipos';

/** web: el widget pegado en un sitio. landing: la página propia del bot. whatsapp: etapa 7. */
export const CANALES = ['web', 'landing', 'whatsapp'] as const;
export type Canal = (typeof CANALES)[number];

export const ETIQUETA_CANAL: Record<Canal, string> = { web: 'Widget', landing: 'Página del bot', whatsapp: 'WhatsApp' };

/**
 * bot: la atiende el bot. derivada: el bot la pasó al equipo y espera a alguien. en_atencion: una persona del equipo la
 * tomó (el bot no contesta). cerrada: terminó (la próxima vez que escriba, empieza otra).
 */
export const ESTADOS_CONVERSACION = ['bot', 'derivada', 'en_atencion', 'cerrada'] as const;
export type EstadoConversacion = (typeof ESTADOS_CONVERSACION)[number];

export const ETIQUETA_ESTADO_CONVERSACION: Record<EstadoConversacion, string> = {
  bot: 'La atiende el bot',
  derivada: 'Derivada: espera al equipo',
  en_atencion: 'En atención',
  cerrada: 'Cerrada',
};

export interface Contacto {
  id: string;
  botId: string;
  campanaId: string;
  canal: Canal;
  /** HMAC del id del canal (el token del navegador o el teléfono): lo que va a la analítica. */
  hash: string;
  /** El nombre, si lo dio en una caja "pedir dato". */
  nombre: string | null;
  /** Las variables del contacto que dio (contacto.correo…). */
  datos: Record<string, string>;
  condicionesVersion: number | null;
  condicionesAceptadasEn: string | null;
  /** Última verificación anti-robots que pasó (vale LIMITES_WEB.horasVerificacion). */
  verificadoEn: string | null;
  creadoEn: string;
  /** Se borraron sus datos a pedido (queda el registro sin datos). */
  borradoEn: string | null;
}

export interface Conversacion {
  id: string;
  botId: string;
  campanaId: string;
  contactoId: string;
  canal: Canal;
  /** La versión que contestó el último turno (al publicar otra, la conversación sigue con la nueva). */
  versionId: string | null;
  estado: EstadoConversacion;
  /** El estado del motor (dominio/motor.ts): qué espera, variables y últimos turnos. */
  sesion: Sesion;
  cajaActual: string | null;
  asignadaA: string | null;
  derivadaEn: string | null;
  motivoDerivacion: string | null;
  /** La caja de derivación (para devolver al bot por su salida "al volver"). */
  cajaDerivacion: string | null;
  ultimoDelContacto: string | null;
  ultimoDelEquipo: string | null;
  /** Pasó la verificación anti-robots al empezar (o no estaba configurada). Si no, solo menús. */
  verificada: boolean;
  /** Cantidad de mensajes: cada turno guarda con el que vio, así dos turnos a la vez no se pisan. */
  seq: number;
  iniciadaEn: string;
  actualizadaEn: string;
}

export type AutorMensaje = 'contacto' | 'bot' | 'agente' | 'sistema';

export interface Mensaje {
  conversacionId: string;
  /** Orden dentro de la conversación (1, 2, 3…). */
  n: number;
  autor: AutorMensaje;
  personaId: string | null;
  tipo: 'texto' | 'opcion' | 'inicio';
  /** null: se borró por vencimiento o a pedido. */
  texto: string | null;
  /** Botones o lista del mensaje, o la opción que tocó la persona. null si se borró. */
  datos: { opciones?: { letra: string; texto: string; descripcion?: string }[]; modo?: 'botones' | 'lista'; opcionesDe?: string; letra?: string; enlace?: string } | null;
  cajaId: string | null;
  /** Por qué contestó lo que contestó (el primer mensaje del bot de cada turno la lleva). */
  decision: Decision | null;
  versionId: string | null;
  /** Id que manda el canal (el navegador, 360dialog): un reintento no se duplica. */
  idCanal: string | null;
  /** Entra en la revisión por muestreo (respuestas con base). */
  muestra: boolean;
  creadoEn: string;
}

export interface Condiciones {
  botId: string;
  numero: number;
  texto: string;
  publicadasEn: string;
  publicadasPor: string | null;
}

/** aviso: seguir la conversación es aceptar (el primer mensaje enlaza las condiciones). acepto: un botón antes de empezar. */
export const MODOS_CONDICIONES = ['aviso', 'acepto'] as const;
export type ModoCondiciones = (typeof MODOS_CONDICIONES)[number];

// ── Eventos de analítica (sin textos de personas) ───────────────────────────────────────────────

export const NOMBRES_EVENTO = [
  'sesion_iniciada', 'caja_mostrada', 'opcion_elegida', 'texto_recibido', 'interpretado', 'respondido_con_base', 'valoracion',
  'derivada', 'estado_mensaje', 'llamada_motor', 'regla', 'aclaracion', 'sin_motor', 'boton_viejo', 'dato_guardado', 'dato_invalido',
  'baja', 'tope_pasos', 'tramite_electoral', 'dato_cortado', 'solo_menus', 'condiciones_aceptadas',
] as const;
export type NombreEvento = (typeof NOMBRES_EVENTO)[number];

export interface EventoAnalitica {
  nombre: NombreEvento;
  cajaId: string | null;
  datos: Record<string, string | number | boolean | null | string[]>;
}

/** Qué datos puede llevar cada evento del motor: nada que escribió la persona. */
const DATOS_PERMITIDOS: Partial<Record<Evento['nombre'], string[]>> = {
  opcion: ['letra', 'aclaracion'],
  boton_viejo: ['letra'],
  interpretado: ['intencion', 'tema', 'lectura'],
  respuesta: ['secciones', 'completa'],
  sin_dato: ['secciones'],
  derivada: ['motivo'],
  regla: ['regla', 'intencion'],
  aclaracion: ['opciones'],
  dato_guardado: ['variable', 'dato'],
  dato_invalido: ['variable', 'dato', 'intentos'],
  dato_cortado: ['cortes'],
};

const RENOMBRE: Partial<Record<Evento['nombre'], NombreEvento>> = {
  conversacion_iniciada: 'sesion_iniciada', caja: 'caja_mostrada', opcion: 'opcion_elegida', respuesta: 'respondido_con_base', sin_dato: 'respondido_con_base',
};

function limpiar(nombre: Evento['nombre'], datos: Record<string, unknown> | undefined): EventoAnalitica['datos'] {
  const r: EventoAnalitica['datos'] = {};
  for (const k of DATOS_PERMITIDOS[nombre] ?? []) {
    const v = datos?.[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) r[k] = v.filter((x) => typeof x === 'string').map((x) => String(x).slice(0, 40)).slice(0, 20);
    else if (typeof v === 'string') r[k] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) r[k] = v;
  }
  return r;
}

/**
 * Los eventos de analítica de un turno: los del motor, renombrados como en la definición y sin textos, más el texto
 * recibido (solo su largo) y el modo solo menús si hizo falta.
 */
export function eventosDeTurno(t: { entrada: { tipo: string; texto?: string }; eventos: readonly Evento[]; decision: Decision; soloMenus: boolean }): EventoAnalitica[] {
  const r: EventoAnalitica[] = [];
  if (t.entrada.tipo === 'texto') r.push({ nombre: 'texto_recibido', cajaId: null, datos: { largo: t.entrada.texto?.length ?? 0, tipo: 'texto' } });
  if (t.soloMenus) r.push({ nombre: 'solo_menus', cajaId: null, datos: {} });
  for (const e of t.eventos) {
    if (e.nombre === 'mensaje_en_derivada') continue;
    const nombre = RENOMBRE[e.nombre] ?? ((NOMBRES_EVENTO as readonly string[]).includes(e.nombre) ? (e.nombre as NombreEvento) : null);
    if (!nombre) continue;
    const datos = limpiar(e.nombre, e.datos);
    if (e.nombre === 'respuesta' || e.nombre === 'sin_dato') {
      datos.paso_validador = !t.decision.corte?.length;
      if (t.decision.secciones) datos.secciones = t.decision.secciones.slice(0, 20);
      if (t.decision.motor) datos.motor = t.decision.motor;
    }
    if (e.nombre === 'interpretado') {
      if (t.decision.intencion) datos.intencion = t.decision.intencion;
      if (t.decision.tema) datos.tema = t.decision.tema;
      if (t.decision.motor) datos.motor = t.decision.motor;
    }
    r.push({ nombre, cajaId: e.cajaId ?? null, datos });
  }
  return r;
}

// ── Canal web: límites y protección ─────────────────────────────────────────────────────────────

/**
 * Límites del canal web. Pasarse de uno de "solo menús" no corta la conversación: el bot sigue, sin llamar a ningún
 * motor. El límite duro (por IP y hora) sí corta, para que nadie llene la base.
 */
export const LIMITES_WEB = {
  ipPorMinuto: 20,
  ipPorDia: 300,
  conversacionPorMinuto: 12,
  conversacionPorDia: 150,
  botPorDia: 5000,
  duroIpPorHora: 1200,
  /** Sin mensajes durante este tiempo, la conversación que atendía el bot termina y la próxima empieza otra. */
  minutosSesion: 30,
  /** Cuánto vale una verificación anti-robots del contacto. */
  horasVerificacion: 24,
} as const;

/**
 * El horario de atención mientras no se configure por bot: de lunes a viernes, de 9 a 18, en la hora de la campaña.
 * Lo usan las cajas de condición "horario" en vivo (en el simulador se elige a mano).
 */
export function dentroDeHorarioPorDefecto(ahora: Date, zonaHoraria: string): boolean {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria || 'UTC', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(ahora);
  const dia = partes.find((x) => x.type === 'weekday')?.value ?? 'Mon';
  const hora = Number(partes.find((x) => x.type === 'hour')?.value ?? '12');
  return !['Sat', 'Sun'].includes(dia) && hora >= 9 && hora < 18;
}

export interface ClaveLimite {
  clave: string;
  ventanaSegundos: number;
  maximo: number;
  duro: boolean;
}

/** Las claves de conteo de un mensaje (ventanas fijas: el conteo se reinicia al empezar cada ventana). */
export function clavesLimite(p: { ipHash: string; contactoHash: string; botId: string }): ClaveLimite[] {
  return [
    { clave: `ip:${p.ipHash}:m`, ventanaSegundos: 60, maximo: LIMITES_WEB.ipPorMinuto, duro: false },
    { clave: `ip:${p.ipHash}:d`, ventanaSegundos: 86400, maximo: LIMITES_WEB.ipPorDia, duro: false },
    { clave: `ct:${p.contactoHash}:m`, ventanaSegundos: 60, maximo: LIMITES_WEB.conversacionPorMinuto, duro: false },
    { clave: `ct:${p.contactoHash}:d`, ventanaSegundos: 86400, maximo: LIMITES_WEB.conversacionPorDia, duro: false },
    { clave: `bot:${p.botId}:d`, ventanaSegundos: 86400, maximo: LIMITES_WEB.botPorDia, duro: false },
    { clave: `ip:${p.ipHash}:h`, ventanaSegundos: 3600, maximo: LIMITES_WEB.duroIpPorHora, duro: true },
  ];
}

/** El inicio de la ventana fija de un conteo (UTC). */
export function inicioVentana(ahora: Date, ventanaSegundos: number): string {
  const ms = ventanaSegundos * 1000;
  return new Date(Math.floor(ahora.getTime() / ms) * ms).toISOString();
}

export function evaluarLimites(claves: readonly ClaveLimite[], conteos: readonly number[]): { cortar: boolean; soloMenus: boolean; motivo: string | null } {
  let soloMenus = false;
  let motivo: string | null = null;
  for (const [i, c] of claves.entries()) {
    const n = conteos[i] ?? 0;
    if (n <= c.maximo) continue;
    if (c.duro) return { cortar: true, soloMenus: true, motivo: c.clave.split(':')[0]! };
    soloMenus = true;
    motivo ??= c.clave.startsWith('bot:') ? 'bot' : c.clave.startsWith('ct:') ? 'conversacion' : 'ip';
  }
  return { cortar: false, soloMenus, motivo };
}

// ── Revisión por muestreo ───────────────────────────────────────────────────────────────────────

/** Toda respuesta con base de la primera semana de publicado el bot; después, el 20 %. */
export const MUESTREO = { diasTodas: 7, porcentaje: 20 } as const;

/** ¿Entra en la muestra? `sorteo` entre 0 y 1 (en la base sale del id del mensaje: siempre igual para el mismo). */
export function entraEnMuestra(publicadoDesde: string | null, ahora: Date, sorteo: number): boolean {
  if (publicadoDesde && ahora.getTime() - new Date(publicadoDesde).getTime() < MUESTREO.diasTodas * 864e5) return true;
  return sorteo * 100 < MUESTREO.porcentaje;
}

// ── Alertas ─────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_ALERTA = ['derivada_sin_respuesta', 'tope_alcanzado', 'canal_desconectado'] as const;
export type TipoAlerta = (typeof TIPOS_ALERTA)[number];

export const ETIQUETA_ALERTA: Record<TipoAlerta, string> = {
  derivada_sin_respuesta: 'Derivada sin respuesta',
  tope_alcanzado: 'Tope de gasto alcanzado',
  canal_desconectado: 'Canal desconectado',
};

/** Una derivada sin respuesta del equipo durante este tiempo abre una alerta (la definición: 2 horas por defecto). */
export const MINUTOS_ALERTA_DERIVADA = 120;

export interface Alerta {
  id: string;
  tipo: TipoAlerta;
  botId: string;
  campanaId: string;
  /** La conversación (derivada) o el día (tope). */
  ref: string;
  abiertaEn: string;
  cerradaEn: string | null;
}

// ── Pedidos sobre los datos de un contacto ──────────────────────────────────────────────────────

export const TIPOS_PEDIDO_DATOS = ['buscar', 'exportar', 'borrar'] as const;
export type TipoPedidoDatos = (typeof TIPOS_PEDIDO_DATOS)[number];

export interface PedidoDatos {
  id: string;
  campanaId: string;
  contactoId: string;
  tipo: TipoPedidoDatos;
  nota: string;
  hechoPor: string | null;
  hechoEn: string;
}

// ── Condiciones por defecto ─────────────────────────────────────────────────────────────────────

/**
 * Un texto de partida para las condiciones de un bot, para que el administrador lo adapte. No es asesoramiento legal:
 * cada campaña lo revisa con quien corresponda (la definición: es parte del alta, un documento, no software).
 */
export function condicionesPorDefecto(p: { mercado: string; candidato: string; trato: Trato; dias: number }): string {
  const pais = mercado(p.mercado)?.nombre ?? p.mercado;
  const usted = p.trato === 'usted';
  return [
    `Este asistente es de la campaña de ${p.candidato} (${pais}). Es un programa con inteligencia artificial: puede equivocarse, y lo que dice sale del material que cargó la campaña.`,
    `Qué guardamos: los mensajes de esta conversación y los datos que ${usted ? 'usted decida' : 'decidas'} dar (por ejemplo, un nombre o un correo). Los textos se borran a los ${p.dias} días; lo que queda después son números sin datos personales.`,
    `Para qué: para responder, para que alguien del equipo ${usted ? 'le' : 'te'} conteste si ${usted ? 'lo pide' : 'lo pedís'}, y para mejorar el asistente. No se venden ni se ceden a terceros.`,
    `${usted ? 'Puede' : 'Podés'} pedir ver o borrar ${usted ? 'sus' : 'tus'} datos escribiendo al contacto de la campaña.`,
    `Seguir la conversación es aceptar estas condiciones.`,
  ].join('\n\n');
}

/** El aviso de IA del primer mensaje, si el bot no tiene uno propio. */
export function avisoIaPorDefecto(trato: Trato): string {
  return trato === 'usted'
    ? 'Está conversando con un asistente virtual con inteligencia artificial: puede equivocarse.'
    : 'Estás conversando con un asistente virtual con inteligencia artificial: puede equivocarse.';
}
