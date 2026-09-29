import { redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaDatosContactos } from '@campaignsuite/botmaker/ui/bandeja';
import { vistaDatosContactos } from '@campaignsuite/botmaker/vistas/bandeja';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Pedidos sobre los datos de un contacto: solo el administrador ('gestionar_datos_contactos'). */
export default async function DatosContactos({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'gestionar_datos_contactos')) redirect(ctx.base);
  return <PantallaDatosContactos v={await vistaDatosContactos(obtenerRepositorio(), ctx)} />;
}
