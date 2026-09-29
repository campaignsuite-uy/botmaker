/**
 * Núcleo de lo que hace el equipo con WhatsApp (etapa 7), sin Next. Cada acción exige su permiso con el rol que resuelve
 * el servidor y el repositorio lo vuelve a exigir (en Supabase, la base).
 *
 *  - Conectar el número (configurar_canales): valida la clave con 360dialog, configura el aviso con un secreto nuevo y
 *    guarda la clave en Vault. La clave llega del formulario y no vuelve nunca al navegador.
 *  - Prender o apagar el canal (configurar_canales).
 *  - Plantillas (configurar_canales): crearlas y mandarlas a aprobar, borrarlas; actualizar su estado (ver).
 *  - Escribir con una plantilla (responder_conversaciones): la única forma con la ventana de 24 horas cerrada.
 *
 * Lo que necesita la clave (360dialog) usa el repositorio sin persona (`wa`), como la app pública.
 */
import { randomBytes } from 'node:crypto';
import { ErrorDatos } from '../datos/errores';
import { puede } from '../dominio/permisos';
import {
  claveConForma, completarPlantilla, numeroVisible, problemasPlantilla, variablesDe, type NuevaPlantilla, type Plantilla,
} from '../dominio/whatsapp';
import type { Cliente360, ResultadoCliente } from '../canal-whatsapp/d360';
import { ENCABEZADO_SECRETO } from '../canal-whatsapp/d360';
import { sincronizarPlantillas, type RepoWhatsapp } from '../canal-whatsapp/nucleo';
import { sha256 } from '../canal-whatsapp/webhook';
import type { ContextoNucleo, Salida } from './ejecutar-bots';

export interface ServicioWhatsapp {
  /** El repositorio sin persona (la clave de servicio): lee la clave de Vault para hablar con 360dialog. */
  wa: RepoWhatsapp;
  cliente: Cliente360;
  /** La dirección de la app pública ('/publico' en la demo). */
  urlPublica: string;
}

