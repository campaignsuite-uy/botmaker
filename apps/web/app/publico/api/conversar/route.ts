import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarConversar } from '@campaignsuite/botmaker/canal-web/http';

/** Demo: un mensaje del widget o de la página del bot. */
export async function POST(req: Request) {
  if (modoDatos() !== 'demo') notFound();
  return manejarConversar(req);
}
