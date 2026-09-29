/**
 * Analítica (8.01): qué pregunta la gente, por dónde pasa y dónde deja la conversación. Sale de los eventos del bot
 * (bots.events), que no tienen textos de personas.
 *
 * Dos pasos, con el mismo cálculo en la demo y en la base (bots_0010_analitica.sql); `pnpm db:probar` controla que den
 * lo mismo sobre los mismos eventos:
 *  1. Cada evento suma a una o más métricas (`metricasDeEvento`), agrupadas por bot, canal, versión y hora
 *     (`agregarPorHora` ↔ bots.stats_hourly, que llena la tarea bots.tarea_agregar_analitica).
 *  2. Cada conversación terminada (30 minutos sin movimiento) tiene un cierre (`cierreDeConversacion` ↔
 *     bots.session_outcomes): resuelta, derivada o sin resolver, la última caja que mostró el bot y el recorrido de sus
 *     primeras cajas. Si la conversación sigue después, el cierre se vuelve a calcular.
 *
 * Resuelta (decisión del 29/9): una respuesta con base completa sin derivar, una conversación que atendió una persona o
 * un cierre de cortesía (un «gracias» después de haber consultado algo).
 */
import type { Canal } from './conversaciones';

export const MINUTOS_FIN_CONVERSACION = 30;
/** Cuántas cajas entran en el recorrido de una conversación. */
export const CAJAS_RECORRIDO = 4;

export const METRICAS = [
  'conversacion', 'caja', 'opcion', 'texto', 'intencion', 'tema', 'respuesta', 'derivada', 'sin_motor', 'aclaracion', 'dato', 'solo_menus', 'baja',
  'tramite', 'condiciones',
] as const;
export type Metrica = (typeof METRICAS)[number];

export const RESULTADOS = ['resuelta', 'derivada', 'sin_resolver'] as const;
export type ResultadoConversacion = (typeof RESULTADOS)[number];

export const ETIQUETA_RESULTADO: Record<ResultadoConversacion, string> = { resuelta: 'Resueltas', derivada: 'Derivadas sin atender', sin_resolver: 'Sin resolver' };

export interface EventoParaAnalitica {
  nombre: string;
  cajaId: string | null;
  datos: Record<string, unknown>;
}

export interface MetricaDeEvento {
  metrica: Metrica;
  /** La caja ('' si no corresponde). */
  caja: string;
  /** La letra de la opción, la intención, el tema, cómo terminó la respuesta… ('' si no corresponde). */
  clave: string;
}

const textoDe = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x.slice(0, 80) : null);

/** A qué métricas suma un evento. Los que no están (estados de WhatsApp, llamadas…) no suman a ninguna. */
export function metricasDeEvento(e: EventoParaAnalitica): MetricaDeEvento[] {
  const caja = e.cajaId ? e.cajaId.slice(0, 40) : '';
  const m = (metrica: Metrica, c = '', clave = ''): MetricaDeEvento => ({ metrica, caja: c, clave });
  switch (e.nombre) {
    case 'sesion_iniciada': return [m('conversacion')];
    case 'caja_mostrada': return caja ? [m('caja', caja)] : [];
    case 'opcion_elegida': {
      const letra = textoDe(e.datos.letra);
      return caja && letra ? [m('opcion', caja, letra)] : [];
    }
    case 'texto_recibido': return [m('texto')];
    case 'interpretado': {
      const r: MetricaDeEvento[] = [];
      const i = textoDe(e.datos.intencion);
      if (i) r.push(m('intencion', '', i));
      const t = textoDe(e.datos.tema);
      if (t) r.push(m('tema', '', t));
      return r;
    }
    case 'regla': {
      const i = textoDe(e.datos.intencion);
      return i ? [m('intencion', '', i)] : [];
    }
    case 'respondido_con_base': return [m('respuesta', caja, e.datos.completa === true ? 'completa' : 'sin_dato')];
    case 'derivada': return [m('derivada', caja)];
    case 'sin_motor': return [m('sin_motor', caja)];
    case 'aclaracion': return [m('aclaracion', caja)];
    case 'dato_guardado': return [m('dato', caja, 'guardado')];
    case 'dato_invalido': return [m('dato', caja, 'invalido')];
    case 'solo_menus': return [m('solo_menus')];
    case 'baja': return [m('baja', caja)];
    case 'tramite_electoral': return [m('tramite', caja)];
    case 'condiciones_aceptadas': return [m('condiciones')];
    default: return [];
  }
}

