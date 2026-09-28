import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { PantallaBots } from '@campaignsuite/botmaker/ui/bots';
import { vistaBots } from '@campaignsuite/botmaker/vistas/bots';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Bots de la campaña. ?archivados=1 muestra también los archivados. */
export default async function Bots({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  return <PantallaBots v={await vistaBots(obtenerRepositorio(), ctx)} />;
}
