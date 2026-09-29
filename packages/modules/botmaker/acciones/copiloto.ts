'use server';
/**
 * El copiloto desde el navegador: pedir una propuesta y aplicar las operaciones marcadas. Sesión y permiso en el
 * servidor (editar_borrador) → núcleo sin Next (ejecutar-copiloto.ts) → capa de motores con uso "copiloto".
 */
import { revalidatePath } from 'next/cache';
import { SinPermiso, SoloLectura } from '../dominio/permisos';
import { capaMotores } from '../motores';
import { campanaDelNucleo } from './campana';
import { contextoAccion, SinSesion } from './comun';
import type { ResultadoBorrador } from './ejecutar-borrador';
import { ejecutarAplicarCopiloto, ejecutarPedirCopiloto, type ResultadoCopiloto } from './ejecutar-copiloto';

async function contexto(campanaId: string) {
  try {
    const c = await contextoAccion(String(campanaId), 'editar_borrador');
    return { repo: c.repo, rol: c.rol, personaId: c.persona.id, campanaId: String(campanaId), campana: campanaDelNucleo(c.nucleo, String(campanaId)) ?? { nombre: '' } };
  } catch (e) {
    return { error: e instanceof SinPermiso ? 'sin_permiso' : e instanceof SoloLectura ? 'solo_lectura' : e instanceof SinSesion ? 'sesion' : 'no_se_pudo' };
  }
}

export async function pedirCopiloto(p: { campanaId: string; botId: string; modo: string; pedido: string }): Promise<ResultadoCopiloto> {
  const c = await contexto(p.campanaId);
  if ('error' in c) return { ok: false, codigo: c.error! };
  return ejecutarPedirCopiloto(c, capaMotores(c.repo), { botId: String(p.botId), modo: String(p.modo), pedido: String(p.pedido ?? '') });
}

export async function aplicarCopiloto(p: { campanaId: string; botId: string; seq: number; operaciones: unknown[] }): Promise<ResultadoBorrador> {
  const c = await contexto(p.campanaId);
  if ('error' in c) return { ok: false, codigo: c.error! };
  const r = await ejecutarAplicarCopiloto(c, { botId: String(p.botId), seq: Number(p.seq), operaciones: Array.isArray(p.operaciones) ? p.operaciones.slice(0, 200) : [] });
  if (r.ok) revalidatePath('/[org]/[campana]/bots', 'layout');
  return r;
}
