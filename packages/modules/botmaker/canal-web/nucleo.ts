/**
 * El canal web (etapa 5): un mensaje del widget o de la página del bot, de punta a punta, sin Next. Lo usa la app pública
 * (apps/bots-publico) y, en la demo, la app del equipo en /publico para probar todo en un solo servidor.
 *
 * Por cada mensaje:
 *  1. El bot tiene que estar publicado (o en pausa) con el canal web prendido; nunca uno de una organización demo.
 *  2. Cuenta el mensaje por IP, por contacto y por bot. Pasarse de un límite deja la conversación en solo menús (sin
 *     llamar a ningún motor); el límite duro por IP corta con 429.
 *  3. Abre la conversación del contacto (o sigue la que tiene). La verificación anti-robots se hace al cargar la página;
 *     sin verificación, solo menús.
 *  4. Condiciones: con "aviso", seguir es aceptar; con "acepto", un botón antes de empezar.
 *  5. Si la conversación está derivada o en atención, o el bot en pausa, guarda el mensaje para el equipo y no contesta.
 *  6. Si no, el motor de conversación contesta con la versión publicada (la conversación sigue en su caja aunque se
 *     publique otra) y se guarda el turno entero: mensajes, decisión, sesión y eventos sin textos.
 */
import { z } from 'zod';
import { validarDefinicion, type Definicion } from '../dominio/definicion';
import {
  avisoIaPorDefecto, clavesLimite, dentroDeHorarioPorDefecto, entraEnMuestra, evaluarLimites, eventosDeTurno, type Contacto, type Conversacion,
  type EstadoConversacion, type Mensaje,
} from '../dominio/conversaciones';
import { exigeAvisoIa } from '../dominio/avisos';
import { turno, type Entrada, type MensajeSalida, type Servicios } from '../dominio/motor';
import { ErrorDatos } from '../datos/errores';
import type { BotPublico, RepositorioPublico, TurnoGuardado } from '../datos/repositorio';
import type { CapaMotores } from '../motores/capa';
import { serviciosDeCapa } from '../motores/servicios';

export interface EntornoWeb {
  ahora: () => Date;
  ip: string;
  /** HMAC con BOTS_HASH_SECRET: el mismo valor de entrada da siempre el mismo resultado y no se puede revertir. */
  hash: (texto: string) => string;
  /** Verificación anti-robots (Turnstile) de un token del navegador. */
  verificar: (token: string, ip: string) => Promise<boolean>;
  /** ¿Hay verificación configurada? Sin ella (desarrollo, demo), toda conversación cuenta como verificada. */
  verificacionConfigurada: boolean;
  capa: CapaMotores;
}

const idPublico = z.string().regex(/^[a-z0-9]{6,20}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const esquemaPedidoWeb = z.object({
  bot: idPublico,
  contacto: token,
  canal: z.enum(['web', 'landing']),
  /** Id del mensaje que arma el navegador: un reintento no se duplica. */
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  entrada: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('inicio') }),
    z.object({ tipo: z.literal('texto'), texto: z.string().trim().min(1).max(2000) }),
    z.object({ tipo: z.literal('opcion'), cajaId: z.string().max(40), letra: z.string().max(3), titulo: z.string().max(200) }),
    z.object({ tipo: z.literal('aceptar'), numero: z.number().int().min(1) }),
  ]),
  verificacion: z.string().min(1).max(4000).optional(),
});
export type PedidoWeb = z.infer<typeof esquemaPedidoWeb>;

export const esquemaConsultaWeb = z.object({ bot: idPublico, contacto: token, desde: z.coerce.number().int().min(0).max(1_000_000) });

export interface MensajePublico {
  n: number;
  autor: Mensaje['autor'];
  texto: string;
  opciones?: { letra: string; texto: string; descripcion?: string }[];
  modo?: 'botones' | 'lista';
  opcionesDe?: string;
  enlace?: 'condiciones';
}

export type RespuestaWeb =
  | {
    ok: true;
    estado: EstadoConversacion | 'nueva';
    mensajes: MensajePublico[];
    /** El número del último mensaje de la conversación (para pedir lo nuevo desde ahí). */
    ultimo: number;
    soloMenus: boolean;
    /** Hay que aceptar las condiciones antes de seguir (modo "acepto"). */
    pedirCondiciones: number | null;
  }
  | { ok: false; codigo: 'no_disponible' | 'datos' | 'demasiados' | 'no_se_pudo'; status: number };

