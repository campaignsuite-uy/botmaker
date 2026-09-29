/**
 * Base de contactos (7.06): quién le escribió a cada bot de la campaña, qué datos dio y qué consultó, y la ficha de cada
 * contacto con sus conversaciones. Horas en UTC.
 *
 * La ven quienes leen conversaciones (administrador, editor, agente y el observador de una demo). El número lo ven solo
 * quienes atienden (administrador y agente): la vista lo esconde y, en Supabase, la base ni lo devuelve. Descargar la
 * base es del administrador (gestionar_datos_contactos) y queda registrado.
 */
import type { Repositorio, FiltroContactos, FilaBaseContacto } from '../datos/repositorio';
import { CANALES, ETIQUETA_CANAL, ETIQUETA_ESTADO_CONVERSACION, type Canal, type Contacto, type EstadoConversacion } from '../dominio/conversaciones';
import {
  claveConsulta, csvBaseContactos, ETIQUETA_TIPO_CONSULTA, etiquetaConsulta, INTENCIONES_SIN_CONSULTA, leerClaveConsulta, numeroInternacional, TEMAS_SIN_CONSULTA,
  type ConsultaContacto, type TipoConsulta,
} from '../dominio/contactos';
import { validarDefinicion, type Definicion } from '../dominio/definicion';
import { entero, fechaHoraUtc } from '../dominio/formato';
import { puede } from '../dominio/permisos';
import type { Bot } from '../dominio/tipos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { nombreContacto } from './bandeja';
import { mensajeDe, type MensajePantalla } from './mensajes';

export const POR_PAGINA = 50;
const CHIPS_POR_FILA = 6;

