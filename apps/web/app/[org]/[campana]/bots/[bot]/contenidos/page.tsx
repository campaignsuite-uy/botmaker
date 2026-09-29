import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaContenidos } from '@campaignsuite/botmaker/ui/partes';
import { vistaContenidos } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Contenidos del borrador. Un bot que no es de esta campaña da 404. */
export default async function Contenidos({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaContenidos(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaContenidos v={v} />;
}
