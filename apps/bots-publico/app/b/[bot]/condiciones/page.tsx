import { datosPagina } from '@campaignsuite/botmaker/canal-web/nucleo';
import { obtenerRepositorioPublico } from '@campaignsuite/botmaker/datos/publico';
import { PaginaCondiciones, PaginaNoDisponible } from '@campaignsuite/botmaker/ui/publico/pagina';

export const dynamic = 'force-dynamic';

/** Las condiciones vigentes del bot. */
export default async function Condiciones({ params }: { params: Promise<{ bot: string }> }) {
  const { bot } = await params;
  const d = await datosPagina(obtenerRepositorioPublico(), bot);
  return d ? <PaginaCondiciones d={d} bot={bot} base="" /> : <PaginaNoDisponible />;
}
