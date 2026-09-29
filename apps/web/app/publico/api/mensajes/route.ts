import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarMensajes } from '@campaignsuite/botmaker/canal-web/http';

export const dynamic = 'force-dynamic';

/** Demo: lo nuevo de la conversación. */
export async function GET(req: Request) {
  if (modoDatos() !== 'demo') notFound();
  return manejarMensajes(req);
}
