import { redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaRevision } from '@campaignsuite/botmaker/ui/bandeja';
import { vistaRevision } from '@campaignsuite/botmaker/vistas/bandeja';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Revisión por muestreo de las respuestas con base. */
export default async function Revision({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'leer_conversaciones')) redirect(ctx.base);
  return <PantallaRevision v={await vistaRevision(obtenerRepositorio(), ctx)} />;
}
