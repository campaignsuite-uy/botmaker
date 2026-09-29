import { manejarTareas } from '@campaignsuite/botmaker/canal-web/http';

export const dynamic = 'force-dynamic';

/** Tareas de fondo (alertas y borrado por vencimiento): las llama el cron con su clave. */
export async function GET(req: Request) {
  return manejarTareas(req);
}
