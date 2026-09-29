import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { vistaPruebas } from '@campaignsuite/botmaker/vistas/pruebas';
import { contextoBots } from '@/lib/modulo';

/** Descarga los casos de prueba del borrador como texto, en el mismo formato con que se cargan. */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; campana: string; bot: string }> }) {
  const { bot } = await params;
  const ctx = await contextoBots(params);
  const v = await vistaPruebas(obtenerRepositorio(), ctx, decodeURIComponent(bot));
  if (!v || !v.casos.total) return new Response('Ese bot no tiene casos de prueba.', { status: 404 });
  return new Response(v.casos.texto, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="casos-${v.botId}.txt"`, 'Cache-Control': 'no-store' },
  });
}
