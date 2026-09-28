'use server';
/**
 * Acciones de Equipo y roles: el rol de un integrante de la campaña en BotMaker. Sesión y permiso ('gestionar_equipo')
 * → núcleo (ejecutar-equipo.ts) → revalidar → volver con ?ok= o ?error=. La base lo vuelve a exigir.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { rutaVolver, texto } from './comun';
import { ejecutarRolEquipo } from './ejecutar-equipo';
import { accesoAccion, conMensaje } from './mensajes';

export async function guardarRolEquipo(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo, nucleo } = await accesoAccion(campanaId, 'gestionar_equipo', volver);
  const s = await ejecutarRolEquipo({ repo, rol, personaId: persona.id, campanaId }, nucleo, fd);
  // El rol vive en el núcleo de la plataforma: se revalida todo lo de la organización (menús y pantallas).
  if (s.tipo === 'ok') revalidatePath('/[org]', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo));
}
