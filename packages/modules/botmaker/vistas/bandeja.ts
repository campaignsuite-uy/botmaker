/**
 * Bandeja (etapa 6): las conversaciones de los bots de la campaña, cada una con el registro de decisiones del bot, y lo
 * que hace el equipo con ellas: tomar, responder como la campaña, devolver al bot y cerrar; la revisión por muestreo de
 * las respuestas con base; y los pedidos sobre los datos de un contacto. Horas en UTC.
 *
 * Leen quienes tienen leer_conversaciones (administrador, editor, agente y el observador de una demo); atienden quienes
 * tienen responder_conversaciones (administrador y agente).
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_TIPO_CAJA, validarDefinicion, type Definicion } from '../dominio/definicion';
import { ETIQUETA_ALERTA, ETIQUETA_CANAL, ETIQUETA_ESTADO_CONVERSACION, ESTADOS_CONVERSACION, type Contacto, type EstadoConversacion, type Mensaje } from '../dominio/conversaciones';
import { fechaHoraUtc, usd } from '../dominio/formato';
import { fichaMotor, type FichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { hrefBot } from './bot-comun';
import { mensajeDe, type MensajePantalla } from './mensajes';
import { ETIQUETA_ESTADO_ENVIO, ventanaAbierta, type EstadoEnvio } from '../dominio/whatsapp';

const corto = (t: string | null, n = 110) => (t === null ? null : t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function nombreContacto(c: Pick<Contacto, 'id' | 'nombre' | 'borradoEn' | 'nombrePerfil'>): string {
  if (c.borradoEn) return 'Contacto borrado';
  return c.nombre || c.nombrePerfil || `Contacto ${c.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;
}

const persona = (ctx: ContextoPantalla, id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien del equipo' : null);

interface Enlaces {
  bandeja: string;
  revision: string | null;
  datos: string | null;
}

function enlaces(ctx: ContextoPantalla): Enlaces {
  return {
    bandeja: ruta(ctx, 'bandeja'),
    revision: puede(ctx.rol, 'leer_conversaciones') ? ruta(ctx, 'bandeja/revision') : null,
    datos: puede(ctx.rol, 'gestionar_datos_contactos') ? ruta(ctx, 'bandeja/datos') : null,
  };
}

// ── Lista ───────────────────────────────────────────────────────────────────────────────────────

export interface VistaBandeja {
  mensaje: MensajePantalla | null;
  enlaces: Enlaces;
  filtros: { bot: string; estado: string; buscar: string; mias: boolean };
  opcionesBot: { valor: string; texto: string }[];
  opcionesEstado: { valor: string; texto: string }[];
  conteos: { estado: EstadoConversacion; texto: string; n: number; href: string }[];
  alertas: { texto: string; bot: string; desde: string; href: string | null }[];
  filas: {
    id: string; href: string; contacto: string; bot: string; canal: string; estado: EstadoConversacion; estadoTexto: string; ultimo: string; ultimoAutor: string;
    fecha: string; asignada: string | null; alerta: boolean;
  }[];
  puedeAtender: boolean;
}

export async function vistaBandeja(repo: Repositorio, ctx: ContextoPantalla): Promise<VistaBandeja> {
  const p = ctx.parametros;
  const estado = p.estado && ([...ESTADOS_CONVERSACION, 'abiertas'] as string[]).includes(p.estado) ? p.estado as EstadoConversacion | 'abiertas' : '';
  const mias = p.mias === 'si';
  const [bots, filas, todas, alertas] = await Promise.all([
    repo.bots(ctx.campana.id, { archivados: true }),
    repo.conversaciones(ctx.campana.id, { botId: p.bot || undefined, estado: estado || undefined, buscar: p.buscar?.slice(0, 80) || undefined, asignadaA: mias ? ctx.persona.id : undefined, limite: 200 }),
    repo.conversaciones(ctx.campana.id, { botId: p.bot || undefined, limite: 2000 }),
    repo.alertas(ctx.campana.id, { abiertas: true }),
  ]);
  const nombreBot = new Map(bots.map((b) => [b.id, b.nombre]));
  const conAlerta = new Set(alertas.filter((a) => a.tipo === 'derivada_sin_respuesta').map((a) => a.ref));
  const autor: Record<Mensaje['autor'], string> = { contacto: 'Contacto', bot: 'Bot', agente: 'Equipo', sistema: 'Aviso' };
  return {
    mensaje: mensajeDe(p),
    enlaces: enlaces(ctx),
    filtros: { bot: p.bot ?? '', estado, buscar: p.buscar ?? '', mias },
    opcionesBot: bots.map((b) => ({ valor: b.id, texto: b.nombre })),
    opcionesEstado: [{ valor: 'abiertas', texto: 'Derivadas y en atención' }, ...ESTADOS_CONVERSACION.map((e) => ({ valor: e, texto: ETIQUETA_ESTADO_CONVERSACION[e] }))],
    conteos: ESTADOS_CONVERSACION.map((e) => ({ estado: e, texto: ETIQUETA_ESTADO_CONVERSACION[e], n: todas.filter((x) => x.conversacion.estado === e).length, href: ruta(ctx, 'bandeja', { estado: e, bot: p.bot || undefined }) })),
    alertas: alertas.map((a) => ({
      texto: ETIQUETA_ALERTA[a.tipo], bot: nombreBot.get(a.botId) ?? 'Bot', desde: fechaHoraUtc(a.abiertaEn),
      href: a.tipo === 'derivada_sin_respuesta' ? ruta(ctx, `bandeja/${encodeURIComponent(a.ref)}`) : null,
    })),
    filas: filas.map((f) => ({
      id: f.conversacion.id, href: ruta(ctx, `bandeja/${encodeURIComponent(f.conversacion.id)}`), contacto: nombreContacto(f.contacto),
      bot: nombreBot.get(f.conversacion.botId) ?? 'Bot', canal: ETIQUETA_CANAL[f.conversacion.canal], estado: f.conversacion.estado,
      estadoTexto: ETIQUETA_ESTADO_CONVERSACION[f.conversacion.estado], ultimo: f.ultimo ? corto(f.ultimo.texto) ?? '(texto borrado)' : '—',
      ultimoAutor: f.ultimo ? autor[f.ultimo.autor] : '', fecha: fechaHoraUtc(f.conversacion.actualizadaEn), asignada: persona(ctx, f.conversacion.asignadaA),
      alerta: conAlerta.has(f.conversacion.id),
    })),
    puedeAtender: puede(ctx.rol, 'responder_conversaciones') && !ctx.organizacion.demo,
  };
}

// ── Una conversación ────────────────────────────────────────────────────────────────────────────

export interface MensajeVista {
  n: number;
  autor: Mensaje['autor'];
  quien: string;
  texto: string | null;
  opciones: string[];
  fecha: string;
  /** El registro de decisiones del bot en ese turno. */
  decision: { etiqueta: string; valor: string }[] | null;
  muestra: boolean;
  /** WhatsApp: cómo va el envío de lo que salió. */
  envio: { estado: EstadoEnvio; texto: string } | null;
  /** Salió con una plantilla. */
  plantilla: string | null;
}

