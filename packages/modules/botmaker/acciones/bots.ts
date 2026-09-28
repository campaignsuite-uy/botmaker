'use server';
/**
 * Acciones de los bots: crear, guardar datos, motores y topes, datos personales, archivar y probar un motor.
 * Sesión y permiso (accesoAccion) → núcleo sin Next (ejecutar-bots.ts) → revalidar → volver con ?ok= o ?error=.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { capaMotores } from '../motores';
import { campanaDelNucleo } from './campana';
import { rutaVolver, texto } from './comun';
import {
  ejecutarArchivarBot, ejecutarCrearBot, ejecutarGuardarBot, ejecutarGuardarDatosPersonales, ejecutarGuardarMotores, ejecutarProbarMotor, type Salida,
} from './ejecutar-bots';
import { accesoAccion, conMensaje } from './mensajes';

const RUTA_LAYOUT = '/[org]/[campana]/bots';

function volverCon(volver: string, s: Salida): never {
  if (s.tipo === 'ok') revalidatePath(RUTA_LAYOUT, 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo, s.extra));
}

export async function crearBot(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'editar_borrador', volver);
  const s = await ejecutarCrearBot({ repo, rol, personaId: persona.id, campanaId }, fd);
  if (s.tipo === 'ok' && s.botId) {
    revalidatePath(RUTA_LAYOUT, 'layout');
    // De …/bots/nuevo al bot recién creado: …/bots/<id>.
    redirect(conMensaje(volver.replace(/\/nuevo(\?.*)?$/, `/${s.botId}`), 'ok', s.codigo));
  }
  volverCon(volver, s);
}

export async function guardarBot(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'editar_borrador', volver);
  volverCon(volver, await ejecutarGuardarBot({ repo, rol, personaId: persona.id, campanaId }, fd));
}

export async function guardarMotores(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'elegir_motores', volver);
  volverCon(volver, await ejecutarGuardarMotores({ repo, rol, personaId: persona.id, campanaId }, fd));
}

export async function guardarDatosPersonales(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'gestionar_datos_contactos', volver);
  volverCon(volver, await ejecutarGuardarDatosPersonales({ repo, rol, personaId: persona.id, campanaId }, fd));
}

export async function archivarBot(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'publicar', volver);
  const s = await ejecutarArchivarBot({ repo, rol, personaId: persona.id, campanaId }, fd);
  if (s.tipo === 'ok') {
    revalidatePath(RUTA_LAYOUT, 'layout');
    redirect(conMensaje(volver.replace(/\/[^/?#]+(\?.*)?(#.*)?$/, ''), 'ok', s.codigo));
  }
  volverCon(volver, s);
}

export async function probarMotor(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo, nucleo } = await accesoAccion(campanaId, 'elegir_motores', volver);
  const s = await ejecutarProbarMotor({ repo, rol, personaId: persona.id, campanaId, campana: campanaDelNucleo(nucleo, campanaId) }, capaMotores(repo), fd);
  redirect(conMensaje(volver, s.tipo, s.codigo, s.extra));
}
