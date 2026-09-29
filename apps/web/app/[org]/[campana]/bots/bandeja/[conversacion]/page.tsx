import { notFound, redirect } from 'next/navigation';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { puede } from '@campaignsuite/botmaker/dominio/permisos';
import { PantallaConversacion } from '@campaignsuite/botmaker/ui/bandeja';
import { vistaConversacion } from '@campaignsuite/botmaker/vistas/bandeja';
import { contextoBots, type ParametrosBusqueda } from '@/lib/modulo';

/** Una conversación con su registro de decisiones. Una de otra campaña da 404. */
export default async function Conversacion({ params, searchParams }: { params: Promise<{ org: string; campana: string; conversacion: string }>; searchParams: ParametrosBusqueda }) {
  const { conversacion } = await params;
  const ctx = await contextoBots(params, searchParams);
  if (!puede(ctx.rol, 'leer_conversaciones')) redirect(ctx.base);
  const v = await vistaConversacion(obtenerRepositorio(), ctx, decodeURIComponent(conversacion));
  if (!v) notFound();
  return <PantallaConversacion v={v} />;
}
