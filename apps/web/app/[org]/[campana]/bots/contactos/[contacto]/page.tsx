import { notFound, redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaFichaContacto } from '@campaignsuite/botmaker/ui/contactos';
import { vistaFichaContacto } from '@campaignsuite/botmaker/vistas/contactos';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** La ficha de un contacto: sus datos, lo que consultó y sus conversaciones. Uno de otra campaña da 404. */
export default async function FichaContacto({ params, searchParams }: { params: Promise<{ org: string; campana: string; contacto: string }>; searchParams: ParametrosBusqueda }) {
  const { contacto } = await params;
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'leer_conversaciones')) redirect(ctx.base);
  const v = await vistaFichaContacto(obtenerRepositorio(), ctx, decodeURIComponent(contacto));
  if (!v) notFound();
  return <PantallaFichaContacto v={v} />;
}
