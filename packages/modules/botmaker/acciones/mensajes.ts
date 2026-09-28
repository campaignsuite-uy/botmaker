/**
 * Ayudas de las acciones (no es un archivo 'use server'). Cada acción vuelve a la pantalla con ?ok=código o
 * ?error=código; el texto lo arma la vista (vistas/mensajes.ts). Si falta el permiso, se vuelve con ?error=sin_permiso
 * en lugar de mostrar una página de error; el permiso se sigue exigiendo en el servidor.
 */
import { redirect } from 'next/navigation';
import { SinPermiso, SoloLectura, type Accion } from '../dominio/permisos';
import { contextoAccion } from './comun';

/** Agrega ?ok= o ?error= (y otros parámetros) a la ruta de vuelta, respetando la query y el ancla. */
export function conMensaje(volver: string, tipo: 'ok' | 'error', codigo: string, extra: Record<string, string | undefined> = {}): string {
  const [sinAncla = '/', ancla] = volver.split('#');
  const [camino = '/', query] = sinAncla.split('?');
  const q = new URLSearchParams(query ?? '');
  for (const k of ['ok', 'error', 'detalle', 'prueba', 'motor', 'funcion', 'ms', 'usd']) q.delete(k);
  q.set(tipo, codigo);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') q.set(k, v.slice(0, 160));
  return `${camino}?${q.toString()}${ancla ? `#${ancla}` : ''}`;
}

/** contextoAccion + permiso; si falla, vuelve a la pantalla con el error en la dirección. */
export async function accesoAccion(campanaId: string, accion: Accion, volver: string) {
  try {
    return await contextoAccion(campanaId, accion);
  } catch (e) {
    redirect(conMensaje(volver, 'error', e instanceof SinPermiso ? 'sin_permiso' : e instanceof SoloLectura ? 'solo_lectura' : 'sesion'));
  }
}
