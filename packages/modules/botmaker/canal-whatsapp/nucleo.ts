/**
 * El canal de WhatsApp (etapa 7), de punta a punta y sin Next. Lo usan la app pública (apps/bots-publico) y, en la
 * demo, la app del equipo en /publico.
 *
 *  1. recibirWebhook: el aviso de 360dialog. Verifica el secreto del canal, guarda lo recibido en la cola del canal
 *     (lo repetido se descarta) y contesta enseguida; el proceso va aparte (after() en Next).
 *  2. procesarCanal: toma lo pendiente de la cola, en orden. Los mensajes de las personas los contesta el mismo motor
 *     que la web (atenderWhatsapp); los estados de lo que salió (enviado, entregado, leído, fallido) se anotan.
 *  3. enviarPendientes: manda lo que quedó en la cola de salida, con la clave del canal (Vault). Reintenta con espera
 *     creciente; una clave que dejó de valer desconecta el canal y abre la alerta.
 *
 * Lo mismo lo corre la tarea programada (cada minuto con pg_cron): lo que quedó sin procesar y los reintentos.
 */
import {
  avisoIaPorDefecto, clavesLimite, dentroDeHorarioPorDefecto, entraEnMuestra, evaluarLimites, eventosDeTurno, type Mensaje,
} from '../dominio/conversaciones';
import { exigeAvisoIa } from '../dominio/avisos';
import { validarDefinicion } from '../dominio/definicion';
import { turno, type Entrada } from '../dominio/motor';
import { aWhatsapp, idOpcion, ventanaHasta, type EntranteWhatsapp, type MensajeWhatsapp } from '../dominio/whatsapp';
import { ErrorDatos } from '../datos/errores';
import type { CanalWhatsappPublico, EnvioPendiente, RepositorioPublico, RepositorioWhatsapp, TurnoGuardado } from '../datos/repositorio';
import type { CapaMotores } from '../motores/capa';
import { serviciosDeCapa } from '../motores/servicios';
import { serviciosSinMotor, TEXTO_PAUSA } from '../canal-web/nucleo';
import type { Cliente360 } from './d360';
import { ENCABEZADO_SECRETO } from './d360';
import { idCanalDe, leerAviso, secretoValido } from './webhook';

export type RepoWhatsapp = RepositorioPublico & RepositorioWhatsapp;

export interface EntornoWhatsapp {
  ahora: () => Date;
  /** HMAC con BOTS_HASH_SECRET (el contacto se identifica por el HMAC de su número). */
  hash: (texto: string) => string;
  capa: CapaMotores;
  cliente: Cliente360;
  /** La dirección de la app pública, para el enlace a las condiciones del bot. */
  urlPublica: string;
}

/** Cuánto se espera antes de cada reintento (después del intento 1, 2, 3 y 4); el quinto que falla queda fallido. */
export const ESPERA_REINTENTOS_S = [30, 120, 600, 3600] as const;
export const MAX_INTENTOS = 5;

// ── 1. El aviso ─────────────────────────────────────────────────────────────────────────────────

export interface RespuestaAviso {
  status: number;
  /** Lo que hay que correr después de contestar (null si no hay nada). */
  procesar: (() => Promise<void>) | null;
}

export async function recibirWebhook(
  repo: RepoWhatsapp, entorno: EntornoWhatsapp, idPublico: string, encabezados: Headers, cuerpo: string, inicio: number,
): Promise<RespuestaAviso> {
  if (!/^[a-z0-9]{6,20}$/.test(idPublico)) return { status: 404, procesar: null };
  const canal = await repo.canalWhatsappPublico(idPublico);
  if (!canal) return { status: 404, procesar: null };
  if (!secretoValido(encabezados.get(ENCABEZADO_SECRETO), canal.secretoHash)) return { status: 401, procesar: null };
  // Apagado: se contesta que llegó (así 360dialog no reintenta) y no se guarda nada.
  if (canal.estado === 'apagado') return { status: 200, procesar: null };
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return { status: 400, procesar: null };
  }
  const aviso = leerAviso(json);
  if (!aviso) return { status: 400, procesar: null };
  if (!aviso.entradas.length) return { status: 200, procesar: null };
  const ahora = entorno.ahora();
  const r = await repo.recibirEntradas(canal.id, aviso.entradas, { ahora, demoraMs: Math.max(0, Date.now() - inicio), numero: aviso.numero });
  return { status: 200, procesar: r.nuevas ? async () => { await procesarCanal(repo, entorno, canal); } : null };
}