const CAJA_CONDICIONES = 'condiciones';

const publico = (m: Mensaje): MensajePublico | null => {
  if (m.texto === null) return null;
  const d = m.datos ?? {};
  return {
    n: m.n, autor: m.autor, texto: m.texto,
    ...(d.opciones?.length ? { opciones: d.opciones, modo: d.modo ?? 'botones', opcionesDe: d.opcionesDe } : {}),
    ...(d.enlace === 'condiciones' ? { enlace: 'condiciones' as const } : {}),
  };
};
const salida = (m: MensajeSalida): TurnoGuardado['salientes'][number] => ({
  autor: 'bot', texto: m.texto, cajaId: m.cajaId,
  datos: m.opciones?.length ? { opciones: m.opciones, modo: m.modo ?? 'botones', ...(m.opcionesDe ? { opcionesDe: m.opcionesDe } : {}) } : null,
});

/** Sin motores: el motor de conversación sigue solo con menús (el aviso sinMotor y las rutas fijas). */
function serviciosSinMotor(def: Definicion, dentro: () => boolean): Servicios {
  return {
    interpretar: async () => ({ salida: null, lectura: null, motorId: null, costoUsd: 0 }),
    responder: async () => ({ salida: null, motorId: null, costoUsd: 0 }),
    material: () => def.material.map((s) => ({ codigo: s.codigo, titulo: s.titulo, texto: s.texto })),
    dentroDeHorario: dentro,
  };
}

const TEXTO_PAUSA = 'El asistente está en pausa en este momento. El equipo de la campaña recibe este mensaje.';

function disponible(bp: BotPublico | null): bp is BotPublico & { version: NonNullable<BotPublico['version']> } {
  return !!bp && !!bp.version && !bp.organizacionDemo && bp.canal.activo && (bp.bot.estado === 'publicado' || bp.bot.estado === 'pausado');
}

export async function atenderMensaje(repo: RepositorioPublico, entorno: EntornoWeb, crudo: unknown): Promise<RespuestaWeb> {
  const p = esquemaPedidoWeb.safeParse(crudo);
  if (!p.success) return { ok: false, codigo: 'datos', status: 400 };
  for (let intento = 1; ; intento++) {
    try {
      return await atender(repo, entorno, p.data);
    } catch (e) {
      // Dos mensajes del mismo contacto a la vez: el segundo vuelve a leer la conversación y contesta sobre lo último.
      if (e instanceof ErrorDatos && e.codigo === 'conversacion_cambio' && intento < 3) continue;
      if (e instanceof ErrorDatos && e.codigo === 'repetido') return atender(repo, entorno, p.data);
      throw e;
    }
  }
}

