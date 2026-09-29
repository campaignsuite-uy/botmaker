'use server';
/**
 * Acciones del borrador que usa el editor sin recargar la página: devuelven el resultado (el borrador como quedó, o el
 * error con su código) en lugar de volver con ?ok= o ?error=. Sesión y permiso en el servidor → núcleo sin Next
 * (ejecutar-borrador.ts) → repositorio, que en Supabase lo vuelve a exigir en la base.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { SinPermiso, SoloLectura } from '../dominio/permisos';
import { contextoAccion, rutaVolver, SinSesion, texto } from './comun';
import {
  ejecutarCambio, ejecutarCrearBorrador, ejecutarDeshacer, ejecutarImportarYaml, type ResultadoBorrador,
} from './ejecutar-borrador';
import { accesoAccion, conMensaje } from './mensajes';

type Contexto = { repo: Awaited<ReturnType<typeof contextoAccion>>['repo']; rol: Awaited<ReturnType<typeof contextoAccion>>['rol']; personaId: string; campanaId: string };

async function contexto(campanaId: string): Promise<Contexto | { ok: false; codigo: string }> {
  try {
    const { persona, rol, repo } = await contextoAccion(campanaId, 'editar_borrador');
    return { repo, rol, personaId: persona.id, campanaId };
  } catch (e) {
    const codigo = e instanceof SinPermiso ? 'sin_permiso' : e instanceof SoloLectura ? 'solo_lectura' : e instanceof SinSesion ? 'sesion' : 'no_se_pudo';
    return { ok: false as const, codigo };
  }
}

export interface PedidoCambio {
  campanaId: string;
  botId: string;
  seq: number;
  operaciones: unknown[];
}

export async function aplicarCambioBorrador(p: PedidoCambio): Promise<ResultadoBorrador> {
  const c = await contexto(String(p.campanaId));
  if ('ok' in c) return c;
  return ejecutarCambio(c, { botId: String(p.botId), seq: Number(p.seq), operaciones: Array.isArray(p.operaciones) ? p.operaciones : [], origen: 'editor' });
}

export async function deshacerCambioBorrador(p: { campanaId: string; botId: string; seq: number; rehacer?: boolean }): Promise<ResultadoBorrador> {
  const c = await contexto(String(p.campanaId));
  if ('ok' in c) return c;
  return ejecutarDeshacer(c, { botId: String(p.botId), seq: Number(p.seq), rehacer: p.rehacer === true });
}

/** Para useActionState: guarda el texto que mandó la persona para no perderlo si hay errores. */
export async function importarYamlBorrador(_previo: unknown, fd: FormData): Promise<ResultadoBorrador & { texto: string }> {
  const t = String(fd.get('yaml') ?? '');
  const c = await contexto(texto(fd, 'campanaId'));
  if ('ok' in c) return { ...c, texto: t };
  const r = await ejecutarImportarYaml(c, { botId: texto(fd, 'botId'), texto: t, igual: texto(fd, 'igual') === 'si' });
  if (r.ok) revalidatePath('/[org]/[campana]/bots', 'layout');
  return { ...r, texto: t };
}

/** Formulario: armar el borrador de un bot que no tiene (con la plantilla o copiando la última versión). */
export async function crearBorrador(fd: FormData): Promise<void> {
  const volver = rutaVolver(fd);
  const campanaId = texto(fd, 'campanaId');
  const { persona, rol, repo } = await accesoAccion(campanaId, 'editar_borrador', volver);
  const s = await ejecutarCrearBorrador({ repo, rol, personaId: persona.id, campanaId }, { botId: texto(fd, 'botId'), candidato: texto(fd, 'candidato'), partido: texto(fd, 'partido') });
  if (s.tipo === 'ok') revalidatePath('/[org]/[campana]/bots', 'layout');
  redirect(conMensaje(volver, s.tipo, s.codigo));
}