// ── 2. El proceso ───────────────────────────────────────────────────────────────────────────────

export async function procesarCanal(repo: RepoWhatsapp, entorno: EntornoWhatsapp, canal: CanalWhatsappPublico): Promise<{ procesadas: number; enviados: number }> {
  let procesadas = 0;
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const pendientes = await repo.entradasPendientes(canal.id, 20, entorno.ahora());
    if (!pendientes.length) break;
    for (const e of pendientes) {
      try {
        if (e.tipo === 'mensaje') await atenderWhatsapp(repo, entorno, canal, e.mensaje);
        else await repo.aplicarEstado(canal.id, e.idProveedor, e.estado, e.error, entorno.ahora());
        await repo.entradaProcesada(canal.id, e.clave);
        procesadas++;
      } catch (x) {
        // Queda en la cola: la vuelve a tomar la tarea programada (hasta 5 intentos).
        console.error('[whatsapp] no se pudo procesar una entrada', x instanceof Error ? x.message : x);
      }
    }
  }
  const enviados = await enviarPendientes(repo, entorno, { canalId: canal.id });
  return { procesadas, enviados };
}

/** Lo que dice el bot, listo para guardar y mandar por WhatsApp. */
function saliente(autor: 'bot' | 'sistema', m: { texto: string; cajaId: string | null; opciones?: { letra: string; texto: string; descripcion?: string }[]; modo?: 'botones' | 'lista'; opcionesDe?: string }, trato: 'usted' | 'tu'): TurnoGuardado['salientes'][number] {
  return {
    autor, texto: m.texto, cajaId: m.cajaId,
    datos: m.opciones?.length ? { opciones: m.opciones, modo: m.modo ?? 'botones', ...(m.opcionesDe ? { opcionesDe: m.opcionesDe } : {}) } : null,
    envios: aWhatsapp(m, trato),
  };
}

const CAJA_CONDICIONES = 'condiciones';

function disponible(bp: Awaited<ReturnType<RepositorioPublico['botPublico']>>, canal: CanalWhatsappPublico) {
  return !!bp && !!bp.version && !bp.organizacionDemo && canal.estado === 'activo' && (bp.bot.estado === 'publicado' || bp.bot.estado === 'pausado');
}

/** Un mensaje de una persona por WhatsApp: el mismo recorrido que el canal web (canal-web/nucleo.ts), con sus diferencias. */
export async function atenderWhatsapp(repo: RepoWhatsapp, entorno: EntornoWhatsapp, canal: CanalWhatsappPublico, m: EntranteWhatsapp): Promise<void> {
  for (let intento = 1; ; intento++) {
    try {
      return await atender(repo, entorno, canal, m);
    } catch (e) {
      if (e instanceof ErrorDatos && e.codigo === 'conversacion_cambio' && intento < 3) continue;
      if (e instanceof ErrorDatos && e.codigo === 'repetido') return;
      throw e;
    }
  }
}

