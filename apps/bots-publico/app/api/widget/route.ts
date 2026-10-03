import { manejarDatosWidget } from '@campaignsuite/botmaker/canal-web/http';

/** Los datos del botón del widget (nombre, iniciales y saludo), para el script pegado en el sitio de la campaña. */
export async function GET(req: Request) {
  return manejarDatosWidget(req);
}
