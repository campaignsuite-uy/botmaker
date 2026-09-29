import type { Metadata } from 'next';
import { TelefonoPrueba } from '@campaignsuite/botmaker/ui/publico/telefono';

export const metadata: Metadata = { title: 'Teléfono de prueba · BotMaker' };

/** Demo: un teléfono de prueba para conversar con el WhatsApp de un bot (?bot=<id público>). */
export default async function Telefono({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const bot = String((await searchParams).bot ?? '').replace(/[^a-z0-9]/g, '').slice(0, 20) || null;
  return <TelefonoPrueba base="/publico" botInicial={bot} />;
}