export interface VistaConversacion {
  mensaje: MensajePantalla | null;
  enlaces: Enlaces;
  id: string;
  campanaId: string;
  volver: string;
  contacto: { nombre: string; datos: { etiqueta: string; valor: string }[]; canal: string; condiciones: string; borrado: boolean };
  bot: { nombre: string; href: string };
  estado: EstadoConversacion;
  estadoTexto: string;
  derivacion: string | null;
  asignada: string | null;
  iniciada: string;
  mensajes: MensajeVista[];
  acciones: { tomar: boolean; responder: boolean; devolver: boolean; cerrar: boolean; plantilla: boolean };
  motivoSinAcciones: string | null;
  /** Solo en WhatsApp: la ventana de 24 horas y las plantillas aprobadas para escribir con ella cerrada. */
  whatsapp: {
    ventanaAbierta: boolean;
    ventanaTexto: string;
    plantillas: { valor: string; nombre: string; texto: string; variables: string[] }[];
    hrefPlantillas: string;
  } | null;
}

export function decisionLegible(m: Pick<Mensaje, 'decision'>, def: Definicion | null, version: number | null, fichas: readonly FichaMotor[], verCostos: boolean): { etiqueta: string; valor: string }[] | null {
  const d = m.decision;
  if (!d) return null;
  const caja = (id: string) => {
    for (const f of def?.flujos ?? []) {
      const c = f.cajas.find((x) => x.id === id);
      if (c) return `${f.codigo}.${c.codigo} ${c.nombre || ETIQUETA_TIPO_CAJA[c.tipo]}`;
    }
    return id;
  };
  const intencion = (id: string) => def?.intenciones.find((i) => i.id === id)?.nombre ?? id;
  const tema = (id: string) => def?.temas.find((t) => t.id === id)?.nombre ?? id;
  const filas: { etiqueta: string; valor: string }[] = [];
  if (d.recorrido.length) filas.push({ etiqueta: 'Cajas', valor: d.recorrido.map(caja).join(' → ') });
  const como = d.regla ? `regla (${d.regla})` : d.intencion ? 'texto interpretado' : d.recorrido.length ? 'botón, lista o recorrido fijo' : '—';
  filas.push({ etiqueta: 'Cómo llegó', valor: como });
  if (d.intencion) filas.push({ etiqueta: 'Intención', valor: intencion(d.intencion) });
  if (d.tema) filas.push({ etiqueta: 'Tema', valor: tema(d.tema) });
  if (d.lectura) filas.push({ etiqueta: 'Lecturas', valor: d.lectura.resultado === 'coinciden' ? 'las dos coinciden' : d.lectura.resultado === 'distintas' ? `no coinciden (${d.lectura.principal ?? '—'} / ${d.lectura.respaldo ?? '—'})` : d.lectura.resultado });
  if (d.motor) filas.push({ etiqueta: 'Motor', valor: fichaMotor(d.motor, fichas)?.nombre ?? d.motor });
  if (d.secciones?.length) filas.push({ etiqueta: 'Secciones', valor: d.secciones.join(', ') });
  if (d.corte?.length) filas.push({ etiqueta: 'Cortó el validador', valor: d.corte.join(' · ') });
  if (version !== null) filas.push({ etiqueta: 'Versión', valor: `v${version}` });
  if (verCostos) filas.push({ etiqueta: 'Costo', valor: usd(d.costoUsd) });
  return filas;
}