async function atender(repo: RepoWhatsapp, entorno: EntornoWhatsapp, canal: CanalWhatsappPublico, m: EntranteWhatsapp): Promise<void> {
  const bp = await repo.botPublico(canal.idPublico);
  if (!disponible(bp, canal)) return;
  const v = validarDefinicion(bp!.version!.definicion);
  if (!v.ok) return;
  const def = v.definicion;
  const bot = bp!.bot;
  const version = bp!.version!;
  const ahora = entorno.ahora();
  const iso = ahora.toISOString();
  const contactoHash = entorno.hash(`contacto:${bot.id}:wa:${m.de}`);
  // Sin IP ni verificación anti-robots: WhatsApp ya verificó el número. Quedan los límites por contacto y por bot.
  const claves = clavesLimite({ ipHash: '-', contactoHash, botId: bot.id }).filter((c) => !c.clave.startsWith('ip:'));
  const limites = evaluarLimites(claves, await repo.contar(claves, ahora));

  const { conversacion: c, contacto, nueva } = await repo.abrirConversacion({ botId: bot.id, contactoHash, canal: 'whatsapp', verificadoAhora: true, ahora });
  if (contacto.telefono !== m.de || (m.nombrePerfil && contacto.nombrePerfil !== m.nombrePerfil)) await repo.guardarTelefono(contacto.id, m.de, m.nombrePerfil ?? contacto.nombrePerfil ?? null);

  // Un reintento que ya se contestó (llegó dos veces antes de marcarse): nada más.
  const idCanal = idCanalDe(m.id);
  if (await repo.mensajePorIdCanal(c.id, idCanal)) return;

  const trato = bot.trato;
  const ventana = ventanaHasta(m.hora);
  const entrante: TurnoGuardado['entrante'] = m.entrada.tipo === 'opcion'
    ? { tipo: 'opcion', texto: m.texto, datos: { letra: m.entrada.letra, opcionesDe: m.entrada.cajaId }, idCanal }
    : { tipo: 'texto', texto: m.texto, datos: null, idCanal };
  const eventoTexto = m.entrada.tipo === 'texto' ? [{ nombre: 'texto_recibido' as const, cajaId: null, datos: { largo: m.texto.length, tipo: m.tipo === 'adjunto' ? m.texto.replace(/[[\]]/g, '') : 'texto' } }] : [];

  // Condiciones: con "acepto", un botón antes de empezar; con "aviso", el primer mensaje trae la dirección.
  const cond = bp!.condiciones;
  const aceptadas = !!cond && contacto.condicionesVersion === cond.numero;
  const tocaAceptar = m.entrada.tipo === 'opcion' && m.entrada.cajaId === CAJA_CONDICIONES;
  const urlCondiciones = `${entorno.urlPublica}/b/${bot.idPublico}/condiciones`;
  let entrada: Entrada = m.entrada;
  if (tocaAceptar) {
    if (cond && !aceptadas) await repo.aceptarCondiciones(contacto.id, cond.numero, ahora);
    entrada = { tipo: 'inicio' };
  } else if (cond && !aceptadas && bp!.canal.modoCondiciones === 'acepto') {
    const pedido = trato === 'usted'
      ? `Antes de empezar, lea las condiciones de este asistente: ${urlCondiciones}`
      : `Antes de empezar, leé las condiciones de este asistente: ${urlCondiciones}`;
    await repo.guardarTurno(c.id, c.seq, {
      entrante, salientes: [saliente('sistema', { texto: pedido, cajaId: null, opciones: [{ letra: 'A', texto: 'Acepto' }], modo: 'botones', opcionesDe: CAJA_CONDICIONES }, trato)],
      decision: null, sesion: c.sesion, estado: c.estado, cajaActual: c.cajaActual, versionId: version.id, eventos: eventoTexto,
      derivacion: null, datosContacto: {}, muestra: false, ahora: iso, ventanaHasta: ventana,
    });
    return;
  } else if (cond && !aceptadas && bp!.canal.modoCondiciones === 'aviso') {
    await repo.aceptarCondiciones(contacto.id, cond.numero, ahora);
  }

  // Bot en pausa o conversación en manos del equipo: se guarda el mensaje y el bot no contesta.
  if (bot.estado === 'pausado' || c.estado === 'derivada' || c.estado === 'en_atencion') {
    const aviso = bot.estado === 'pausado' && c.estado === 'bot';
    await repo.guardarTurno(c.id, c.seq, {
      entrante: tocaAceptar ? null : entrante, salientes: aviso ? [saliente('sistema', { texto: TEXTO_PAUSA, cajaId: null }, trato)] : [], decision: null,
      sesion: { ...c.sesion, estado: 'derivada', espera: null }, estado: c.estado === 'bot' ? 'derivada' : c.estado, cajaActual: c.cajaActual, versionId: c.versionId,
      eventos: eventoTexto, derivacion: aviso ? { motivo: 'Bot en pausa', cajaId: null } : null, datosContacto: {}, muestra: false, ahora: iso, ventanaHasta: ventana,
    });
    return;
  }

  const soloMenus = limites.soloMenus;
  const dentro = () => dentroDeHorarioPorDefecto(ahora, bp!.campana.zonaHoraria);
  const servicios = soloMenus
    ? serviciosSinMotor(def, dentro)
    : serviciosDeCapa(entorno.capa, { bot, campana: bp!.campana, definicion: def, uso: 'en_vivo', personaId: null, dentroDeHorario: dentro });
  const r = await turno(def, c.sesion, entrada, servicios);

  const salientes = r.mensajes.map((x) => saliente('bot', x, trato));
  // El primer mensaje de una conversación nueva: el aviso de IA si algún motor lo exige, y las condiciones.
  if (nueva || c.seq === 0) {
    const [motores, fichas] = await Promise.all([repo.motoresDeBot(bot.id), repo.fichas()]);
    const partes = [
      exigeAvisoIa(motores, fichas) ? bot.avisoIa.trim() || avisoIaPorDefecto(trato) : '',
      cond ? `Condiciones del asistente: ${urlCondiciones}` : '',
    ].filter(Boolean);
    if (partes.length) salientes.unshift(saliente('sistema', { texto: partes.join('\n\n'), cajaId: null }, trato));
  }
  const derivada = r.eventos.find((e) => e.nombre === 'derivada');
  const datosContacto = Object.fromEntries(Object.entries(r.sesion.variables).filter(([k, val]) => k.startsWith('contacto.') && c.sesion.variables[k] !== val));
  const conBase = !!r.decision.secciones?.length;
  const sorteo = parseInt(entorno.hash(`muestra:${c.id}:${c.seq}`).slice(0, 8), 16) / 0x100000000;
  await repo.guardarTurno(c.id, c.seq, {
    entrante: tocaAceptar ? null : entrante, salientes, decision: r.decision, sesion: r.sesion, estado: r.sesion.estado === 'derivada' ? 'derivada' : 'bot',
    cajaActual: r.decision.recorrido.at(-1) ?? c.cajaActual, versionId: version.id,
    eventos: [...(tocaAceptar ? [{ nombre: 'condiciones_aceptadas' as const, cajaId: null, datos: {} }] : []), ...eventosDeTurno({ entrada, eventos: r.eventos, decision: r.decision, soloMenus }).filter((e) => e.nombre !== 'texto_recibido'), ...eventoTexto],
    derivacion: derivada ? { motivo: String(derivada.datos?.motivo ?? ''), cajaId: derivada.cajaId ?? null } : null,
    datosContacto, muestra: conBase && entraEnMuestra(bp!.publicadoDesde, ahora, sorteo), ahora: iso, ventanaHasta: ventana,
  });
}

