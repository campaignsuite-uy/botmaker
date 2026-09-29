import { manejarConversar } from '@campaignsuite/botmaker/canal-web/http';

/** Un mensaje del widget o de la página del bot. */
export async function POST(req: Request) {
  return manejarConversar(req);
}
