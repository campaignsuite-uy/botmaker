import { manejarWidget } from '@campaignsuite/botmaker/canal-web/http';

/** El script que la campaña pega en su sitio. */
export function GET() {
  return manejarWidget('');
}