// ── 3. El envío ─────────────────────────────────────────────────────────────────────────────────

/** Manda lo pendiente (de un canal o de una conversación). Devuelve cuántos salieron. */
export async function enviarPendientes(repo: RepoWhatsapp, entorno: Pick<EntornoWhatsapp, 'ahora' | 'cliente'>, f: { canalId?: string; conversacionId?: string }): Promise<number> {
  let enviados = 0;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const ahora = entorno.ahora();
    const envios = await repo.tomarEnvios(f, ahora, 50);
    if (!envios.length) break;
    const claves = new Map<string, string | null>();
    /** Una conversación con un envío que espera: los siguientes esperan también (el orden no se rompe). */
    const demoradas = new Map<string, string>();
    for (const e of envios) {
      if (!claves.has(e.canalId)) claves.set(e.canalId, await repo.claveWhatsapp(e.canalId));
      const clave = claves.get(e.canalId);
      const demora = demoradas.get(e.conversacionId);
      if (demora) {
        await repo.resultadoEnvio(e.id, { tipo: 'reintentar', error: 'Espera al mensaje anterior.', en: demora }, ahora);
        continue;
      }
      if (!clave) {
        await repo.resultadoEnvio(e.id, { tipo: 'fallido', error: 'El canal no tiene una clave que funcione.' }, ahora);
        continue;
      }
      if (!e.direccion) {
        await repo.resultadoEnvio(e.id, { tipo: 'fallido', error: 'Sin número: se borraron los datos del contacto.' }, ahora);
        continue;
      }
      const r = await entorno.cliente.enviar(clave, e.direccion, e.mensaje);
      if (r.ok) {
        await repo.resultadoEnvio(e.id, { tipo: 'enviado', idProveedor: r.valor }, ahora);
        enviados++;
      } else if (r.error === 'clave_invalida') {
        await repo.canalDesconectado(e.canalId, r.detalle, ahora);
        await repo.resultadoEnvio(e.id, { tipo: 'fallido', error: `La clave de 360dialog no vale: ${r.detalle}` }, ahora);
        claves.set(e.canalId, null);
      } else if (r.error === 'reintentar' && e.intentos < MAX_INTENTOS) {
        const en = new Date(ahora.getTime() + ESPERA_REINTENTOS_S[Math.min(e.intentos, ESPERA_REINTENTOS_S.length) - 1]! * 1000).toISOString();
        await repo.resultadoEnvio(e.id, { tipo: 'reintentar', error: r.detalle, en }, ahora);
        demoradas.set(e.conversacionId, en);
      } else {
        await repo.resultadoEnvio(e.id, { tipo: 'fallido', error: r.detalle }, ahora);
      }
    }
    if (envios.length < 50) break;
  }
  return enviados;
}

