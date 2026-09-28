import { redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaCostos } from '@campaignsuite/botmaker/ui/costos';
import { vistaCostos } from '@campaignsuite/botmaker/vistas/costos';
import { contextoBots, type Parametros } from '@/lib/modulo';

/** Costos de los motores. Solo quien tiene 'ver_costos'; los demás vuelven a la lista de bots. */
export default async function Costos({ params }: { params: Parametros }) {
  const ctx = await contextoBots(params);
  if (!puede(ctx.rol, 'ver_costos')) redirect(ctx.base);
  return <PantallaCostos v={await vistaCostos(obtenerRepositorio(), ctx)} />;
}
