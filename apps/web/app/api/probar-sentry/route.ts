import { manejarProbarSentry } from '@campaignsuite/botmaker/observabilidad/http';

export const dynamic = 'force-dynamic';

/** Prueba de cierre de Sentry: tira un error a propósito (con la clave de las tareas). */
export async function GET(req: Request) {
  return manejarProbarSentry(req);
}
