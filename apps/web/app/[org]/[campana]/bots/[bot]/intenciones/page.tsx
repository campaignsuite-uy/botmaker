import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaIntenciones } from '@campaignsuite/botmaker/ui/partes';
import { vistaIntenciones } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Intenciones y temas del borrador. Un bot que no es de esta campaña da 404. */
export default async function Intenciones({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaIntenciones(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaIntenciones v={v} />;
}
