import { PantallaEquipo } from '@campaignsuite/botmaker/ui/equipo';
import { vistaEquipo } from '@campaignsuite/botmaker/vistas/equipo';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Equipo y roles de BotMaker en la campaña. */
export default async function Equipo({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  return <PantallaEquipo v={vistaEquipo(ctx)} />;
}