// ── 1. Métricas por hora ────────────────────────────────────────────────────────────────────────

export interface EventoConContexto extends EventoParaAnalitica {
  botId: string;
  canal: Canal;
  versionId: string | null;
  /** ISO, UTC. */
  fecha: string;
}

export interface FilaHora {
  botId: string;
  canal: Canal;
  versionId: string | null;
  /** El comienzo de la hora, en UTC ("2026-09-29T14:00:00.000Z"). */
  hora: string;
  metrica: Metrica;
  caja: string;
  clave: string;
  n: number;
}

export function horaDe(fecha: string): string {
  const d = new Date(fecha);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Orden de código (como `collate "C"`): bot, canal, versión, hora, métrica, caja, clave. */
export function ordenFilasHora(a: FilaHora, b: FilaHora): number {
  return comparar(a.botId, b.botId) || comparar(a.canal, b.canal) || comparar(a.versionId ?? '', b.versionId ?? '') || comparar(a.hora, b.hora)
    || comparar(a.metrica, b.metrica) || comparar(a.caja, b.caja) || comparar(a.clave, b.clave);
}

/** Lo que la tarea de fondo suma a bots.stats_hourly por estos eventos. */
export function agregarPorHora(eventos: readonly EventoConContexto[]): FilaHora[] {
  const filas = new Map<string, FilaHora>();
  for (const e of eventos) {
    const hora = horaDe(e.fecha);
    for (const x of metricasDeEvento(e)) {
      const k = [e.botId, e.canal, e.versionId ?? '', hora, x.metrica, x.caja, x.clave].join('\u0000');
      const f = filas.get(k);
      if (f) f.n += 1;
      else filas.set(k, { botId: e.botId, canal: e.canal, versionId: e.versionId, hora, ...x, n: 1 });
    }
  }
  return [...filas.values()].sort(ordenFilasHora);
}

// ── 2. El cierre de cada conversación ───────────────────────────────────────────────────────────

export interface CierreConversacion {
  resultado: ResultadoConversacion;
  /** La última caja que mostró el bot ('' si ninguna). */
  ultimaCaja: string;
  /** Las primeras cajas que mostró, sin repetir seguidas, separadas por ">". */
  recorrido: string;
}

const INTERACCIONES = new Set(['interpretado', 'opcion_elegida', 'respondido_con_base']);

/** ¿Terminó? 30 minutos sin movimiento (ni de la persona, ni del bot, ni del equipo). */
export function conversacionTerminada(ultimaActividad: string, ahora: Date): boolean {
  return new Date(ultimaActividad).getTime() <= ahora.getTime() - MINUTOS_FIN_CONVERSACION * 60_000;
}

/** Cómo terminó una conversación, con sus eventos en orden y si alguien del equipo le escribió. */
export function cierreDeConversacion(eventos: readonly EventoParaAnalitica[], atendidaPorPersona: boolean): CierreConversacion {
  let derivada = false;
  let conBase = false;
  let cortesiaFinal = false;
  let interactuo = false;
  const cajas: string[] = [];
  for (const e of eventos) {
    if (e.nombre === 'derivada') derivada = true;
    if (e.nombre === 'respondido_con_base' && e.datos.completa === true) conBase = true;
    if (e.nombre === 'regla' && e.datos.regla === 'cortesia' && interactuo) cortesiaFinal = true;
    if (INTERACCIONES.has(e.nombre)) interactuo = true;
    if (e.nombre === 'caja_mostrada' && e.cajaId) cajas.push(e.cajaId.slice(0, 40));
  }
  const recorrido: string[] = [];
  for (const c of cajas) {
    if (recorrido.length >= CAJAS_RECORRIDO) break;
    if (recorrido.at(-1) !== c) recorrido.push(c);
  }
  const resuelta = atendidaPorPersona || (!derivada && (conBase || cortesiaFinal));
  return { resultado: resuelta ? 'resuelta' : derivada ? 'derivada' : 'sin_resolver', ultimaCaja: cajas.at(-1) ?? '', recorrido: recorrido.join('>') };
}

// ── Lo que se lee para la pantalla ──────────────────────────────────────────────────────────────

export interface FiltroAnalitica {
  botId?: string;
  canal?: Canal;
  versionId?: string;
  /** Desde (incluido) y hasta (sin incluir), ISO en UTC. */
  desde: string;
  hasta: string;
}

/** La analítica de un período: métricas sumadas, conversaciones por día, cierres y costo en vivo. */
export interface DatosAnalitica {
  metricas: { metrica: Metrica; caja: string; clave: string; n: number }[];
  /** Conversaciones que empezaron cada día (UTC, "2026-09-29"). */
  porDia: { dia: string; n: number }[];
  /** Conversaciones terminadas que empezaron en el período, por cierre. */
  conversaciones: { resultado: ResultadoConversacion; ultimaCaja: string; recorrido: string; n: number }[];
  /** Costo de los motores en vivo, por función y motor (solo para quien ve costos). */
  costos: { funcion: string; motor: string; usd: number; llamadas: number }[] | null;
  /** Hasta cuándo están sumados los eventos (null: al momento, como en la demo). */
  actualizadaEn: string | null;
}

export interface NumerosCaja {
  visitas: number;
  /** Conversaciones sin resolver que terminaron en esta caja. */
  abandonos: number;
  derivadas: number;
  /** Cuántas veces se eligió cada opción (por letra). */
  opciones: Record<string, number>;
}

export interface ResumenAnalitica {
  conversaciones: number;
  terminadas: number;
  resultados: Record<ResultadoConversacion, number>;
  derivadas: number;
  textos: number;
  noEntendidas: number;
  aclaraciones: number;
  soloMenus: number;
  respuestas: { completas: number; sinDato: number };
  intenciones: { clave: string; n: number }[];
  temas: { clave: string; n: number }[];
  recorridos: { recorrido: string; n: number }[];
  porCaja: Map<string, NumerosCaja>;
}

const ranking = (m: Map<string, number>) => [...m].map(([clave, n]) => ({ clave, n })).sort((a, b) => b.n - a.n || comparar(a.clave, b.clave));

export function resumirAnalitica(d: DatosAnalitica): ResumenAnalitica {
  const suma = (metrica: Metrica, clave?: string) => d.metricas.filter((x) => x.metrica === metrica && (clave === undefined || x.clave === clave)).reduce((s, x) => s + x.n, 0);
  const intenciones = new Map<string, number>();
  const temas = new Map<string, number>();
  const porCaja = new Map<string, NumerosCaja>();
  const caja = (id: string) => {
    let x = porCaja.get(id);
    if (!x) porCaja.set(id, (x = { visitas: 0, abandonos: 0, derivadas: 0, opciones: {} }));
    return x;
  };
  for (const x of d.metricas) {
    if (x.metrica === 'intencion') intenciones.set(x.clave, (intenciones.get(x.clave) ?? 0) + x.n);
    if (x.metrica === 'tema' && x.clave !== 'ninguno') temas.set(x.clave, (temas.get(x.clave) ?? 0) + x.n);
    if (x.metrica === 'caja' && x.caja) caja(x.caja).visitas += x.n;
    if (x.metrica === 'opcion' && x.caja) caja(x.caja).opciones[x.clave] = (caja(x.caja).opciones[x.clave] ?? 0) + x.n;
    if (x.metrica === 'derivada' && x.caja) caja(x.caja).derivadas += x.n;
  }
  const resultados: Record<ResultadoConversacion, number> = { resuelta: 0, derivada: 0, sin_resolver: 0 };
  const recorridos = new Map<string, number>();
  for (const c of d.conversaciones) {
    resultados[c.resultado] += c.n;
    if (c.resultado === 'sin_resolver' && c.ultimaCaja) caja(c.ultimaCaja).abandonos += c.n;
    if (c.recorrido) recorridos.set(c.recorrido, (recorridos.get(c.recorrido) ?? 0) + c.n);
  }
  return {
    conversaciones: suma('conversacion'),
    terminadas: resultados.resuelta + resultados.derivada + resultados.sin_resolver,
    resultados,
    derivadas: suma('derivada'),
    textos: suma('texto'),
    noEntendidas: suma('intencion', 'no_entendible') + suma('sin_motor'),
    aclaraciones: suma('aclaracion'),
    soloMenus: suma('solo_menus'),
    respuestas: { completas: suma('respuesta', 'completa'), sinDato: suma('respuesta', 'sin_dato') },
    intenciones: ranking(intenciones),
    temas: ranking(temas),
    recorridos: [...recorridos].map(([recorrido, n]) => ({ recorrido, n })).sort((a, b) => b.n - a.n || comparar(a.recorrido, b.recorrido)),
    porCaja,
  };
}

/** "12 %" (sin decimales; "—" si no hay base). */
export function porcentaje(n: number, total: number): string {
  return total > 0 ? `${Math.round((100 * n) / total)} %` : '—';
}
