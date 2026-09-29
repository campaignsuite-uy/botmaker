/**
 * Errores del servidor a Sentry (8.03), sin el SDK: un cliente mínimo que arma el evento y lo manda al endpoint de
 * sobres (envelope) del proyecto con el DSN. Sin dependencias ni cambios en el armado de las apps; si más adelante hacen
 * falta los errores del navegador, se pasa al SDK oficial.
 *
 * - Sin SENTRY_DSN no hace nada (así queda hasta que haya cuenta: tarea 8.02).
 * - No manda cuerpos de pedidos, ni la dirección con sus parámetros, ni encabezados, ni cookies. El mensaje del error
 *   pasa por `limpiarTexto`, que tapa correos, números, claves y valores de la base: un error puede traer lo que
 *   escribió una persona.
 * - Hasta 30 errores por minuto por proceso: un error que se repite en cada pedido no llena la cuenta.
 * - Lo engancha `onRequestError` de instrumentation.ts en las dos apps. Anda en Node y en Edge (solo fetch y crypto).
 */

export interface DsnSentry {
  dsn: string;
  clave: string;
  proyecto: string;
  /** https://o1.ingest.sentry.io/api/123/envelope/ */
  endpoint: string;
}

/** El DSN tiene la forma https://<clave pública>@<host>/<proyecto> (a veces con un camino antes del proyecto). */
export function leerDsn(dsn: string | undefined | null): DsnSentry | null {
  const t = (dsn ?? '').trim();
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  const partes = u.pathname.split('/').filter(Boolean);
  const proyecto = partes.pop();
  if (!/^https?:$/.test(u.protocol) || !u.username || !proyecto || !/^\d+$/.test(proyecto)) return null;
  const prefijo = partes.length ? `/${partes.join('/')}` : '';
  return { dsn: t, clave: decodeURIComponent(u.username), proyecto, endpoint: `${u.protocol}//${u.host}${prefijo}/api/${proyecto}/envelope/` };
}

/** Tapa lo que puede ser de una persona o una clave. Corta a `max` caracteres. */
export function limpiarTexto(t: string, max = 300): string {
  return t
    .replace(/Bearer\s+\S+/gi, 'Bearer [clave]')
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1?[…]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/\(([^()]{1,60})\)=\([^()]*\)/g, '($1)=([…])')
    .replace(/\b(?:sk|pk|rk|eyJ)[\w-]{10,}/g, '[clave]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[clave]')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '[número]')
    .slice(0, max);
}

export interface MarcoPila {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** Los marcos de la pila de un error de V8, del más viejo al más nuevo (como los pide Sentry). */
export function marcosDePila(pila: string | undefined, raiz = ''): MarcoPila[] {
  const marcos: MarcoPila[] = [];
  for (const linea of (pila ?? '').split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(linea);
    if (!m) continue;
    let archivo = m[2]!.replace(/^file:\/\//, '');
    if (raiz && archivo.startsWith(raiz)) archivo = archivo.slice(raiz.length).replace(/^\/+/, '');
    marcos.push({
      ...(m[1] ? { function: m[1].slice(0, 120) } : {}), filename: archivo.slice(0, 200), lineno: Number(m[3]), colno: Number(m[4]),
      in_app: !archivo.includes('node_modules') && !archivo.startsWith('node:'),
    });
  }
  return marcos.slice(0, 40).reverse();
}

export interface ContextoError {
  /** equipo: apps/web. publica: apps/bots-publico. */
  app: 'equipo' | 'publica';
  /** La ruta de Next ("/[org]/[campana]/bots/bandeja"), nunca la dirección con sus valores. */
  ruta?: string;
  metodo?: string;
  /** render, route, action, middleware… */
  tipo?: string;
}

export interface EventoSentry {
  event_id: string;
  timestamp: string;
  platform: 'node';
  level: 'error';
  logger: 'botmaker';
  environment: string;
  release?: string;
  transaction?: string;
  tags: Record<string, string>;
  exception: { values: { type: string; value: string; stacktrace?: { frames: MarcoPila[] } }[] };
}

/** El evento de un error: tipo, mensaje limpio, pila y dónde pasó. Nada del pedido ni de la persona. */
export function eventoDeError(err: unknown, ctx: ContextoError, o: { id: string; ahora: Date; entorno: string; version?: string; raiz?: string }): EventoSentry {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Error sin detalle');
  const digest = (err as { digest?: unknown } | null)?.digest;
  const marcos = marcosDePila(e.stack, o.raiz);
  const tags: Record<string, string> = { app: ctx.app };
  if (ctx.ruta) tags.ruta = limpiarTexto(ctx.ruta.split('?')[0]!, 200);
  if (ctx.metodo) tags.metodo = ctx.metodo.slice(0, 10).toUpperCase();
  if (ctx.tipo) tags.tipo = ctx.tipo.slice(0, 40);
  if (typeof digest === 'string') tags.digest = digest.slice(0, 64);
  return {
    event_id: o.id, timestamp: o.ahora.toISOString(), platform: 'node', level: 'error', logger: 'botmaker', environment: o.entorno.slice(0, 64),
    ...(o.version ? { release: o.version.slice(0, 64) } : {}), ...(tags.ruta ? { transaction: tags.ruta } : {}), tags,
    exception: { values: [{ type: (e.name || 'Error').slice(0, 80), value: limpiarTexto(e.message || 'Error sin detalle'), ...(marcos.length ? { stacktrace: { frames: marcos } } : {}) }] },
  };
}

/** El sobre (envelope) que recibe Sentry: encabezado, encabezado del ítem y el evento, una línea cada uno. */
export function sobreSentry(evento: EventoSentry, dsn: DsnSentry, enviadoEn: Date): string {
  return [
    JSON.stringify({ event_id: evento.event_id, sent_at: enviadoEn.toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(evento),
  ].join('\n');
}

export const MAX_POR_MINUTO = 30;
const enviados: number[] = [];

export interface DependenciasSentry {
  entorno: Record<string, string | undefined>;
  fetch: typeof fetch;
  ahora: () => Date;
}

/**
 * Manda el error a Sentry si hay SENTRY_DSN. Devuelve si lo mandó. Nunca tira: un problema con Sentry no puede romper
 * el pedido que ya falló.
 */
export async function reportarError(err: unknown, ctx: ContextoError, deps?: Partial<DependenciasSentry>): Promise<boolean> {
  const d: DependenciasSentry = { entorno: process.env, fetch: globalThis.fetch, ahora: () => new Date(), ...deps };
  const dsn = leerDsn(d.entorno.SENTRY_DSN);
  if (!dsn) return false;
  const ahora = d.ahora();
  while (enviados.length && enviados[0]! < ahora.getTime() - 60_000) enviados.shift();
  if (enviados.length >= MAX_POR_MINUTO) return false;
  enviados.push(ahora.getTime());
  try {
    const evento = eventoDeError(err, ctx, {
      id: globalThis.crypto.randomUUID().replace(/-/g, ''), ahora,
      entorno: d.entorno.SENTRY_ENVIRONMENT || d.entorno.VERCEL_ENV || d.entorno.NODE_ENV || 'desarrollo',
      version: d.entorno.VERCEL_GIT_COMMIT_SHA, raiz: typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '',
    });
    const r = await d.fetch(dsn.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=botmaker-minimo/1.0, sentry_key=${dsn.clave}`,
      },
      body: sobreSentry(evento, dsn, ahora),
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Solo para pruebas: vacía el conteo por minuto. */
export function reiniciarLimite(): void {
  enviados.length = 0;
}
