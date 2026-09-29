/**
 * La base de contactos (7.06): quién le escribió a cada bot de la campaña, qué datos dio y qué consultó.
 *
 * Lo que consultó sale de los eventos de analítica, que no tienen textos y no vencen (decisión del 29/9: el texto de los
 * mensajes se borra a los días de guardado del bot; lo que consultó queda como temas, consultas y opciones):
 *  - el tema y la intención que interpretó el motor (evento `interpretado`);
 *  - las opciones de menú que eligió (evento `opcion_elegida`: la caja y la letra).
 *
 * El mismo cálculo corre en la demo (`consultasDeEventos`) y en la base (`bots.consultas_contacto`, migración
 * bots_0009_contactos.sql); `pnpm db:probar` controla que den lo mismo sobre los mismos eventos.
 *
 * Cada bot tiene su base: un contacto es de un bot y no se mezcla con los de otro (decisión del 29/9).
 */
import { opcionesDe, ubicar, type Definicion } from './definicion';

export const TIPOS_CONSULTA = ['tema', 'intencion', 'opcion'] as const;
export type TipoConsulta = (typeof TIPOS_CONSULTA)[number];

export const ETIQUETA_TIPO_CONSULTA: Record<TipoConsulta, string> = { tema: 'Tema', intencion: 'Consulta', opcion: 'Eligió' };

/** No cuentan como consulta: saludos y agradecimientos, lo que no se entiende, lo ajeno a la campaña y los intentos de manipular al bot. */
export const INTENCIONES_SIN_CONSULTA: readonly string[] = ['cortesia', 'no_entendible', 'fuera_de_tema', 'intento_manipulacion'];
/** "ninguno": el mensaje no habla de un tema de agenda. */
export const TEMAS_SIN_CONSULTA: readonly string[] = ['ninguno'];

export interface ConsultaContacto {
  tipo: TipoConsulta;
  /** El id del tema o de la intención, o "caja|letra" de la opción. */
  clave: string;
  veces: number;
  /** La última vez (ISO, UTC). */
  ultima: string;
}

/** Un evento de analítica de alguna conversación del contacto (lo que hace falta para sus consultas). */
export interface EventoDeContacto {
  nombre: string;
  cajaId: string | null;
  datos: Record<string, unknown>;
  fecha: string;
}

const textoDe = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x : null);

/** Orden: las más repetidas primero; a igual cantidad, la más reciente; después tipo y clave (orden de código, como `collate "C"`). */
export function ordenConsultas(a: ConsultaContacto, b: ConsultaContacto): number {
  if (a.veces !== b.veces) return b.veces - a.veces;
  const ta = new Date(a.ultima).getTime();
  const tb = new Date(b.ultima).getTime();
  if (ta !== tb) return tb - ta;
  if (a.tipo !== b.tipo) return a.tipo < b.tipo ? -1 : 1;
  return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0;
}

/** Lo que consultó un contacto, a partir de los eventos de sus conversaciones. */
export function consultasDeEventos(eventos: readonly EventoDeContacto[]): ConsultaContacto[] {
  const m = new Map<string, ConsultaContacto>();
  const sumar = (tipo: TipoConsulta, clave: string, fecha: string) => {
    const k = `${tipo}:${clave}`;
    const x = m.get(k);
    if (!x) m.set(k, { tipo, clave, veces: 1, ultima: fecha });
    else {
      x.veces += 1;
      if (new Date(fecha).getTime() > new Date(x.ultima).getTime()) x.ultima = fecha;
    }
  };
  for (const e of eventos) {
    if (e.nombre === 'interpretado') {
      const i = textoDe(e.datos.intencion);
      if (i && !INTENCIONES_SIN_CONSULTA.includes(i)) sumar('intencion', i, e.fecha);
      const t = textoDe(e.datos.tema);
      if (t && !TEMAS_SIN_CONSULTA.includes(t)) sumar('tema', t, e.fecha);
    } else if (e.nombre === 'opcion_elegida' && e.cajaId) {
      const l = textoDe(e.datos.letra);
      if (l) sumar('opcion', `${e.cajaId}|${l}`, e.fecha);
    }
  }
  return [...m.values()].sort(ordenConsultas);
}

// ── Filtro por consulta (la dirección de la pantalla) ──────────────────────────────────────────

/** "tema:agua", "intencion:propuesta" u "opcion:n_menu|A". */
export function claveConsulta(c: Pick<ConsultaContacto, 'tipo' | 'clave'>): string {
  return `${c.tipo}:${c.clave}`;
}

