/**
 * Las rutas de la app pública como funciones de Request → Response (sin Next): conversar, pedir lo nuevo, el script del
 * widget y las tareas de fondo. Las montan apps/bots-publico y, en la demo, la app del equipo en /publico.
 */
import { obtenerRepositorioPublico } from '../datos/publico';
import { capaMotores } from '../motores';
import { ejecutarTareas } from '../acciones/ejecutar-bandeja';
import { atenderMensaje, consultarMensajes, type RespuestaWeb } from './nucleo';
import { hashConClave, ipDe, turnstileConfigurado, verificarTurnstile } from './servidor';
import { scriptWidget } from './widget';

const SIN_CACHE = { 'Cache-Control': 'no-store' };

function json(r: RespuestaWeb): Response {
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: SIN_CACHE });
}

export async function manejarConversar(req: Request): Promise<Response> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return json({ ok: false, codigo: 'datos', status: 415 });
  const texto = await req.text();
  if (texto.length > 16_000) return json({ ok: false, codigo: 'datos', status: 413 });
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ ok: false, codigo: 'datos', status: 400 });
  }
  const repo = obtenerRepositorioPublico();
  try {
    return json(await atenderMensaje(repo, { ahora: () => new Date(), ip: ipDe(req.headers), hash: hashConClave(), verificar: verificarTurnstile, verificacionConfigurada: turnstileConfigurado(), capa: capaMotores(repo) }, cuerpo));
  } catch (e) {
    console.error('[bots-publico] conversar', e instanceof Error ? e.message : e);
    return json({ ok: false, codigo: 'no_se_pudo', status: 500 });
  }
}

export async function manejarMensajes(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const repo = obtenerRepositorioPublico();
  try {
    return json(await consultarMensajes(repo, { ahora: () => new Date(), ip: ipDe(req.headers), hash: hashConClave() }, Object.fromEntries(u.searchParams)));
  } catch (e) {
    console.error('[bots-publico] mensajes', e instanceof Error ? e.message : e);
    return json({ ok: false, codigo: 'no_se_pudo', status: 500 });
  }
}

export function manejarWidget(base: string): Response {
  return new Response(scriptWidget(base), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

/**
 * Tareas de fondo (alertas y borrado por vencimiento). Las llama un cron con la clave BOTS_TAREAS_SECRET en el encabezado
 * Authorization: Bearer … (el cron de Vercel manda CRON_SECRET así). Sin clave configurada, no corre.
 */
export async function manejarTareas(req: Request): Promise<Response> {
  const clave = process.env.BOTS_TAREAS_SECRET || process.env.CRON_SECRET;
  if (!clave || req.headers.get('authorization') !== `Bearer ${clave}`) return new Response('No autorizado.', { status: 401 });
  const r = await ejecutarTareas(obtenerRepositorioPublico(), new Date());
  return Response.json(r, { headers: SIN_CACHE });
}
