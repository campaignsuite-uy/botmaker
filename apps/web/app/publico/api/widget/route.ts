import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarDatosWidget } from '@campaignsuite/botmaker/canal-web/http';

/** Demo: los datos del botón del widget (nombre, iniciales y saludo). */
export async function GET(req: Request) {
  if (modoDatos() !== 'demo') notFound();
  return manejarDatosWidget(req);
}
