import { after } from 'next/server';
import { manejarWebhookWhatsapp } from '@campaignsuite/botmaker/canal-whatsapp/http';

export const dynamic = 'force-dynamic';

/**
 * El aviso de 360dialog de un bot: una dirección por bot, con el secreto del canal en el encabezado x-botmaker-secreto.
 * Contesta enseguida (360dialog exige menos de 5 segundos) y procesa después con after().
 */
export async function POST(req: Request, { params }: { params: Promise<{ bot: string }> }) {
  return manejarWebhookWhatsapp(req, (await params).bot, '', after);
}
