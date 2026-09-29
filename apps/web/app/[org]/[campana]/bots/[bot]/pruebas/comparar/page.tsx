import { notFound, redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaComparar } from '@campaignsuite/botmaker/ui/pruebas';
import { vistaComparar } from '@campaignsuite/botmaker/vistas/pruebas';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/**
 * Compara dos corridas. La tabla de Pruebas manda las dos marcadas como ?corrida=…&corrida=… (la más nueva primero):
 * acá se pasan a ?a=(la más vieja)&b=(la más nueva), que es la dirección que se puede guardar o compartir.
 */
export default async function Comparar({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { org, campana, bot } = await params;
  const sp = await searchParams;
  const marcadas = ([] as (string | undefined)[]).concat(sp.corrida).filter((x): x is string => !!x);
  if (marcadas.length) {
    const [b, a] = marcadas;
    redirect(`/${org}/${campana}/bots/${bot}/pruebas/comparar?${new URLSearchParams(a ? { a, b: b! } : { b: b! }).toString()}`);
  }
  const ctx = await contextoBots(params, Promise.resolve(sp));
  const v = await vistaComparar(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaComparar v={v} />;
}
