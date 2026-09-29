import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { vistaYaml } from '@campaignsuite/botmaker/vistas/partes';
import { contextoBots } from '@/lib/modulo';

/** Descarga el YAML del borrador (lo puede bajar cualquiera que ve el bot). */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; campana: string; bot: string }> }) {
  const { bot } = await params;
  const ctx = await contextoBots(params);
  const v = await vistaYaml(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v || !v.yaml) return new Response('No existe ese bot o todavía no tiene borrador.', { status: 404 });
  return new Response(v.yaml, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${v.nombreArchivo}"`,
      'Cache-Control': 'no-store',
    },
  });
}
