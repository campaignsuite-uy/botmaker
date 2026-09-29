import { contextoAccion } from '@campaignsuite/botmaker/acciones/comun';
import { ejecutarExportarContacto } from '@campaignsuite/botmaker/acciones/ejecutar-bandeja';
import { contextoBots } from '@/lib/modulo';

/** Exporta los datos de un contacto (JSON) y deja el pedido registrado. Solo 'gestionar_datos_contactos'. */
export async function GET(_: Request, { params }: { params: Promise<{ org: string; campana: string; contacto: string }> }) {
  const { contacto } = await params;
  const ctx = await contextoBots(params);
  let c;
  try {
    c = await contextoAccion(ctx.campana.id, 'gestionar_datos_contactos');
  } catch {
    return new Response('Tu rol no permite exportar datos de contactos.', { status: 403 });
  }
  const r = await ejecutarExportarContacto({ repo: c.repo, rol: c.rol, personaId: c.persona.id, campanaId: ctx.campana.id }, { contactoId: decodeURIComponent(contacto) });
  if (r.tipo !== 'ok') return new Response('No existe ese contacto.', { status: 404 });
  return new Response(JSON.stringify(r.datos, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="contacto-${r.datos.contacto.id}.json"`, 'Cache-Control': 'no-store' },
  });
}
