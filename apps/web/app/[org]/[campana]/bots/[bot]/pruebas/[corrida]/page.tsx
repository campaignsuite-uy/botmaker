import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaCorrida } from '@campaignsuite/botmaker/ui/pruebas';
import { vistaCorrida } from '@campaignsuite/botmaker/vistas/pruebas';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Una corrida caso por caso. Una corrida de otro bot da 404. */
export default async function Corrida({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string; corrida: string }>; searchParams: ParametrosBusqueda }) {
  const { bot, corrida } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaCorrida(obtenerRepositorio(), ctx, decodeURIComponent(bot), decodeURIComponent(corrida));
  if (!v) notFound();
  return <PantallaCorrida v={v} />;
}
