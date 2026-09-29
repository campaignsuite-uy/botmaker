import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaPublicacion } from '@campaignsuite/botmaker/ui/publicacion';
import { vistaPublicacion } from '@campaignsuite/botmaker/vistas/publicacion';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Pedido y aprobación de publicación. Un bot que no es de esta campaña da 404. */
export default async function Publicacion({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaPublicacion(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaPublicacion v={v} />;
}
