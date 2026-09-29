import { notFound } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaPruebas } from '@campaignsuite/botmaker/ui/pruebas';
import { vistaPruebas } from '@campaignsuite/botmaker/vistas/pruebas';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Casos de prueba, corridas y cómo correrlas. Un bot que no es de esta campaña da 404. */
export default async function Pruebas({ params, searchParams }: { params: Promise<{ org: string; campana: string; bot: string }>; searchParams: ParametrosBusqueda }) {
  const { bot } = await params;
  const ctx = await contextoBots(params, searchParams);
  const v = await vistaPruebas(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v) notFound();
  return <PantallaPruebas v={v} />;
}
