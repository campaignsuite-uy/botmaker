import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaAnalitica } from '@campaignsuite/botmaker/ui/analitica';
import { vistaAnalitica } from '@campaignsuite/botmaker/vistas/analitica';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Analítica: la ven todos los que entran a BotMaker ('ver'); el costo, quien ve costos. */
export default async function Analitica({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  return <PantallaAnalitica v={await vistaAnalitica(obtenerRepositorio(), ctx)} />;
}
