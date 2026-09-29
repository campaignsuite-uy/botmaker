import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaCopiloto } from '@campaignsuite/botmaker/ui/copiloto';
import { vistaCopiloto } from '@campaignsuite/botmaker/vistas/copiloto';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Copiloto del borrador. Un bot que no es de esta campaña da 404. */
export default async function Copiloto({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaCopiloto(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaCopiloto v={v} />;
}
