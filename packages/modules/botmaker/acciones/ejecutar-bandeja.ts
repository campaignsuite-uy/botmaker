/**
 * Núcleo de la bandeja (etapa 6) y de los ajustes del canal web (etapa 5), sin Next. Cada acción exige su permiso con el
 * rol que resuelve el servidor y el repositorio lo vuelve a exigir (en Supabase, la base).
 *
 *  - Tomar, responder como la campaña, devolver al bot y cerrar: responder_conversaciones (administrador y agente).
 *  - Revisar una respuesta con base de la muestra y convertirla en contenido: editar_borrador.
 *  - Exportar y borrar los datos de un contacto: gestionar_datos_contactos (administrador).
 *  - Canal web y condiciones: configurar_canales. Pausar y reanudar el bot: publicar.
 *  - Tareas de fondo (alertas y borrado por vencimiento): sin persona, con la clave del cron.
 */
import { ErrorDatos } from '../datos/errores';
import type { RepositorioTareas } from '../datos/repositorio';
import { dentroDeHorarioPorDefecto, eventosDeTurno, MODOS_CONDICIONES, type ModoCondiciones } from '../dominio/conversaciones';
import { validarDefinicion } from '../dominio/definicion';
import { devolverAlBot } from '../dominio/motor';
import { aWhatsapp } from '../dominio/whatsapp';
import { puede, type Accion } from '../dominio/permisos';
import type { CapaMotores } from '../motores/capa';
import { serviciosDeCapa } from '../motores/servicios';
import type { ContextoNucleo, Salida } from './ejecutar-bots';
import { ejecutarCambio } from './ejecutar-borrador';

