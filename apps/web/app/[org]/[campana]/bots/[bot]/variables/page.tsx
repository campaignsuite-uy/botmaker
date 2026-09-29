import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaVariables } from '@campaignsuite/botmaker/ui/partes';
import { vistaVariables } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Variables, identidad, contacto y mensajes del sistema. Un bot que no es de esta campaña da 404. */
export default async function Variables({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaVariables(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaVariables v={v} />;
}
