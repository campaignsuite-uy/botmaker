import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaYaml } from '@campaignsuite/botmaker/ui/partes';
import { vistaYaml } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** El borrador como YAML. Un bot que no es de esta campaña da 404. */
export default async function Yaml({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaYaml(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaYaml v={v} />;
}