async function atender(repo: RepositorioPublico, entorno: EntornoWeb, p: PedidoWeb): Promise<RespuestaWeb> {
  const bp = await repo.botPublico(p.bot);
  if (!disponible(bp)) return { ok: false, codigo: 'no_disponible', status: 404 };
  const v = validarDefinicion(bp.version.definicion);
  if (!v.ok) return { ok: false, codigo: 'no_se_pudo', status: 503 };
  const def = v.definicion;
  const bot = bp.bot;
  const ahora = entorno.ahora();
  const iso = ahora.toISOString();
  const contactoHash = entorno.hash(`contacto:${bot.id}:${p.contacto}`);
  const claves = clavesLimite({ ipHash: entorno.hash(`ip:${entorno.ip}`), contactoHash, botId: bot.id });
  const limites = evaluarLimites(claves, await repo.contar(claves, ahora));
  if (limites.cortar) return { ok: false, codigo: 'demasiados', status: 429 };

  const verificadoAhora = !entorno.verificacionConfigurada || (p.verificacion ? await entorno.verificar(p.verificacion, entorno.ip) : false);
  const { conversacion: c, contacto, nueva } = await repo.abrirConversacion({ botId: bot.id, contactoHash, canal: p.canal, verificadoAhora, ahora });

  // Un reintento del navegador: devuelve lo que se contestó la primera vez.
  const ya = await repo.mensajePorIdCanal(c.id, p.id);
  if (ya) return respuesta(c, await repo.mensajes(c.id, ya.n), limites.soloMenus || !c.verificada, null);

  // Volver a abrir la página con una conversación en curso: muestra lo último, sin contestar de nuevo.
  if (p.entrada.tipo === 'inicio' && !nueva && c.seq > 0) return respuesta(c, await repo.mensajes(c.id, Math.max(0, c.seq - 50)), limites.soloMenus || !c.verificada, null);

  // Condiciones.
  const cond = bp.condiciones;
  const aceptadas = !!cond && contacto.condicionesVersion === cond.numero;
  let entrada: Entrada;
  if (p.entrada.tipo === 'aceptar' || (p.entrada.tipo === 'opcion' && p.entrada.cajaId === CAJA_CONDICIONES)) {
    if (cond && !aceptadas) await repo.aceptarCondiciones(contacto.id, cond.numero, ahora);
    entrada = { tipo: 'inicio' };
  } else {
    entrada = p.entrada;
  }
  if (cond && !aceptadas && bp.canal.modoCondiciones === 'acepto' && p.entrada.tipo !== 'aceptar' && !(p.entrada.tipo === 'opcion' && p.entrada.cajaId === CAJA_CONDICIONES)) {
    return {
      ok: true, estado: nueva ? 'nueva' : c.estado, ultimo: c.seq, soloMenus: false, pedirCondiciones: cond.numero,
      mensajes: [{
        n: 0, autor: 'sistema', texto: 'Antes de empezar, lea las condiciones de este asistente. Seguir es aceptarlas.', enlace: 'condiciones',
        opciones: [{ letra: 'A', texto: 'Acepto' }], modo: 'botones', opcionesDe: CAJA_CONDICIONES,
      }],
    };
  }
  if (cond && !aceptadas && bp.canal.modoCondiciones === 'aviso' && entrada.tipo !== 'inicio') await repo.aceptarCondiciones(contacto.id, cond.numero, ahora);

  const entrante: TurnoGuardado['entrante'] = entrada.tipo === 'texto'
    ? { tipo: 'texto', texto: entrada.texto, datos: null, idCanal: p.id }
    : entrada.tipo === 'opcion'
      ? { tipo: 'opcion', texto: entrada.titulo, datos: { letra: entrada.letra, opcionesDe: entrada.cajaId }, idCanal: p.id }
      : null;

  // Bot en pausa o conversación en manos del equipo: se guarda el mensaje y el bot no contesta.
  if (bot.estado === 'pausado' || c.estado === 'derivada' || c.estado === 'en_atencion') {
    if (!entrante) {
      const r = respuesta(c, [], limites.soloMenus, null);
      if (r.ok && bot.estado === 'pausado') r.mensajes.push({ n: 0, autor: 'sistema', texto: TEXTO_PAUSA });
      return r;
    }
    const aviso = bot.estado === 'pausado' && c.estado === 'bot';
    const nuevos = await repo.guardarTurno(c.id, c.seq, {
      entrante, salientes: aviso ? [{ autor: 'sistema', texto: TEXTO_PAUSA, cajaId: null, datos: null }] : [], decision: null,
      sesion: { ...c.sesion, estado: 'derivada', espera: null }, estado: c.estado === 'bot' ? 'derivada' : c.estado, cajaActual: c.cajaActual, versionId: c.versionId,
      eventos: [{ nombre: 'texto_recibido', cajaId: null, datos: { largo: entrante.texto.length, tipo: entrante.tipo } }],
      derivacion: aviso ? { motivo: 'Bot en pausa', cajaId: null } : null, datosContacto: {}, muestra: false, ahora: iso,
    });
    return respuesta({ ...c, estado: c.estado === 'bot' ? 'derivada' : c.estado }, nuevos, limites.soloMenus, null);
  }

  const soloMenus = limites.soloMenus || !c.verificada;
  const dentro = () => dentroDeHorarioPorDefecto(ahora, bp.campana.zonaHoraria);
  const servicios = soloMenus
    ? serviciosSinMotor(def, dentro)
    : serviciosDeCapa(entorno.capa, { bot, campana: bp.campana, definicion: def, uso: 'en_vivo', personaId: null, dentroDeHorario: dentro });
  const r = await turno(def, c.sesion, entrada, servicios);

  const salientes = r.mensajes.map(salida);
  // El primer mensaje de una conversación: el aviso de IA si algún motor lo exige, y las condiciones.
  if (entrada.tipo === 'inicio' && c.seq === 0) {
    const [motores, fichas] = await Promise.all([repo.motoresDeBot(bot.id), repo.fichas()]);
    const partes = [exigeAvisoIa(motores, fichas) ? bot.avisoIa.trim() || avisoIaPorDefecto(bot.trato) : '', cond ? 'Condiciones del asistente.' : ''].filter(Boolean);
    if (partes.length) salientes.unshift({ autor: 'sistema', texto: partes.join(' '), cajaId: null, datos: cond ? { enlace: 'condiciones' } : null });
  }
  const derivada = r.eventos.find((e) => e.nombre === 'derivada');
  const datosContacto = Object.fromEntries(Object.entries(r.sesion.variables).filter(([k, val]) => k.startsWith('contacto.') && c.sesion.variables[k] !== val));
  const conBase = !!r.decision.secciones?.length;
  const sorteo = parseInt(entorno.hash(`muestra:${c.id}:${c.seq}`).slice(0, 8), 16) / 0x100000000;
  const nuevos = await repo.guardarTurno(c.id, c.seq, {
    entrante, salientes, decision: r.decision, sesion: r.sesion, estado: r.sesion.estado === 'derivada' ? 'derivada' : 'bot',
    cajaActual: r.decision.recorrido.at(-1) ?? c.cajaActual, versionId: bp.version.id,
    eventos: eventosDeTurno({ entrada, eventos: r.eventos, decision: r.decision, soloMenus }),
    derivacion: derivada ? { motivo: String(derivada.datos?.motivo ?? ''), cajaId: derivada.cajaId ?? null } : null,
    datosContacto, muestra: conBase && entraEnMuestra(bp.publicadoDesde, ahora, sorteo), ahora: iso,
  });
  return respuesta({ ...c, estado: r.sesion.estado === 'derivada' ? 'derivada' : 'bot', seq: c.seq + nuevos.length }, nuevos, soloMenus, null);
}

