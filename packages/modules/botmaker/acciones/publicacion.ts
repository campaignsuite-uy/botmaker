'use server';
/**
 * Formularios de Publicación: pedir publicar (editor o administrador), aprobar y devolver (administrador). Sesión y
 * permiso en el servidor → núcleo sin Next (ejecutar-publicacion.ts) → repositorio, que en Supabase lo vuelve a exigir.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rutaVolver, texto } from './comun';
import { ejecutarAprobarPublicacion, ejecutarDevolverPublicacion, ejecutarPedirPublicacion } from './ejecutar-publicacion';
import { accesoAccion, conMensaje } from './mensajes';

export async function pedirPublicacion(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'pedir_publicacion', volver);
  const s = await ejecutarPedirPublicacion({ repo, rol, personaId: persona.id, campanaId }, { botId: texto(fd, 'botId'), seq: Number(texto(fd, 'seq')), nota: texto(fd, 'nota').slice(0, 2000) });
  if (s.tipo === 'ok') revalidatePath('/[org]/[campana]/bots', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo));
}

export async function resolverPublicacion(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'publicar', volver);
  const c = { repo, rol, personaId: persona.id, campanaId };
  const e = { botId: texto(fd, 'botId'), versionId: texto(fd, 'versionId'), nota: texto(fd, 'nota').slice(0, 2000) };
  const s = texto(fd, 'decision') === 'aprobar' ? await ejecutarAprobarPublicacion(c, e) : await ejecutarDevolverPublicacion(c, e);
  if (s.tipo === 'ok') revalidatePath('/[org]/[campana]/bots', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo));
}
