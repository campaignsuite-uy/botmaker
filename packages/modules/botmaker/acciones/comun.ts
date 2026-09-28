/**
 * Ayuda común de las acciones del servidor. Toda acción: 1) resuelve la sesión, 2) exige el permiso con el rol que da
 * la plataforma (nunca con algo que mande el navegador), 3) valida la entrada con zod, 4) llama al repositorio (que en
 * Supabase vuelve a exigir el permiso en la base) y 5) vuelve a la pantalla con ?ok= o ?error=.
 */
import { rolEnCampana, soloLectura, type DatosNucleo } from '@campaignsuite/platform';
import { nucleoActual, personaActual } from '@campaignsuite/platform/sesion';
import { obtenerRepositorio } from '../datos';
import { esDeLectura, exigir, SoloLectura, type Accion } from '../dominio/permisos';
import { PRODUCTO, type RolEfectivo } from '../dominio/tipos';

export function rolEfectivo(nucleo: DatosNucleo, personaId: string, campanaId: string): RolEfectivo | null {
  return rolEnCampana(nucleo, personaId, campanaId, PRODUCTO) as RolEfectivo | null;
}

export class SinSesion extends Error {
  constructor() {
    super('Tenés que ingresar de nuevo.');
  }
}

export async function contextoAccion(campanaId: string, accion: Accion) {
  const persona = await personaActual();
  if (!persona) throw new SinSesion();
  const nucleo = await nucleoActual();
  const rol = rolEfectivo(nucleo, persona.id, campanaId);
  exigir(rol, accion);
  exigirEscritura(accion);
  return { persona, rol: rol!, nucleo, repo: obtenerRepositorio() };
}

/** En la demo online de solo lectura, solo pasan las acciones de lectura. */
export function exigirEscritura(accion?: Accion): void {
  if (soloLectura() && !(accion && esDeLectura(accion))) throw new SoloLectura();
}

export function texto(fd: FormData, clave: string): string {
  return String(fd.get(clave) ?? '').trim();
}

/** Ruta a la que se vuelve después de la acción. Solo rutas internas. */
export function rutaVolver(fd: FormData): string {
  const v = texto(fd, 'volver');
  return v.startsWith('/') && !v.startsWith('//') ? v : '/';
}

/** Número escrito por una persona: acepta coma o punto decimal y espacios ("1.234,5" → 1234.5). */
export function numeroDe(valor: string): number {
  let t = valor.replace(/[−‒–]/g, '-').replace(/\s/g, '').replace(/^USD/i, '');
  if (!t) return Number.NaN;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}
