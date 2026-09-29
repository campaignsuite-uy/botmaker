import { datosPagina } from '@campaignsuite/botmaker/canal-web/nucleo';
import { obtenerRepositorioPublico } from '@campaignsuite/botmaker/datos/publico';
import { PaginaBot, PaginaNoDisponible } from '@campaignsuite/botmaker/ui/publico/pagina';

export const dynamic = 'force-dynamic';

/** Demo: la página del bot (ver app/publico/layout.tsx). */
export default async function PaginaDelBot({ params, searchParams }: { params: Promise<{ bot: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { bot } = await params;
  const d = await datosPagina(obtenerRepositorioPublico(), bot);
  if (!d) return <PaginaNoDisponible />;
  return <PaginaBot d={d} bot={bot} base="/publico" incrustado={(await searchParams).incrustado === '1'} turnstile={null} />;
}