export function leerClaveConsulta(x: string | null | undefined): Pick<ConsultaContacto, 'tipo' | 'clave'> | null {
  const m = /^(tema|intencion|opcion):(.{1,60})$/.exec((x ?? '').trim());
  if (!m) return null;
  const tipo = m[1] as TipoConsulta;
  const clave = m[2]!;
  if (tipo === 'opcion' ? !/^n_[a-z0-9]{4,12}\|[A-Z]{1,2}$/.test(clave) : !/^[a-z][a-z0-9_]{1,39}$/.test(clave)) return null;
  return { tipo, clave };
}

/** El nombre que ve el equipo: el del tema o la intención en la definición del bot, o "Caja › Opción". */
export function etiquetaConsulta(def: Definicion | null, c: Pick<ConsultaContacto, 'tipo' | 'clave'>): string {
  if (c.tipo === 'tema') return def?.temas.find((t) => t.id === c.clave)?.nombre ?? c.clave;
  if (c.tipo === 'intencion') return def?.intenciones.find((i) => i.id === c.clave)?.nombre ?? c.clave;
  const [cajaId = '', letra = ''] = c.clave.split('|');
  const u = def ? ubicar(def, cajaId) : null;
  const o = u ? opcionesDe(u.caja).find((x) => x.letra === letra) : undefined;
  return u && o ? `${u.caja.nombre} › ${o.texto}` : `Opción ${letra} (${cajaId})`;
}

// ── Número y exportación ────────────────────────────────────────────────────────────────────────

/** El número guardado (solo dígitos, con el código de país) como se marca: "+50761234567". */
export function numeroInternacional(telefono: string | null | undefined): string {
  const d = (telefono ?? '').replace(/\D/g, '');
  return d ? `+${d}` : '';
}

/**
 * Una celda de CSV. Lo que escribió una persona puede empezar con =, +, -, @ o un tabulador: una planilla lo tomaría como
 * fórmula (inyección de fórmulas). Esas celdas llevan un apóstrofo adelante, que la planilla muestra como texto. Un
 * número de teléfono con + y solo dígitos no es una fórmula que haga algo: va tal cual.
 */
export function celdaCsv(v: string | number | null | undefined): string {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^\+\d{4,15}$/.test(t)) t = `'${t}`;
  return /[",\r\n;]/.test(t) || t !== t.trim() ? `"${t.replace(/"/g, '""')}"` : t;
}

/** "2026-09-29 14:05" (UTC), que las planillas leen como fecha. */
export function fechaCsv(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
}

export interface FilaCsvContacto {
  id: string;
  bot: string;
  canal: string;
  nombre: string;
  nombrePerfil: string;
  numero: string;
  /** Los datos que dio, sin el prefijo "contacto." (zona, correo…). */
  datos: Record<string, string>;
  primera: string | null;
  ultima: string | null;
  conversaciones: number;
  temas: string[];
  consultas: string[];
  opciones: string[];
  condiciones: number | null;
  condicionesAceptadas: string | null;
}

/**
 * La base de contactos en CSV (UTF-8 con BOM, para que Excel lea las tildes; fin de línea CRLF). Cada dato que dio la
 * gente es una columna ("Dato: zona"). Horas en UTC.
 */
export function csvBaseContactos(filas: readonly FilaCsvContacto[]): string {
  const datos = [...new Set(filas.flatMap((f) => Object.keys(f.datos)))].sort();
  const titulos = [
    'Bot', 'Canal', 'Nombre', 'Nombre de perfil de WhatsApp', 'Número', ...datos.map((d) => `Dato: ${d}`),
    'Primera conversación (UTC)', 'Última conversación (UTC)', 'Conversaciones', 'Temas', 'Consultas', 'Opciones que eligió',
    'Condiciones (versión)', 'Condiciones aceptadas (UTC)', 'Id del contacto',
  ];
  const lineas = [titulos, ...filas.map((f) => [
    f.bot, f.canal, f.nombre, f.nombrePerfil, f.numero, ...datos.map((d) => f.datos[d] ?? ''),
    fechaCsv(f.primera), fechaCsv(f.ultima), String(f.conversaciones), f.temas.join(' · '), f.consultas.join(' · '), f.opciones.join(' · '),
    f.condiciones === null ? '' : String(f.condiciones), fechaCsv(f.condicionesAceptadas), f.id,
  ])];
  return `﻿${lineas.map((l) => l.map(celdaCsv).join(',')).join('\r\n')}\r\n`;
}