// ── La tarea programada ─────────────────────────────────────────────────────────────────────────

/** Lo que corre la tarea programada: entradas que quedaron sin procesar, reintentos y el estado de las plantillas. */
export async function tareasWhatsapp(repo: RepoWhatsapp, entorno: EntornoWhatsapp): Promise<{ canales: number; procesadas: number; enviados: number; plantillas: number }> {
  const ahora = entorno.ahora();
  let procesadas = 0;
  let enviados = 0;
  const canales = await repo.canalesConPendientes(ahora);
  for (const canalId of canales) {
    const canal = await repo.canalWhatsappPorId(canalId);
    if (!canal) continue;
    const r = await procesarCanal(repo, entorno, canal);
    procesadas += r.procesadas;
    enviados += r.enviados;
  }
  let plantillas = 0;
  for (const canalId of await repo.canalesParaRevisarPlantillas(ahora)) {
    if (await sincronizarPlantillas(repo, entorno, canalId)) plantillas++;
  }
  return { canales: canales.length, procesadas, enviados, plantillas };
}

/** Vuelve a leer las plantillas de la cuenta en 360dialog (360dialog no avisa cuando Meta las aprueba). */
export async function sincronizarPlantillas(repo: RepoWhatsapp, entorno: Pick<EntornoWhatsapp, 'ahora' | 'cliente'>, canalId: string): Promise<boolean> {
  const clave = await repo.claveWhatsapp(canalId);
  if (!clave) return false;
  const r = await entorno.cliente.plantillas(clave);
  if (!r.ok) {
    if (r.error === 'clave_invalida') await repo.canalDesconectado(canalId, r.detalle, entorno.ahora());
    return false;
  }
  await repo.sincronizarPlantillas(canalId, r.valor, entorno.ahora());
  return true;
}

/** Para las pruebas y la bandeja: el id de un botón de las condiciones. */
export const ID_ACEPTO = idOpcion(CAJA_CONDICIONES, 'A');

export type { EnvioPendiente, Mensaje, MensajeWhatsapp };
