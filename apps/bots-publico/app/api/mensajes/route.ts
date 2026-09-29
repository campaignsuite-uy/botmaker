import { manejarMensajes } from '@campaignsuite/botmaker/canal-web/http';

export const dynamic = 'force-dynamic';

/** Lo nuevo de la conversación (mientras la atiende el equipo). */
export async function GET(req: Request) {
  return manejarMensajes(req);
}