export async function vistaConversacion(repo: Repositorio, ctx: ContextoPantalla, id: string): Promise<VistaConversacion | null> {
  const x = await repo.conversacion(id);
  if (!x || x.conversacion.campanaId !== ctx.campana.id) return null;
  const c = x.conversacion;
  const [bot, fichas, plantillas] = await Promise.all([repo.bot(c.botId), repo.fichas(), c.canal === 'whatsapp' ? repo.plantillas(c.botId) : Promise.resolve([])]);
  const versiones = new Map<string, { def: Definicion | null; numero: number }>();
  for (const vid of new Set(x.mensajes.map((m) => m.versionId).filter((v): v is string => !!v))) {
    const v = await repo.version(vid);
    const d = v ? validarDefinicion(v.definicion) : null;
    versiones.set(vid, { def: d?.ok ? d.definicion : null, numero: v?.numero ?? 0 });
  }
  const verCostos = puede(ctx.rol, 'ver_costos');
  const atiende = puede(ctx.rol, 'responder_conversaciones') && !ctx.organizacion.demo;
  const abierta = c.estado === 'derivada' || c.estado === 'en_atencion';
  const wa = c.canal === 'whatsapp';
  const ventana = wa && ventanaAbierta(c.ventanaHasta, new Date());
  const quien: Record<Mensaje['autor'], (m: Mensaje) => string> = {
    contacto: () => nombreContacto(x.contacto), bot: () => 'Bot', sistema: () => 'Aviso automático', agente: (m) => persona(ctx, m.personaId) ?? 'Equipo',
  };
  return {
    mensaje: mensajeDe(ctx.parametros),
    enlaces: enlaces(ctx),
    id: c.id,
    campanaId: ctx.campana.id,
    volver: ruta(ctx, `bandeja/${encodeURIComponent(c.id)}`),
    contacto: {
      nombre: nombreContacto(x.contacto),
      datos: [
        // El número solo para quien atiende (en Supabase, la base ni lo devuelve a los demás).
        ...(x.contacto.telefono && puede(ctx.rol, 'responder_conversaciones') ? [{ etiqueta: 'número', valor: `+${x.contacto.telefono}` }] : []),
        ...(x.contacto.nombrePerfil ? [{ etiqueta: 'perfil de WhatsApp', valor: x.contacto.nombrePerfil }] : []),
        ...Object.entries(x.contacto.datos).map(([k, v]) => ({ etiqueta: k.replace(/^contacto\./, ''), valor: v })),
      ],
      canal: ETIQUETA_CANAL[x.contacto.canal],
      condiciones: x.contacto.condicionesVersion ? `aceptó la versión ${x.contacto.condicionesVersion}${x.contacto.condicionesAceptadasEn ? ` el ${fechaHoraUtc(x.contacto.condicionesAceptadasEn)}` : ''}` : 'no aceptó condiciones',
      borrado: !!x.contacto.borradoEn,
    },
    bot: { nombre: bot?.nombre ?? 'Bot', href: hrefBot(ctx, c.botId, 'flujos') },
    estado: c.estado,
    estadoTexto: ETIQUETA_ESTADO_CONVERSACION[c.estado],
    derivacion: c.derivadaEn ? `${c.motivoDerivacion || 'Derivada'} · ${fechaHoraUtc(c.derivadaEn)}` : null,
    asignada: persona(ctx, c.asignadaA),
    iniciada: fechaHoraUtc(c.iniciadaEn),
    mensajes: x.mensajes.map((m) => {
      const v = m.versionId ? versiones.get(m.versionId) : undefined;
      return {
        n: m.n, autor: m.autor, quien: quien[m.autor](m), texto: m.texto, opciones: m.autor !== 'contacto' ? (m.datos?.opciones ?? []).map((o) => o.texto) : [],
        fecha: fechaHoraUtc(m.creadoEn), decision: decisionLegible(m, v?.def ?? null, v ? v.numero : null, fichas, verCostos), muestra: m.muestra,
        envio: m.envio ? { estado: m.envio, texto: ETIQUETA_ESTADO_ENVIO[m.envio] } : null,
        plantilla: typeof (m.datos as { plantilla?: unknown } | null)?.plantilla === 'string' ? String((m.datos as { plantilla: string }).plantilla) : null,
      };
    }),
    acciones: {
      tomar: atiende && c.estado !== 'cerrada' && c.asignadaA !== ctx.persona.id,
      responder: atiende && abierta && (!wa || ventana),
      devolver: atiende && abierta,
      cerrar: atiende && c.estado !== 'cerrada',
      plantilla: atiende && wa && !ventana && c.estado !== 'cerrada',
    },
    motivoSinAcciones: atiende ? null : 'Atienden las conversaciones el administrador y los agentes de BotMaker.',
    whatsapp: wa ? {
      ventanaAbierta: ventana,
      ventanaTexto: ventana
        ? `Ventana de 24 horas abierta hasta el ${fechaHoraUtc(c.ventanaHasta!)}: se le puede escribir libremente.`
        : 'Pasaron más de 24 horas desde su último mensaje: WhatsApp solo deja escribirle con una plantilla aprobada.',
      plantillas: plantillas.filter((p) => p.usable).map((p) => ({ valor: `${p.nombre}|${p.idioma}`, nombre: `${p.nombre} (${p.idioma})`, texto: p.texto, variables: p.variables })),
      hrefPlantillas: hrefBot(ctx, c.botId, 'canales'),
    } : null,
  };
}