function respuesta(c: Pick<Conversacion, 'estado' | 'seq'>, mensajes: Mensaje[], soloMenus: boolean, pedirCondiciones: number | null): RespuestaWeb {
  const ultimo = Math.max(c.seq, ...mensajes.map((m) => m.n));
  return {
    ok: true, estado: c.estado, ultimo, soloMenus, pedirCondiciones,
    mensajes: mensajes.filter((m) => m.autor !== 'contacto').map(publico).filter((m): m is MensajePublico => !!m),
  };
}

/** Lo nuevo de la conversación desde un mensaje (el navegador pregunta cada tanto mientras la atiende el equipo). */
export async function consultarMensajes(repo: RepositorioPublico, entorno: Pick<EntornoWeb, 'hash' | 'ahora' | 'ip'>, crudo: unknown): Promise<RespuestaWeb> {
  const p = esquemaConsultaWeb.safeParse(crudo);
  if (!p.success) return { ok: false, codigo: 'datos', status: 400 };
  const bp = await repo.botPublico(p.data.bot);
  if (!disponible(bp)) return { ok: false, codigo: 'no_disponible', status: 404 };
  const claves = [{ clave: `ip:${entorno.hash(`ip:${entorno.ip}`)}:consultas`, ventanaSegundos: 60, maximo: 120, duro: true }];
  if (evaluarLimites(claves, await repo.contar(claves, entorno.ahora())).cortar) return { ok: false, codigo: 'demasiados', status: 429 };
  const x = await repo.buscarConversacion(bp.bot.id, entorno.hash(`contacto:${bp.bot.id}:${p.data.contacto}`));
  if (!x) return { ok: true, estado: 'nueva', mensajes: [], ultimo: 0, soloMenus: false, pedirCondiciones: null };
  return respuesta(x.conversacion, await repo.mensajes(x.conversacion.id, p.data.desde), false, null);
}

/** Lo que muestra la página del bot antes de conversar: nombre, candidato y condiciones. */
export async function datosPagina(repo: RepositorioPublico, id: string): Promise<{ nombre: string; candidato: string; partido: string | null; trato: 'usted' | 'tu'; condiciones: { numero: number; texto: string } | null; pausado: boolean } | null> {
  if (!idPublico.safeParse(id).success) return null;
  const bp = await repo.botPublico(id);
  if (!disponible(bp)) return null;
  const v = validarDefinicion(bp.version.definicion);
  if (!v.ok) return null;
  return {
    nombre: bp.bot.nombre, candidato: v.definicion.identidad.candidato.nombre, partido: v.definicion.identidad.partido?.nombre ?? null, trato: bp.bot.trato,
    condiciones: bp.condiciones, pausado: bp.bot.estado === 'pausado',
  };
}

export type { Contacto };
