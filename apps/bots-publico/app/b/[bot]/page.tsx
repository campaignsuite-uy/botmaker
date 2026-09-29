import type { Metadata } from 'next';
import { datosPagina } from '@campaignsuite/botmaker/canal-web/nucleo';
import { obtenerRepositorioPublico } from '@campaignsuite/botmaker/datos/publico';
import { PaginaBot, PaginaNoDisponible } from '@campaignsuite/botmaker/ui/publico/pagina';

type Props = { params: Promise<{ bot: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await datosPagina(obtenerRepositorioPublico(), (await params).bot);
  return d ? { title: `${d.candidato} · ${d.nombre}` } : { title: 'Asistente no disponible' };
}

/** La página del bot (también la que se abre dentro del widget, con ?incrustado=1). */
export default async function PaginaDelBot({ params, searchParams }: Props) {
  const { bot } = await params;
  const d = await datosPagina(obtenerRepositorioPublico(), bot);
  if (!d) return <PaginaNoDisponible />;
  const incrustado = (await searchParams).incrustado === '1';
  return <PaginaBot d={d} bot={bot} base="" incrustado={incrustado} turnstile={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null} />;
}