// ── Revisión por muestreo ───────────────────────────────────────────────────────────────────────

export interface VistaRevision {
  mensaje: MensajePantalla | null;
  enlaces: Enlaces;
  campanaId: string;
  volver: string;
  soloPendientes: boolean;
  hrefTodas: string;
  hrefPendientes: string;
  puedeRevisar: boolean;
  filas: { conversacion: string; href: string; n: number; bot: string; pregunta: string; respuesta: string; secciones: string; fecha: string; veredicto: string | null; convertida: boolean; revisadaPor: string | null }[];
}

export async function vistaRevision(repo: Repositorio, ctx: ContextoPantalla): Promise<VistaRevision> {
  const pendientes = ctx.parametros.todas !== 'si';
  const [filas, bots] = await Promise.all([repo.muestra(ctx.campana.id, { pendientes, limite: 200 }), repo.bots(ctx.campana.id, { archivados: true })]);
  const nombre = new Map(bots.map((b) => [b.id, b.nombre]));
  return {
    mensaje: mensajeDe(ctx.parametros),
    enlaces: enlaces(ctx),
    campanaId: ctx.campana.id,
    volver: ruta(ctx, 'bandeja/revision', pendientes ? {} : { todas: 'si' }),
    soloPendientes: pendientes,
    hrefTodas: ruta(ctx, 'bandeja/revision', { todas: 'si' }),
    hrefPendientes: ruta(ctx, 'bandeja/revision'),
    puedeRevisar: puede(ctx.rol, 'editar_borrador') && !ctx.organizacion.demo,
    filas: filas.map((f) => ({
      conversacion: f.conversacionId, href: ruta(ctx, `bandeja/${encodeURIComponent(f.conversacionId)}`), n: f.n, bot: nombre.get(f.botId) ?? 'Bot',
      pregunta: f.pregunta ?? '(texto borrado)', respuesta: f.respuesta ?? '(texto borrado)', secciones: f.secciones.join(', ') || '—', fecha: fechaHoraUtc(f.fecha),
      veredicto: f.veredicto === 'correcta' ? 'Correcta' : f.veredicto === 'incorrecta' ? 'Incorrecta' : null, convertida: f.convertida, revisadaPor: persona(ctx, f.revisadaPor),
    })),
  };
}

