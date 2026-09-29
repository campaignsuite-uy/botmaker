import { redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaContactos } from '@campaignsuite/botmaker/ui/contactos';
import { vistaContactos } from '@campaignsuite/botmaker/vistas/contactos';
import { contextoBots, type Parametros, type ParametrosBusqueda } from '@/lib/modulo';

/** Base de contactos: quienes leen conversaciones. El número, solo quien atiende; la descarga, solo el administrador. */
export default async function Contactos({ params, searchParams }: { params: Parametros; searchParams: ParametrosBusqueda }) {
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'leer_conversaciones')) redirect(ctx.base);
  return <PantallaContactos v={await vistaContactos(obtenerRepositorio(), ctx)} />;
}
