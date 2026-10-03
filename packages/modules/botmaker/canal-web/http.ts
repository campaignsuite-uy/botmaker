/**
 * Las rutas de la app pública como funciones de Request → Response (sin Next): conversar, pedir lo nuevo, el script del
 * widget y las tareas de fondo. Las montan apps/bots-publico y, en la demo, la app del equipo en /publico.
 */
import { obtenerRepositorioPublico } from '../datos/publico';
import { capaMotores } from '../motores';
import { ejecutarTareas } from '../acciones/ejecutar-bandeja';
import { atenderMensaje, consultarMensajes, datosWidget, type RespuestaWeb } from './nucleo';
import { hashConClave, ipDe, turnstileConfigurado, verificarTurnstile } from './servidor';
import { scriptWidget } from './widget';
import { tareasWhatsapp } from '../canal-whatsapp/nucleo';
import { entornoWhatsapp } from '../canal-whatsapp/servidor';
import { prepararSimulado } from '../canal-whatsapp/http';

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

/**
 * Los datos del botón del widget (nombre, iniciales y saludo) para el sitio de la campaña: los pide el script desde otro
 * dominio, así que van con CORS abierto. Es lo mismo que muestra la página pública del bot, sin nada de quien la visita.
 */
export async function manejarDatosWidget(req: Request): Promise<Response> {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const bot = new URL(req.url).searchParams.get('bot') ?? '';
  try {
    const d = await datosWidget(obtenerRepositorioPublico(), bot);
    if (!d) return Response.json({ ok: false }, { status: 404, headers: { ...cors, 'Cache-Control': 'public, max-age=60' } });
    return Response.json({ ok: true, ...d }, { headers: { ...cors, 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    console.error('[bots-publico] widget', e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500, headers: { ...cors, ...SIN_CACHE } });
  }
}

export function manejarWidget(base: string): Response {
  return new Response(scriptWidget(base), { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

/**
 * Tareas de fondo (alertas, borrado por vencimiento y WhatsApp: lo atascado, los reintentos y las plantillas). Las llama
 * un cron con la clave BOTS_TAREAS_SECRET en el encabezado Authorization: Bearer … (el cron de Vercel manda CRON_SECRET
 * así; pg_cron con pg_net, cada minuto). Sin clave configurada, no corre.
 */
export async function manejarTareas(req: Request, base = ''): Promise<Response> {
  const clave = process.env.BOTS_TAREAS_SECRET || process.env.CRON_SECRET;
  if (!clave || req.headers.get('authorization') !== `Bearer ${clave}`) return new Response('No autorizado.', { status: 401 });
  const repo = obtenerRepositorioPublico();
  const r = await ejecutarTareas(repo, new Date());
  // WhatsApp: lo que quedó sin procesar, los reintentos de envío y el estado de las plantillas.
  prepararSimulado(base);
  const whatsapp = await tareasWhatsapp(repo, entornoWhatsapp(repo, base));
  return Response.json({ ...r, whatsapp }, { headers: SIN_CACHE });
}
