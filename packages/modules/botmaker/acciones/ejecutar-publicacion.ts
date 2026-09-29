/**
 * Núcleo de la publicación (etapa 4, tarea 4.06), sin Next: el editor pide publicar el borrador tal como lo vio; el
 * administrador aprueba o devuelve con un comentario. Además de lo que exige la base (corrida terminada sobre el último
 * cambio, no bajar 2 puntos de acierto), el servidor exige que el validador no tenga errores.
 */
import { ErrorDatos } from '../datos/errores';
import { puede } from '../dominio/permisos';
import { revisarBot } from '../dominio/validador';
import type { ContextoNucleo, Salida } from './ejecutar-bots';
import { leerBorrador } from './ejecutar-borrador';

const deError = (x: unknown): Salida => ({ tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' });

export async function ejecutarPedirPublicacion(c: ContextoNucleo, e: { botId: string; seq: number; nota: string }): Promise<Salida> {
  if (!puede(c.rol, 'pedir_publicacion')) return { tipo: 'error', codigo: 'sin_permiso' };
  const bot = await c.repo.bot(e.botId);
  if (!bot || bot.campanaId !== c.campanaId) return { tipo: 'error', codigo: 'no_existe' };
  const l = await leerBorrador(c.repo, bot.id);
  if ('codigo' in l) return { tipo: 'error', codigo: l.codigo };
  if (revisarBot(l.definicion).errores.length) return { tipo: 'error', codigo: 'errores_validador' };
  try {
    await c.repo.pedirPublicacion(l.borrador.id, e.seq, e.nota.trim(), c.personaId);
    return { tipo: 'ok', codigo: 'publicacion_pedida' };
  } catch (x) {
    return deError(x);
  }
}

async function versionDelBot(c: ContextoNucleo, botId: string, versionId: string) {
  const bot = await c.repo.bot(botId);
  if (!bot || bot.campanaId !== c.campanaId) return null;
  const v = await c.repo.version(versionId);
  return v && v.botId === bot.id ? v : null;
}

export async function ejecutarAprobarPublicacion(c: ContextoNucleo, e: { botId: string; versionId: string; nota: string }): Promise<Salida> {
  if (!puede(c.rol, 'publicar')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await versionDelBot(c, e.botId, e.versionId))) return { tipo: 'error', codigo: 'no_existe' };
  try {
    await c.repo.aprobarPublicacion(e.versionId, e.nota.trim(), c.personaId);
    return { tipo: 'ok', codigo: 'publicacion_aprobada' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarDevolverPublicacion(c: ContextoNucleo, e: { botId: string; versionId: string; nota: string }): Promise<Salida> {
  if (!puede(c.rol, 'publicar')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!e.nota.trim()) return { tipo: 'error', codigo: 'falta_comentario' };
  if (!(await versionDelBot(c, e.botId, e.versionId))) return { tipo: 'error', codigo: 'no_existe' };
  try {
    await c.repo.devolverPublicacion(e.versionId, e.nota.trim(), c.personaId);
    return { tipo: 'ok', codigo: 'publicacion_devuelta' };
  } catch (x) {
    return deError(x);
  }
}
