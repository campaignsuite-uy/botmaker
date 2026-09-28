/**
 * Núcleo de Equipo y roles, sin Next: el rol de un integrante de la campaña en BotMaker. Permiso 'gestionar_equipo'
 * (el administrador de BotMaker; en cascada, quien administra la campaña o la organización). Quien administra la campaña
 * no cambia de rol acá. La base lo vuelve a exigir (bots.asignar_rol → core.asignar_acceso). No es un archivo 'use server'.
 */
import { rolCampana, type DatosNucleo } from '@campaignsuite/platform';
import { ErrorNucleo } from '@campaignsuite/platform/memoria';
import { ErrorDatos } from '../datos/errores';
import { puede } from '../dominio/permisos';
import { ROLES_MODULO, type RolModulo } from '../dominio/tipos';
import { texto } from './comun';
import type { ContextoNucleo, Salida } from './ejecutar-bots';

export async function ejecutarRolEquipo(c: ContextoNucleo, nucleo: DatosNucleo, fd: FormData): Promise<Salida> {
  if (!puede(c.rol, 'gestionar_equipo')) return { tipo: 'error', codigo: 'sin_permiso' };
  const personaId = texto(fd, 'personaId');
  const rc = rolCampana(nucleo, personaId, c.campanaId);
  if (!personaId || !rc || rc === 'observador') return { tipo: 'error', codigo: 'no_integrante' };
  if (rc === 'administrador') return { tipo: 'error', codigo: 'admin_campana' };
  const r = texto(fd, 'rol');
  if (r && !(ROLES_MODULO as readonly string[]).includes(r)) return { tipo: 'error', codigo: 'rol' };
  try {
    await c.repo.asignarRol(c.campanaId, personaId, (r || null) as RolModulo | null, c.personaId);
  } catch (e) {
    if (e instanceof ErrorDatos || e instanceof ErrorNucleo) return { tipo: 'error', codigo: e.codigo };
    return { tipo: 'error', codigo: 'no_se_pudo' };
  }
  return { tipo: 'ok', codigo: r ? 'rol_guardado' : 'sin_acceso' };
}
