import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarWebhookWhatsapp } from '@campaignsuite/botmaker/canal-whatsapp/http';

export const dynamic = 'force-dynamic';

/** Demo: el aviso de 360dialog (en la demo lo manda el 360dialog simulado). Contesta enseguida y procesa después. */
export async function POST(req: Request, { params }: { params: Promise<{ bot: string }> }) {
  if (modoDatos() !== 'demo') notFound();
  return manejarWebhookWhatsapp(req, (await params).bot, '/publico', after);
}