// ── Datos de un contacto ────────────────────────────────────────────────────────────────────────

export interface VistaDatosContactos {
  mensaje: MensajePantalla | null;
  enlaces: Enlaces;
  campanaId: string;
  volver: string;
  buscar: string;
  resultados: { id: string; nombre: string; datos: string; canal: string; conversaciones: number; ultima: string; hrefExportar: string }[] | null;
  pedidos: { fecha: string; tipo: string; contacto: string; quien: string; nota: string }[];
  puedeBorrar: boolean;
}

export async function vistaDatosContactos(repo: Repositorio, ctx: ContextoPantalla): Promise<VistaDatosContactos> {
  const buscar = (ctx.parametros.buscar ?? '').slice(0, 80);
  const [resultados, pedidos] = await Promise.all([
    buscar.trim().length >= 2 ? repo.buscarContactos(ctx.campana.id, buscar, ctx.persona.id) : Promise.resolve(null),
    repo.pedidosDatos(ctx.campana.id),
  ]);
  const TIPO = { buscar: 'Búsqueda', exportar: 'Exportó los datos', borrar: 'Borró los datos' } as const;
  return {
    mensaje: mensajeDe(ctx.parametros),
    enlaces: enlaces(ctx),
    campanaId: ctx.campana.id,
    volver: ruta(ctx, 'bandeja/datos', buscar ? { buscar } : {}),
    buscar,
    resultados: resultados?.map((r) => ({
      id: r.contacto.id, nombre: nombreContacto(r.contacto), datos: Object.entries(r.contacto.datos).map(([k, v]) => `${k.replace(/^contacto\./, '')}: ${v}`).join(' · ') || '—',
      canal: ETIQUETA_CANAL[r.contacto.canal], conversaciones: r.conversaciones, ultima: r.ultima ? fechaHoraUtc(r.ultima) : '—',
      hrefExportar: ruta(ctx, `bandeja/datos/${encodeURIComponent(r.contacto.id)}/descargar`),
    })) ?? null,
    pedidos: pedidos.map((p) => ({ fecha: fechaHoraUtc(p.hechoEn), tipo: TIPO[p.tipo], contacto: p.contactoId, quien: persona(ctx, p.hechoPor) ?? '—', nota: p.nota })),
    puedeBorrar: !ctx.organizacion.demo,
  };
}
