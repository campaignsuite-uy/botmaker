import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaSimulador } from '@campaignsuite/botmaker/ui/simulador';
import { vistaSimulador } from '@campaignsuite/botmaker/vistas/simulador';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Simulador del borrador. Un bot que no es de esta campaña da 404. */
export default async function Simulador({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaSimulador(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaSimulador v={v} />;
}
