import { contextoAccion } from '@campaignsuite/botmaker/acciones/comun';
import { descargaContactos } from '@campaignsuite/botmaker/vistas/contactos';
import { contextoBots } from '@/lib/modulo';

/**
 * Descarga la base de contactos en CSV, con el filtro de la pantalla (bot, canal, consulta y texto). Solo el
 * administrador ('gestionar_datos_contactos'); queda registrado quién, cuándo y cuántos, sin el texto buscado.
 */
export async function GET(req: Request, { params }: { params: Promise<{ org: string; campana: string }> }) {
  const ctx = await contextoBots(params, Promise.resolve(Object.fromEntries(new URL(req.url).searchParams)));
  let c;
  try {
    c = await contextoAccion(ctx.campana.id, 'gestionar_datos_contactos');
  } catch {
    return new Response('Tu rol no permite descargar la base de contactos.', { status: 403 });
  }
  const { archivo, csv } = await descargaContactos(c.repo, ctx);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${archivo}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
