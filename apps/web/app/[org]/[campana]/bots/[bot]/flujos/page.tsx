import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaFlujos } from '@campaignsuite/botmaker/ui/flujos';
import { vistaEditor } from '@campaignsuite/botmaker/vistas/editor';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Flujos de un bot: el editor del borrador. Un bot que no es de esta campaña da 404. */
export default async function Flujos({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaEditor(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaFlujos v={v} />;
}
