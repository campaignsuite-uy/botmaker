'use server';
/**
 * Formularios de la bandeja, del canal web y de la pausa: sesión y permiso en el servidor → núcleo sin Next
 * (ejecutar-bandeja.ts) → repositorio, que en Supabase lo vuelve a exigir en la base. Vuelven con ?ok= o ?error=.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Accion } from '../dominio/permisos';
import { capaMotores } from '../motores';
import { campanaDelNucleo } from './campana';
import { rutaVolver, texto } from './comun';
import {
  ejecutarBorrarContacto, ejecutarCerrar, ejecutarDevolver, ejecutarGuardarCanal, ejecutarPausar, ejecutarPublicarCondiciones, ejecutarResponder, ejecutarRevisar,
  ejecutarTomar,
} from './ejecutar-bandeja';
import type { Salida } from './ejecutar-bots';
import { accesoAccion, conMensaje } from './mensajes';

async function correr(fd: FormData, accion: Accion, f: (c: Awaited<ReturnType<typeof contexto>>) => Promise<Salida>): Promise<never> {
  const volver = rutaVolver(fd);
  const c = await contexto(fd, accion, volver);
  const s = await f(c);
  if (s.tipo === 'ok') revalidatePath('/[org]/[campana]/bots', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo));
}

async function contexto(fd: FormData, accion: Accion, volver: string) {
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo, nucleo } = await accesoAccion(campanaId, accion, volver);
  return { repo, rol, personaId: persona.id, campanaId, campana: campanaDelNucleo(nucleo, campanaId) ?? { nombre: '', zonaHoraria: 'UTC' } };
}

export async function tomarConversacion(fd: FormData): Promise<void> {
  await correr(fd, 'responder_conversaciones', (c) => ejecutarTomar(c, { conversacionId: texto(fd, 'conversacionId') }));
}

export async function responderConversacion(fd: FormData): Promise<void> {
  await correr(fd, 'responder_conversaciones', (c) => ejecutarResponder(c, { conversacionId: texto(fd, 'conversacionId'), texto: String(fd.get('texto') ?? '') }));
}

export async function devolverConversacion(fd: FormData): Promise<void> {
  await correr(fd, 'responder_conversaciones', (c) => ejecutarDevolver(c, capaMotores(c.repo), { conversacionId: texto(fd, 'conversacionId') }));
}

export async function cerrarConversacion(fd: FormData): Promise<void> {
  await correr(fd, 'responder_conversaciones', (c) => ejecutarCerrar(c, { conversacionId: texto(fd, 'conversacionId') }));
}

export async function revisarRespuesta(fd: FormData): Promise<void> {
  await correr(fd, 'editar_borrador', (c) => ejecutarRevisar(c, {
    conversacionId: texto(fd, 'conversacionId'), n: Number(texto(fd, 'n')), veredicto: texto(fd, 'veredicto'), convertir: texto(fd, 'convertir') === 'si',
  }));
}

export async function borrarContacto(fd: FormData): Promise<void> {
  await correr(fd, 'gestionar_datos_contactos', (c) => ejecutarBorrarContacto(c, { contactoId: texto(fd, 'contactoId'), nota: texto(fd, 'nota'), confirmar: texto(fd, 'confirmar') }));
}

export async function guardarCanalWeb(fd: FormData): Promise<void> {
  await correr(fd, 'configurar_canales', (c) => ejecutarGuardarCanal(c, { botId: texto(fd, 'botId'), activo: texto(fd, 'activo') === 'si', modoCondiciones: texto(fd, 'modoCondiciones') }));
}

export async function publicarCondiciones(fd: FormData): Promise<void> {
  await correr(fd, 'configurar_canales', (c) => ejecutarPublicarCondiciones(c, { botId: texto(fd, 'botId'), texto: String(fd.get('texto') ?? '') }));
}

export async function pausarBot(fd: FormData): Promise<void> {
  await correr(fd, 'publicar', (c) => ejecutarPausar(c, { botId: texto(fd, 'botId'), pausar: texto(fd, 'pausar') === 'si' }));
}
