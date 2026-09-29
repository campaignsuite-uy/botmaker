/**
 * La prueba de cierre de Sentry (8.03): /api/probar-sentry tira un error a propósito para ver que llega. Pide la clave
 * de las tareas de fondo (BOTS_TAREAS_SECRET o CRON_SECRET), como /api/tareas. Sin SENTRY_DSN no tira nada: avisa que
 * Sentry está apagado.
 */
import { leerDsn } from './sentry';

export async function manejarProbarSentry(req: Request): Promise<Response> {
  const clave = process.env.BOTS_TAREAS_SECRET || process.env.CRON_SECRET;
  if (!clave || req.headers.get('authorization') !== `Bearer ${clave}`) return new Response('No autorizado.', { status: 401 });
  if (!leerDsn(process.env.SENTRY_DSN)) {
    return Response.json({ ok: false, motivo: 'Sentry está apagado: falta SENTRY_DSN.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  throw new Error('Prueba de Sentry: error forzado desde /api/probar-sentry. Si llegó, Sentry anda.');
}
