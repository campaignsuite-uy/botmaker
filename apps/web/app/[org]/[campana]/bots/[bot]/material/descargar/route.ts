import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { materialComoTexto } from '@campaignsuite/botmaker/dominio/material';
import { vistaMaterial } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots } from '@/lib/modulo';

/** Descarga el material del borrador (sin borrador, el de lo publicado) como texto (.md), en el mismo formato con que se carga. */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; campana: string; bot: string }> }) {
  const { bot } = await params;
  const ctx = await contextoBots(params);
  const v = await vistaMaterial(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v || !v.secciones.length) return new Response('Ese bot no tiene material.', { status: 404 });
  return new Response(materialComoTexto(v.secciones), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="material-${v.botId}.md"`, 'Cache-Control': 'no-store' },
  });
}