const persona = (ctx: ContextoPantalla, id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien del equipo' : null);

/** La definición con que se leen los nombres de cada bot: la publicada o, si no hay, la última versión. */
async function definiciones(repo: Repositorio, bots: readonly Bot[]): Promise<Map<string, Definicion | null>> {
  const r = new Map<string, Definicion | null>();
  await Promise.all(bots.map(async (b) => {
    const id = b.versionPublicadaId ?? (await repo.versiones(b.id))[0]?.id ?? null;
    const v = id ? await repo.version(id) : null;
    const d = v ? validarDefinicion(v.definicion) : null;
    r.set(b.id, d?.ok ? d.definicion : null);
  }));
  return r;
}

interface FiltroPantalla {
  bot: string;
  canal: string;
  buscar: string;
  consulta: string;
}

/** El filtro de la dirección, validado: un bot que no es de la campaña o un canal que no existe no filtran. */
function leerFiltro(ctx: ContextoPantalla, bots: readonly Bot[]): { pantalla: FiltroPantalla; repo: Omit<FiltroContactos, 'limite' | 'desde'> } {
  const p = ctx.parametros;
  const bot = bots.some((b) => b.id === p.bot) ? p.bot! : '';
  const canal = (CANALES as readonly string[]).includes(p.canal ?? '') ? (p.canal as Canal) : '';
  const buscar = (p.buscar ?? '').trim().slice(0, 80);
  const consulta = leerClaveConsulta(p.consulta);
  return {
    pantalla: { bot, canal, buscar, consulta: consulta ? claveConsulta(consulta) : '' },
    repo: { ...(bot ? { botId: bot } : {}), ...(canal ? { canal } : {}), ...(buscar ? { buscar } : {}), ...(consulta ? { consulta } : {}) },
  };
}

const parametrosDe = (f: FiltroPantalla, extra: Record<string, string | undefined> = {}) => ({
  bot: f.bot || undefined, canal: f.canal || undefined, buscar: f.buscar || undefined, consulta: f.consulta || undefined, ...extra,
});

function datosDe(c: Contacto): { etiqueta: string; valor: string }[] {
  return Object.entries(c.datos).map(([k, v]) => ({ etiqueta: k.replace(/^contacto\./, ''), valor: v }));
}

/** El nombre de una consulta con la primera definición que la conoce (sin bot elegido, puede ser de cualquiera). */
function nombreConsulta(defs: readonly (Definicion | null)[], k: Pick<ConsultaContacto, 'tipo' | 'clave'>): string {
  const sinNombre = etiquetaConsulta(null, k);
  for (const d of defs) {
    const t = etiquetaConsulta(d, k);
    if (t !== sinNombre) return t;
  }
  return sinNombre;
}

function resumen(total: number, k: Pick<ConsultaContacto, 'tipo'> | null, nombre: string | null, otroFiltro: boolean): string {
  const uno = total === 1;
  const quienes = uno ? '1 contacto' : `${entero(total)} contactos`;
  const que = k && nombre ? ` ${k.tipo === 'opcion' ? (uno ? 'eligió' : 'eligieron') : uno ? 'consultó por' : 'consultaron por'} «${nombre}»` : '';
  return `${quienes}${que}${otroFiltro ? ' con este filtro' : ''}.`;
}

const vecesTexto = (n: number) => `${entero(n)} ${n === 1 ? 'vez' : 'veces'}`;

// ── Lista ───────────────────────────────────────────────────────────────────────────────────────

export interface ChipConsulta {
  tipo: TipoConsulta;
  texto: string;
  titulo: string;
  href: string;
}

export interface VistaContactos {
  mensaje: MensajePantalla | null;
  filtros: FiltroPantalla;
  hayFiltro: boolean;
  hrefLimpiar: string;
  opcionesBot: { valor: string; texto: string }[];
  opcionesCanal: { valor: string; texto: string }[];
  opcionesConsulta: { grupo: string; opciones: { valor: string; texto: string }[] }[];
  /** La consulta del filtro, con su nombre (puede ser una opción de menú, que no está en la lista). */
  consultaElegida: string | null;
  /** "5 contactos.", "1 contacto consultó por «Agua»." */
  resumen: string;
  filas: {
    id: string; href: string; nombre: string; perfil: string | null; numero: string | null; canal: string; bot: string; primera: string; ultima: string;
    conversaciones: number; datos: string; consultas: ChipConsulta[]; masConsultas: number;
  }[];
  paginas: { texto: string; anterior: string | null; siguiente: string | null } | null;
  verNumero: boolean;
  /** Solo el administrador: descargar lo que muestra el filtro y el registro de descargas. */
  descarga: {
    href: string;
    registro: { fecha: string; quien: string; bot: string; filtro: string; cantidad: string }[];
  } | null;
}

function chip(ctx: ContextoPantalla, f: FiltroPantalla, def: Definicion | null, c: ConsultaContacto): ChipConsulta {
  return {
    tipo: c.tipo, texto: etiquetaConsulta(def, c), titulo: `${ETIQUETA_TIPO_CONSULTA[c.tipo]} · ${vecesTexto(c.veces)} · la última el ${fechaHoraUtc(c.ultima)}`,
    href: ruta(ctx, 'contactos', parametrosDe(f, { consulta: claveConsulta(c), pagina: undefined })),
  };
}

export async function vistaContactos(repo: Repositorio, ctx: ContextoPantalla): Promise<VistaContactos> {
  const bots = await repo.bots(ctx.campana.id, { archivados: true });
  const { pantalla: f, repo: filtro } = leerFiltro(ctx, bots);
  const pagina = Math.max(1, Math.min(10_000, Math.floor(Number(ctx.parametros.pagina)) || 1));
  const esAdmin = puede(ctx.rol, 'gestionar_datos_contactos');
  const [base, defs, exportaciones] = await Promise.all([
    repo.baseContactos(ctx.campana.id, { ...filtro, limite: POR_PAGINA, desde: (pagina - 1) * POR_PAGINA }, ctx.persona.id),
    definiciones(repo, bots),
    esAdmin ? repo.exportacionesBase(ctx.campana.id, ctx.persona.id) : Promise.resolve([]),
  ]);
  const verNumero = puede(ctx.rol, 'responder_conversaciones');
  const nombreBot = (id: string | null) => (id ? bots.find((b) => b.id === id)?.nombre ?? 'Bot borrado' : 'Todos');

  // Las consultas para elegir: temas y consultas de la definición del bot elegido (o de todos), sin repetir.
  const temas = new Map<string, string>();
  const intenciones = new Map<string, string>();
  for (const b of bots.filter((x) => !f.bot || x.id === f.bot)) {
    const d = defs.get(b.id);
    for (const t of d?.temas ?? []) if (!TEMAS_SIN_CONSULTA.includes(t.id) && !temas.has(t.id)) temas.set(t.id, t.nombre);
    for (const i of d?.intenciones ?? []) if (!INTENCIONES_SIN_CONSULTA.includes(i.id) && !intenciones.has(i.id)) intenciones.set(i.id, i.nombre);
  }
  const ordenar = (m: Map<string, string>, tipo: TipoConsulta) => [...m].sort((a, b) => a[1].localeCompare(b[1], 'es')).map(([id, texto]) => ({ valor: `${tipo}:${id}`, texto }));
  const elegida = leerClaveConsulta(f.consulta);

  const hayFiltro = !!(f.bot || f.canal || f.buscar || f.consulta);
  const paginas = Math.ceil(base.total / POR_PAGINA);
  const fila = (x: FilaBaseContacto) => {
    const c = x.contacto;
    const def = defs.get(c.botId) ?? null;
    return {
      id: c.id, href: ruta(ctx, `contactos/${encodeURIComponent(c.id)}`), nombre: nombreContacto(c),
      perfil: c.nombrePerfil && c.nombrePerfil !== nombreContacto(c) ? c.nombrePerfil : null,
      numero: verNumero && c.telefono ? numeroInternacional(c.telefono) : null,
      canal: ETIQUETA_CANAL[c.canal], bot: nombreBot(c.botId),
      primera: x.primera ? fechaHoraUtc(x.primera) : '—', ultima: x.ultima ? fechaHoraUtc(x.ultima) : '—', conversaciones: x.conversaciones,
      datos: datosDe(c).filter((d) => d.etiqueta !== 'nombre' || d.valor !== c.nombre).map((d) => `${d.etiqueta}: ${d.valor}`).join(' · '),
      consultas: x.consultas.slice(0, CHIPS_POR_FILA).map((k) => chip(ctx, f, def, k)), masConsultas: Math.max(0, x.consultas.length - CHIPS_POR_FILA),
    };
  };
  return {
    mensaje: mensajeDe(ctx.parametros),
    filtros: f,
    hayFiltro,
    hrefLimpiar: ruta(ctx, 'contactos'),
    opcionesBot: bots.map((b) => ({ valor: b.id, texto: b.nombre })),
    opcionesCanal: CANALES.map((c) => ({ valor: c, texto: ETIQUETA_CANAL[c] })),
    opcionesConsulta: [
      { grupo: 'Consultas', opciones: ordenar(intenciones, 'intencion') },
      { grupo: 'Temas', opciones: ordenar(temas, 'tema') },
    ].filter((g) => g.opciones.length),
    consultaElegida: elegida ? `${ETIQUETA_TIPO_CONSULTA[elegida.tipo]}: ${nombreConsulta(f.bot ? [defs.get(f.bot) ?? null] : [...defs.values()], elegida)}` : null,
    resumen: resumen(base.total, elegida, elegida ? nombreConsulta(f.bot ? [defs.get(f.bot) ?? null] : [...defs.values()], elegida) : null, !!(f.bot || f.canal || f.buscar)),
    filas: base.filas.map(fila),
    paginas: paginas > 1 ? {
      texto: `Página ${pagina} de ${paginas}`,
      anterior: pagina > 1 ? ruta(ctx, 'contactos', parametrosDe(f, { pagina: String(pagina - 1) })) : null,
      siguiente: pagina < paginas ? ruta(ctx, 'contactos', parametrosDe(f, { pagina: String(pagina + 1) })) : null,
    } : null,
    verNumero,
    descarga: esAdmin ? {
      href: ruta(ctx, 'contactos/descargar', parametrosDe(f)),
      registro: exportaciones.map((x) => {
        const k = leerClaveConsulta(x.consulta);
        const partes = [x.canal ? ETIQUETA_CANAL[x.canal] : null, k ? nombreConsulta(x.botId ? [defs.get(x.botId) ?? null] : [...defs.values()], k) : null, x.conBusqueda ? 'con búsqueda' : null].filter(Boolean);
        return { fecha: fechaHoraUtc(x.hechoEn), quien: persona(ctx, x.hechoPor) ?? '—', bot: nombreBot(x.botId), filtro: partes.join(' · ') || 'Sin filtro', cantidad: entero(x.cantidad) };
      }),
    } : null,
  };
}

// ── Ficha de un contacto ────────────────────────────────────────────────────────────────────────

export interface VistaFichaContacto {
  mensaje: MensajePantalla | null;
  id: string;
  campanaId: string;
  volver: string;
  hrefBase: string;
  nombre: string;
  bajada: string;
  borrado: boolean;
  datos: { etiqueta: string; valor: string }[];
  consultas: { tipo: string; items: { texto: string; veces: string; ultima: string; href: string }[] }[];
  conversaciones: { href: string; estado: EstadoConversacion; estadoTexto: string; canal: string; iniciada: string; actualizada: string; mensajes: number; atiende: string | null }[];
  /** Solo el administrador: los pedidos de la persona sobre sus datos. */
  pedidos: { hrefExportar: string; puedeBorrar: boolean } | null;
}

export async function vistaFichaContacto(repo: Repositorio, ctx: ContextoPantalla, id: string): Promise<VistaFichaContacto | null> {
  const x = await repo.fichaContacto(id, ctx.persona.id);
  if (!x || x.contacto.campanaId !== ctx.campana.id) return null;
  const c = x.contacto;
  const bot = await repo.bot(c.botId);
  const def = bot ? (await definiciones(repo, [bot])).get(bot.id) ?? null : null;
  const verNumero = puede(ctx.rol, 'responder_conversaciones');
  const f: FiltroPantalla = { bot: c.botId, canal: '', buscar: '', consulta: '' };
  const grupos: { tipo: TipoConsulta; titulo: string }[] = [{ tipo: 'intencion', titulo: 'Consultas' }, { tipo: 'tema', titulo: 'Temas' }, { tipo: 'opcion', titulo: 'Opciones que eligió' }];
  return {
    mensaje: mensajeDe(ctx.parametros),
    id: c.id,
    campanaId: ctx.campana.id,
    volver: ruta(ctx, `contactos/${encodeURIComponent(c.id)}`),
    hrefBase: ruta(ctx, 'contactos'),
    nombre: nombreContacto(c),
    bajada: `${bot?.nombre ?? 'Bot'} · ${ETIQUETA_CANAL[c.canal]} · desde el ${fechaHoraUtc(c.creadoEn)}`,
    borrado: !!c.borradoEn,
    datos: c.borradoEn ? [{ etiqueta: 'Borrado a pedido', valor: fechaHoraUtc(c.borradoEn) }] : [
      ...(c.nombre ? [{ etiqueta: 'Nombre', valor: c.nombre }] : []),
      ...(c.nombrePerfil ? [{ etiqueta: 'Nombre de perfil de WhatsApp', valor: c.nombrePerfil }] : []),
      ...(verNumero && c.telefono ? [{ etiqueta: 'Número', valor: numeroInternacional(c.telefono) }] : []),
      ...(!verNumero && c.canal === 'whatsapp' ? [{ etiqueta: 'Número', valor: 'Lo ven el administrador y los agentes' }] : []),
      ...datosDe(c).filter((d) => d.etiqueta !== 'nombre' || d.valor !== c.nombre),
      { etiqueta: 'Condiciones', valor: c.condicionesVersion ? `aceptó la versión ${c.condicionesVersion}${c.condicionesAceptadasEn ? ` el ${fechaHoraUtc(c.condicionesAceptadasEn)}` : ''}` : 'no aceptó condiciones' },
      { etiqueta: 'Conversaciones', valor: `${entero(x.conversaciones)}${x.primera ? `, la primera el ${fechaHoraUtc(x.primera)}` : ''}${x.ultima ? ` y la última el ${fechaHoraUtc(x.ultima)}` : ''}` },
    ],
    consultas: grupos.map((g) => ({
      tipo: g.titulo,
      items: x.consultas.filter((k) => k.tipo === g.tipo).map((k) => ({
        texto: etiquetaConsulta(def, k), veces: vecesTexto(k.veces), ultima: fechaHoraUtc(k.ultima),
        href: ruta(ctx, 'contactos', parametrosDe(f, { consulta: claveConsulta(k) })),
      })),
    })).filter((g) => g.items.length),
    conversaciones: x.lista.map((s) => ({
      href: ruta(ctx, `bandeja/${encodeURIComponent(s.id)}`), estado: s.estado, estadoTexto: ETIQUETA_ESTADO_CONVERSACION[s.estado], canal: ETIQUETA_CANAL[s.canal],
      iniciada: fechaHoraUtc(s.iniciadaEn), actualizada: fechaHoraUtc(s.actualizadaEn), mensajes: s.mensajes, atiende: persona(ctx, s.asignadaA),
    })),
    pedidos: puede(ctx.rol, 'gestionar_datos_contactos') && !c.borradoEn ? {
      hrefExportar: ruta(ctx, `bandeja/datos/${encodeURIComponent(c.id)}/descargar`),
      puedeBorrar: !ctx.organizacion.demo,
    } : null,
  };
}

// ── Descarga (CSV) ──────────────────────────────────────────────────────────────────────────────

/** La base que cumple el filtro de la dirección, en CSV, con los nombres de cada bot. Queda registrada en el repositorio. */
export async function descargaContactos(repo: Repositorio, ctx: ContextoPantalla): Promise<{ archivo: string; csv: string; cantidad: number }> {
  const bots = await repo.bots(ctx.campana.id, { archivados: true });
  const { repo: filtro } = leerFiltro(ctx, bots);
  const [filas, defs] = await Promise.all([repo.exportarBaseContactos(ctx.campana.id, filtro, ctx.persona.id), definiciones(repo, bots)]);
  const csv = csvBaseContactos(filas.map((x) => {
    const c = x.contacto;
    const def = defs.get(c.botId) ?? null;
    const de = (tipo: TipoConsulta) => x.consultas.filter((k) => k.tipo === tipo).map((k) => etiquetaConsulta(def, k));
    return {
      id: c.id, bot: bots.find((b) => b.id === c.botId)?.nombre ?? 'Bot borrado', canal: ETIQUETA_CANAL[c.canal], nombre: c.nombre ?? '', nombrePerfil: c.nombrePerfil ?? '',
      numero: numeroInternacional(c.telefono), datos: Object.fromEntries(datosDe(c).map((d) => [d.etiqueta, d.valor])), primera: x.primera, ultima: x.ultima,
      conversaciones: x.conversaciones, temas: de('tema'), consultas: de('intencion'), opciones: de('opcion'), condiciones: c.condicionesVersion, condicionesAceptadas: c.condicionesAceptadasEn,
    };
  }));
  const dia = new Date().toISOString().slice(0, 10);
  const bot = filtro.botId ? bots.find((b) => b.id === filtro.botId)?.nombre : null;
  const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return { archivo: `contactos-${slug(bot ?? ctx.campana.nombre) || 'campana'}-${dia}.csv`, csv, cantidad: filas.length };
}
