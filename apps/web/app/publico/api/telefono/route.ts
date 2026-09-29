import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarTelefono } from '@campaignsuite/botmaker/canal-whatsapp/http';

export const dynamic = 'force-dynamic';

/** Demo: el teléfono de prueba (escribe al WhatsApp del bot por el 360dialog simulado). */
export async function GET(req: Request) {
  if (modoDatos() !== 'demo') notFound();
  return manejarTelefono(req, '/publico');
}

export async function POST(req: Request) {
  if (modoDatos() !== 'demo') notFound();
  return manejarTelefono(req, '/publico');
}
