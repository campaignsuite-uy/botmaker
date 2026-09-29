'use server';
/**
 * Corridas de prueba desde el navegador: empezar, correr la siguiente tanda y cancelar. Sesión y permiso en el
 * servidor (correr_pruebas) → núcleo sin Next (ejecutar-corridas.ts) → capa de motores con uso "pruebas".
 */
import { revalidatePath } from 'next/cache';
import { SinPermiso, SoloLectura } from '../dominio/permisos';
import { capaMotores } from '../motores';
import { campanaDelNucleo } from './campana';
import { contextoAccion, SinSesion } from './comun';
import { ejecutarAvanzarCorrida, ejecutarCancelarCorrida, ejecutarIniciarCorrida, type EleccionCorrida } from './ejecutar-corridas';

async function contexto(campanaId: string) {
  try {
    const c = await contextoAccion(String(campanaId), 'correr_pruebas');
    return { repo: c.repo, rol: c.rol, personaId: c.persona.id, campanaId: String(campanaId), campana: campanaDelNucleo(c.nucleo, String(campanaId)) ?? { nombre: '' } };
  } catch (e) {
    return { error: e instanceof SinPermiso ? 'sin_permiso' : e instanceof SoloLectura ? 'solo_lectura' : e instanceof SinSesion ? 'sesion' : 'no_se_pudo' };
  }
}

export async function iniciarCorrida(p: { campanaId: string; botId: string; motores?: EleccionCorrida | null }) {
  const c = await contexto(p.campanaId);
  if ('error' in c) return { tipo: 'error' as const, codigo: c.error! };
  return ejecutarIniciarCorrida(c, { botId: String(p.botId), motores: p.motores ?? null });
}

export async function avanzarCorrida(p: { campanaId: string; corridaId: string }) {
  const c = await contexto(p.campanaId);
  if ('error' in c) return { tipo: 'error' as const, codigo: c.error! };
  const r = await ejecutarAvanzarCorrida(c, (motores) => capaMotores(c.repo, { motores }), { corridaId: String(p.corridaId) });
  if (r.terminada) revalidatePath('/[org]/[campana]/bots', 'layout');
  return r;
}

export async function cancelarCorrida(p: { campanaId: string; corridaId: string }) {
  const c = await contexto(p.campanaId);
  if ('error' in c) return { tipo: 'error' as const, codigo: c.error! };
  const r = await ejecutarCancelarCorrida(c, { corridaId: String(p.corridaId) });
  revalidatePath('/[org]/[campana]/bots', 'layout');
  return r;
}
