import { redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaBandeja } from '@campaignsuite/botmaker/ui/bandeja';
import { vistaBandeja } from '@campaignsuite/botmaker/vistas/bandeja';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Bandeja de conversaciones. Solo quien tiene 'leer_conversaciones'; los demás vuelven a la lista de bots. */
export default async function Bandeja({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'leer_conversaciones')) redirect(ctx.base);
  return <PantallaBandeja v={await vistaBandeja(obtenerRepositorio(), ctx)} />;
}
