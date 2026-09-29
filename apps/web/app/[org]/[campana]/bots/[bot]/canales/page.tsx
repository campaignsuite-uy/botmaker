import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaCanales } from '@campaignsuite/botmaker/ui/canales';
import { vistaCanales } from '@campaignsuite/botmaker/vistas/canales';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Canales del bot: canal web, condiciones y protección. Un bot que no es de esta campaña da 404. */
export default async function Canales({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaCanales(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaCanales v={v} />;
}
