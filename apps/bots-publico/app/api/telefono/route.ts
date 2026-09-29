import { manejarTelefono } from '@campaignsuite/botmaker/canal-whatsapp/http';

export const dynamic = 'force-dynamic';

/** Solo con CAMPAIGNSUITE_DATOS=demo: el teléfono de prueba. Con datos reales contesta 404. */
export async function GET(req: Request) {
  return manejarTelefono(req, '');
}

export async function POST(req: Request) {
  return manejarTelefono(req, '');
}
