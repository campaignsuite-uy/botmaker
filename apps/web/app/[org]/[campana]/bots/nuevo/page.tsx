import { PantallaNuevoBot } from '@campaignsuite/botmaker/ui/nuevo';
import { vistaNuevoBot } from '@campaignsuite/botmaker/vistas/nuevo';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

export const dynamic = 'force-dynamic';

/** Nuevo bot. La clave del formulario es nueva en cada carga (un doble envío no crea dos bots). */
export default async function NuevoBot({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  return <PantallaNuevoBot v={vistaNuevoBot(ctx)} />;
}
