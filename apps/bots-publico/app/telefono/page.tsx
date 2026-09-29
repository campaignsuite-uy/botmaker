import { notFound } from 'next/navigation';
import { modoDatos } from '@campaignsuite/platform/entorno';
import { TelefonoPrueba } from '@campaignsuite/botmaker/ui/publico/telefono';

export const dynamic = 'force-dynamic';

/** Solo en la demo: un teléfono de prueba para conversar con el WhatsApp de un bot (?bot=<id público>). */
export default async function Telefono({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (modoDatos() !== 'demo') notFound();
  const bot = String((await searchParams).bot ?? '').replace(/[^a-z0-9]/g, '').slice(0, 20) || null;
  return <TelefonoPrueba base="" botInicial={bot} />;
}
