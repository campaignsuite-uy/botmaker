import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaMaterial } from '@campaignsuite/botmaker/ui/partes';
import { vistaMaterial } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Material del borrador en secciones. Un bot que no es de esta campaña da 404. */
export default async function Material({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaMaterial(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaMaterial v={v} />;
}