const deError = (x: unknown): Salida => ({ tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' });

function deCliente(r: Extract<ResultadoCliente<unknown>, { ok: false }>): Salida {
  return { tipo: 'error', codigo: r.error === 'clave_invalida' ? 'clave_invalida' : r.error === 'reintentar' ? 'd360_no_responde' : 'd360_rechazo', extra: { detalle: r.detalle.slice(0, 200) } };
}

async function botDeCampana(c: ContextoNucleo, botId: string) {
  const b = await c.repo.bot(botId);
  return b && b.campanaId === c.campanaId ? b : null;
}

export async function ejecutarConectarWhatsapp(c: ContextoNucleo, s: ServicioWhatsapp, e: { botId: string; clave: string; numero: string }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  const bot = await botDeCampana(c, e.botId);
  if (!bot) return { tipo: 'error', codigo: 'no_existe' };
  if (bot.estado === 'archivado') return { tipo: 'error', codigo: 'archivado' };
  const clave = e.clave.trim();
  if (!claveConForma(clave)) return { tipo: 'error', codigo: 'clave_forma' };
  const numero = e.numero.trim() ? numeroVisible(e.numero) : null;
  if (e.numero.trim() && !numero) return { tipo: 'error', codigo: 'numero_invalido' };
  if (!s.cliente.simulado && !/^https:\/\//.test(s.urlPublica)) return { tipo: 'error', codigo: 'falta_url_publica' };
  const v = await s.cliente.validarClave(clave);
  if (!v.ok) return deCliente(v);
  const secreto = randomBytes(24).toString('base64url');
  const webhookUrl = `${s.urlPublica}/api/whatsapp/${bot.idPublico}`;
  const w = await s.cliente.configurarWebhook(clave, webhookUrl, { [ENCABEZADO_SECRETO]: secreto });
  if (!w.ok) return deCliente(w);
  try {
    const canalId = await c.repo.conectarWhatsapp(bot.id, { clave, numero, secretoHash: sha256(secreto), webhookUrl }, c.personaId);
    // Las plantillas de la cuenta, para tenerlas a mano (si no se puede ahora, las lee la tarea programada).
    await sincronizarPlantillas(s.wa, { ahora: () => new Date(), cliente: s.cliente }, canalId).catch(() => false);
    return { tipo: 'ok', codigo: 'whatsapp_conectado' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarPrenderWhatsapp(c: ContextoNucleo, e: { botId: string; activo: boolean }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  try {
    await c.repo.prenderWhatsapp(e.botId, e.activo, c.personaId);
    return { tipo: 'ok', codigo: e.activo ? 'whatsapp_prendido' : 'whatsapp_apagado' };
  } catch (x) {
    return deError(x);
  }
}

async function claveDelCanal(c: ContextoNucleo, s: ServicioWhatsapp, botId: string): Promise<{ canalId: string; clave: string } | Salida> {
  const canal = await c.repo.canalWhatsapp(botId);
  if (!canal) return { tipo: 'error', codigo: 'sin_canal' };
  const clave = await s.wa.claveWhatsapp(canal.id);
  if (!clave) return { tipo: 'error', codigo: 'canal_desconectado' };
  return { canalId: canal.id, clave };
}

export async function ejecutarCrearPlantilla(c: ContextoNucleo, s: ServicioWhatsapp, e: { botId: string; plantilla: NuevaPlantilla }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  const n = { ...e.plantilla, nombre: e.plantilla.nombre.trim(), texto: e.plantilla.texto.trim() };
  const problemas = problemasPlantilla(n);
  if (problemas.length) return { tipo: 'error', codigo: 'plantilla_datos', extra: { detalle: problemas[0]! } };
  const k = await claveDelCanal(c, s, e.botId);
  if ('tipo' in k) return k;
  if ((await c.repo.plantillas(e.botId)).some((p) => p.nombre === n.nombre && p.idioma === n.idioma)) return { tipo: 'error', codigo: 'plantilla_repetida' };
  const r = await s.cliente.crearPlantilla(k.clave, n);
  if (!r.ok) return deCliente(r);
  const { formato, variables } = variablesDe(n.texto);
  const p: Plantilla = {
    id: r.valor.id, nombre: n.nombre, idioma: n.idioma, categoria: n.categoria, estado: r.valor.estado, motivo: null, texto: n.texto, formato, variables,
    usable: r.valor.estado === 'aprobada', aviso: r.valor.estado === 'aprobada' ? null : 'Meta todavía la está revisando.',
  };
  try {
    await c.repo.guardarPlantillaCreada(e.botId, p, c.personaId);
    return { tipo: 'ok', codigo: 'plantilla_creada' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarBorrarPlantilla(c: ContextoNucleo, s: ServicioWhatsapp, e: { botId: string; nombre: string }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  const k = await claveDelCanal(c, s, e.botId);
  if ('tipo' in k) return k;
  const r = await s.cliente.borrarPlantilla(k.clave, e.nombre);
  if (!r.ok) return deCliente(r);
  try {
    await c.repo.quitarPlantilla(e.botId, e.nombre, c.personaId);
    return { tipo: 'ok', codigo: 'plantilla_borrada' };
  } catch (x) {
    return deError(x);
  }
}

/** Vuelve a leer el estado de las plantillas en 360dialog (Meta las aprueba o rechaza sin avisar). */
export async function ejecutarRevisarPlantillas(c: ContextoNucleo, s: ServicioWhatsapp, e: { botId: string }): Promise<Salida> {
  if (!puede(c.rol, 'ver')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  const k = await claveDelCanal(c, s, e.botId);
  if ('tipo' in k) return k;
  const ok = await sincronizarPlantillas(s.wa, { ahora: () => new Date(), cliente: s.cliente }, k.canalId);
  return ok ? { tipo: 'ok', codigo: 'plantillas_revisadas' } : { tipo: 'error', codigo: 'd360_no_responde' };
}

/** Escribir con una plantilla aprobada, con sus espacios completos. */
export async function ejecutarResponderConPlantilla(c: ContextoNucleo, e: { conversacionId: string; nombre: string; idioma: string; valores: Record<string, string> }): Promise<Salida> {
  if (!puede(c.rol, 'responder_conversaciones')) return { tipo: 'error', codigo: 'sin_permiso' };
  const x = await c.repo.conversacion(e.conversacionId);
  if (!x || x.conversacion.campanaId !== c.campanaId) return { tipo: 'error', codigo: 'no_existe' };
  if (x.conversacion.canal !== 'whatsapp') return { tipo: 'error', codigo: 'canal_no_whatsapp' };
  const pl = (await c.repo.plantillas(x.conversacion.botId)).find((p) => p.nombre === e.nombre && p.idioma === e.idioma);
  if (!pl?.usable) return { tipo: 'error', codigo: 'plantilla_no_usable' };
  const valores = Object.fromEntries(pl.variables.map((v) => [v, (e.valores[v] ?? '').trim().slice(0, 500)]));
  if (pl.variables.some((v) => !valores[v])) return { tipo: 'error', codigo: 'plantilla_incompleta' };
  try {
    await c.repo.responderConPlantilla(e.conversacionId, { nombre: pl.nombre, idioma: pl.idioma, formato: pl.formato, variables: pl.variables, valores, texto: completarPlantilla(pl.texto, valores) }, c.personaId);
    return { tipo: 'ok', codigo: 'plantilla_enviada' };
  } catch (x2) {
    return deError(x2);
  }
}
