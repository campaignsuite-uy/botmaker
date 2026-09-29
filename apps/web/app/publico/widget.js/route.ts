import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { manejarWidget } from '@campaignsuite/botmaker/canal-web/http';

/** Demo: el script del widget (las rutas quedan bajo /publico). */
export function GET() {
  if (modoDatos() !== 'demo') notFound();
  return manejarWidget('/publico');
}
