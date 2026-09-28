import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaBot } from '@campaignsuite/botmaker/ui/bot';
import { vistaBot } from '@campaignsuite/botmaker/vistas/bot';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Ajustes de un bot. Un bot que no es de esta campaña da 404. */
export default async function Bot({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaBot(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaBot v={v} />;
}