const deError = (x: unknown): Salida => ({ tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' });

async function conversacionDeCampana(c: ContextoNucleo, id: string, accion: Accion) {
  if (!puede(c.rol, accion)) return { ok: false as const, codigo: 'sin_permiso' };
  const x = await c.repo.conversacion(id);
  if (!x || x.conversacion.campanaId !== c.campanaId) return { ok: false as const, codigo: 'no_existe' };
  return { ok: true as const, x };
}

export async function ejecutarTomar(c: ContextoNucleo, e: { conversacionId: string }): Promise<Salida> {
  const r = await conversacionDeCampana(c, e.conversacionId, 'responder_conversaciones');
  if (!r.ok) return { tipo: 'error', codigo: r.codigo };
  try {
    await c.repo.tomarConversacion(e.conversacionId, c.personaId);
    return { tipo: 'ok', codigo: 'conversacion_tomada' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarResponder(c: ContextoNucleo, e: { conversacionId: string; texto: string }): Promise<Salida> {
  const r = await conversacionDeCampana(c, e.conversacionId, 'responder_conversaciones');
  if (!r.ok) return { tipo: 'error', codigo: r.codigo };
  const texto = e.texto.trim();
  if (!texto) return { tipo: 'error', codigo: 'respuesta_vacia' };
  if (texto.length > 4096) return { tipo: 'error', codigo: 'respuesta_larga' };
  try {
    await c.repo.responderConversacion(e.conversacionId, texto, c.personaId);
    return { tipo: 'ok', codigo: 'respuesta_enviada' };
  } catch (x) {
    return deError(x);
  }
}

/**
 * Devolver al bot: el motor sigue desde la salida "al volver" de la caja de derivación, con la versión publicada. Lo que
 * diga el bot al volver le llega a la persona como cualquier mensaje.
 */
export async function ejecutarDevolver(c: ContextoNucleo & { campana: { nombre: string; zonaHoraria?: string } }, capa: CapaMotores, e: { conversacionId: string }): Promise<Salida> {
  const r = await conversacionDeCampana(c, e.conversacionId, 'responder_conversaciones');
  if (!r.ok) return { tipo: 'error', codigo: r.codigo };
  const conv = r.x.conversacion;
  if (conv.estado !== 'derivada' && conv.estado !== 'en_atencion') return { tipo: 'error', codigo: 'no_derivada' };
  const bot = await c.repo.bot(conv.botId);
  if (!bot) return { tipo: 'error', codigo: 'no_existe' };
  const v = bot.versionPublicadaId ? await c.repo.version(bot.versionPublicadaId) : null;
  const d = v ? validarDefinicion(v.definicion) : null;
  if (!d?.ok) return { tipo: 'error', codigo: 'sin_publicada' };
  const zona = c.campana.zonaHoraria ?? 'UTC';
  const t = await devolverAlBot(d.definicion, conv.sesion, conv.cajaDerivacion ?? '', serviciosDeCapa(capa, {
    bot, campana: c.campana, definicion: d.definicion, uso: 'en_vivo', personaId: null, dentroDeHorario: () => dentroDeHorarioPorDefecto(new Date(), zona),
  }));
  try {
    await c.repo.devolverConversacion(e.conversacionId, {
      mensajes: t.mensajes.map((m) => ({
        texto: m.texto, cajaId: m.cajaId, datos: m.opciones?.length ? { opciones: m.opciones, modo: m.modo ?? 'botones', ...(m.opcionesDe ? { opcionesDe: m.opcionesDe } : {}) } : null,
        ...(conv.canal === 'whatsapp' ? { envios: aWhatsapp(m, bot.trato) } : {}),
      })),
      sesion: t.sesion, decision: t.decision, cajaActual: t.decision.recorrido.at(-1) ?? null,
      eventos: eventosDeTurno({ entrada: { tipo: 'inicio' }, eventos: t.eventos, decision: t.decision, soloMenus: false }),
    }, c.personaId);
    return { tipo: 'ok', codigo: 'conversacion_devuelta' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarCerrar(c: ContextoNucleo, e: { conversacionId: string }): Promise<Salida> {
  const r = await conversacionDeCampana(c, e.conversacionId, 'responder_conversaciones');
  if (!r.ok) return { tipo: 'error', codigo: r.codigo };
  try {
    await c.repo.cerrarConversacion(e.conversacionId, c.personaId);
    return { tipo: 'ok', codigo: 'conversacion_cerrada' };
  } catch (x) {
    return deError(x);
  }
}

/**
 * Revisión por muestreo: correcta o incorrecta. Una correcta se puede convertir en contenido fijo: queda como un
 * contenido nuevo del borrador (un cambio que se deshace), para usarlo en una caja.
 */
export async function ejecutarRevisar(c: ContextoNucleo, e: { conversacionId: string; n: number; veredicto: string; convertir: boolean }): Promise<Salida> {
  const r = await conversacionDeCampana(c, e.conversacionId, 'editar_borrador');
  if (!r.ok) return { tipo: 'error', codigo: r.codigo };
  if (e.veredicto !== 'correcta' && e.veredicto !== 'incorrecta') return { tipo: 'error', codigo: 'datos' };
  const m = r.x.mensajes.find((x) => x.n === e.n);
  if (!m?.muestra) return { tipo: 'error', codigo: 'no_muestra' };
  const convertir = e.convertir && e.veredicto === 'correcta';
  try {
    if (convertir) {
      if (!m.texto) return { tipo: 'error', codigo: 'texto_borrado' };
      const bot = await c.repo.bot(r.x.conversacion.botId);
      if (!bot) return { tipo: 'error', codigo: 'no_existe' };
      await c.repo.crearBorrador(bot.id, null, c.personaId);
      const borrador = await c.repo.borrador(bot.id);
      const pregunta = [...r.x.mensajes].reverse().find((x) => x.n < m.n && x.autor === 'contacto')?.texto ?? 'Respuesta revisada';
      const nombre = `Revisada: ${pregunta}`.replace(/\s+/g, ' ').slice(0, 60);
      const cambio = await ejecutarCambio(c, { botId: bot.id, seq: borrador?.seq ?? 0, operaciones: [{ tipo: 'agregar_contenido', contenido: { nombre, texto: m.texto } }], origen: 'editor' });
      if (!cambio.ok) return { tipo: 'error', codigo: cambio.codigo };
    }
    await c.repo.revisarRespuesta(e.conversacionId, e.n, e.veredicto, convertir, c.personaId);
    return { tipo: 'ok', codigo: convertir ? 'respuesta_convertida' : 'respuesta_revisada' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarExportarContacto(c: ContextoNucleo, e: { contactoId: string }) {
  if (!puede(c.rol, 'gestionar_datos_contactos')) return { tipo: 'error' as const, codigo: 'sin_permiso' };
  try {
    const x = await c.repo.exportarContacto(e.contactoId, c.personaId);
    if (x.contacto.campanaId !== c.campanaId) return { tipo: 'error' as const, codigo: 'no_existe' };
    return { tipo: 'ok' as const, codigo: 'contacto_exportado', datos: x };
  } catch (x) {
    return { tipo: 'error' as const, codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' };
  }
}

export async function ejecutarBorrarContacto(c: ContextoNucleo, e: { contactoId: string; nota: string; confirmar: string }): Promise<Salida> {
  if (!puede(c.rol, 'gestionar_datos_contactos')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (e.confirmar !== 'BORRAR') return { tipo: 'error', codigo: 'confirmar_borrado' };
  try {
    const encontrado = (await c.repo.buscarContactos(c.campanaId, e.contactoId, c.personaId)).find((x) => x.contacto.id === e.contactoId);
    if (!encontrado) return { tipo: 'error', codigo: 'no_existe' };
    await c.repo.borrarContacto(e.contactoId, e.nota.trim().slice(0, 500), c.personaId);
    return { tipo: 'ok', codigo: 'contacto_borrado' };
  } catch (x) {
    return deError(x);
  }
}

// ── Canal web, condiciones y pausa ──────────────────────────────────────────────────────────────

async function botDeCampana(c: ContextoNucleo, botId: string) {
  const b = await c.repo.bot(botId);
  return b && b.campanaId === c.campanaId ? b : null;
}

export async function ejecutarGuardarCanal(c: ContextoNucleo, e: { botId: string; activo: boolean; modoCondiciones: string }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  if (!(MODOS_CONDICIONES as readonly string[]).includes(e.modoCondiciones)) return { tipo: 'error', codigo: 'datos' };
  try {
    await c.repo.guardarCanalWeb(e.botId, { activo: e.activo, modoCondiciones: e.modoCondiciones as ModoCondiciones }, c.personaId);
    return { tipo: 'ok', codigo: 'canal_guardado' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarPublicarCondiciones(c: ContextoNucleo, e: { botId: string; texto: string }): Promise<Salida> {
  if (!puede(c.rol, 'configurar_canales')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  const texto = e.texto.trim();
  if (!texto) return { tipo: 'error', codigo: 'condiciones_vacias' };
  if (texto.length > 20000) return { tipo: 'error', codigo: 'condiciones_largas' };
  try {
    const actuales = await c.repo.condiciones(e.botId);
    if (actuales[0]?.texto === texto) return { tipo: 'error', codigo: 'condiciones_iguales' };
    await c.repo.publicarCondiciones(e.botId, texto, c.personaId);
    return { tipo: 'ok', codigo: 'condiciones_publicadas' };
  } catch (x) {
    return deError(x);
  }
}

export async function ejecutarPausar(c: ContextoNucleo, e: { botId: string; pausar: boolean }): Promise<Salida> {
  if (!puede(c.rol, 'publicar')) return { tipo: 'error', codigo: 'sin_permiso' };
  if (!(await botDeCampana(c, e.botId))) return { tipo: 'error', codigo: 'no_existe' };
  try {
    await c.repo.pausarBot(e.botId, e.pausar, c.personaId);
    return { tipo: 'ok', codigo: e.pausar ? 'bot_pausado' : 'bot_reanudado' };
  } catch (x) {
    return deError(x);
  }
}

// ── Tareas de fondo ─────────────────────────────────────────────────────────────────────────────

/** Lo que corre el cron: abre y cierra alertas, vacía los textos vencidos y suma lo nuevo a la analítica. */
export async function ejecutarTareas(repo: RepositorioTareas, ahora: Date) {
  const alertas = await repo.revisarAlertas(ahora);
  const borrados = await repo.borrarVencidos(ahora);
  const analitica = await repo.agregarAnalitica(ahora);
  return { alertas, borrados, analitica };
}
