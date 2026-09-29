'use server';
/**
 * Formularios de WhatsApp (etapa 7): conectar el número, prenderlo o apagarlo, las plantillas y escribir con una
 * plantilla desde la bandeja. Sesión y permiso en el servidor → núcleo sin Next (ejecutar-whatsapp.ts) → repositorio,
 * que en Supabase lo vuelve a exigir en la base. Vuelven con ?ok= o ?error= (y el detalle de 360dialog si hace falta).
 *
 * La clave de 360dialog llega en el formulario, va a 360dialog y a Vault, y no se escribe en ningún registro.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Accion } from '../dominio/permisos';
import { CATEGORIAS_PLANTILLA, type CategoriaPlantilla } from '../dominio/whatsapp';
import { obtenerRepositorioPublico } from '../datos/publico';
import { prepararSimulado } from '../canal-whatsapp/http';
import { clienteWhatsapp, urlPublicaWhatsapp } from '../canal-whatsapp/servidor';
import { rutaVolver, texto } from './comun';
import type { Salida } from './ejecutar-bots';
import {
  ejecutarBorrarPlantilla, ejecutarConectarWhatsapp, ejecutarCrearPlantilla, ejecutarPrenderWhatsapp, ejecutarResponderConPlantilla, ejecutarRevisarPlantillas,
  type ServicioWhatsapp,
} from './ejecutar-whatsapp';
import { accesoAccion, conMensaje } from './mensajes';
import { enviarWhatsappDespues } from './envio';

/** En la demo, la app pública está montada en /publico de esta misma app. */
const BASE_DEMO = '/publico';

function servicio(): ServicioWhatsapp {
  prepararSimulado(BASE_DEMO);
  return { wa: obtenerRepositorioPublico(), cliente: clienteWhatsapp(BASE_DEMO), urlPublica: urlPublicaWhatsapp(BASE_DEMO) };
}

async function correr(fd: FormData, accion: Accion, f: (c: { repo: Awaited<ReturnType<typeof accesoAccion>>['repo']; rol: Awaited<ReturnType<typeof accesoAccion>>['rol']; personaId: string; campanaId: string }) => Promise<Salida>): Promise<never> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, accion, volver);
  const s = await f({ repo, rol, personaId: persona.id, campanaId });
  if (s.tipo === 'ok') revalidatePath('/[org]/[campana]/bots', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo, s.extra ?? {}));
}

export async function conectarWhatsapp(fd: FormData): Promise<void> {
  // La clave no pasa por texto(): se toma una sola vez y no se guarda en ningún lado de esta acción.
  const clave = String(fd.get('clave') ?? '');
  await correr(fd, 'configurar_canales', (c) => ejecutarConectarWhatsapp(c, servicio(), { botId: texto(fd, 'botId'), clave, numero: texto(fd, 'numero') }));
}

export async function prenderWhatsapp(fd: FormData): Promise<void> {
  await correr(fd, 'configurar_canales', (c) => ejecutarPrenderWhatsapp(c, { botId: texto(fd, 'botId'), activo: texto(fd, 'activo') === 'si' }));
}

export async function crearPlantilla(fd: FormData): Promise<void> {
  const categoria = texto(fd, 'categoria');
  const ejemplos: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('ejemplo:')) ejemplos[k.slice(8)] = String(v).trim();
  await correr(fd, 'configurar_canales', (c) => ejecutarCrearPlantilla(c, servicio(), {
    botId: texto(fd, 'botId'),
    plantilla: {
      nombre: texto(fd, 'nombre'), idioma: texto(fd, 'idioma') || 'es', texto: String(fd.get('texto') ?? ''), ejemplos,
      categoria: ((CATEGORIAS_PLANTILLA as readonly string[]).includes(categoria) ? categoria : 'utility') as CategoriaPlantilla,
    },
  }));
}

export async function borrarPlantilla(fd: FormData): Promise<void> {
  await correr(fd, 'configurar_canales', (c) => ejecutarBorrarPlantilla(c, servicio(), { botId: texto(fd, 'botId'), nombre: texto(fd, 'nombre') }));
}

export async function revisarPlantillas(fd: FormData): Promise<void> {
  await correr(fd, 'ver', (c) => ejecutarRevisarPlantillas(c, servicio(), { botId: texto(fd, 'botId') }));
}

export async function responderConPlantilla(fd: FormData): Promise<void> {
  const conversacionId = texto(fd, 'conversacionId');
  const [nombre = '', idioma = 'es'] = texto(fd, 'plantilla').split('|');
  const valores: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('valor:')) valores[k.slice(6)] = String(v);
  enviarWhatsappDespues(conversacionId);
  await correr(fd, 'responder_conversaciones', (c) => ejecutarResponderConPlantilla(c, { conversacionId, nombre, idioma, valores }));
}
