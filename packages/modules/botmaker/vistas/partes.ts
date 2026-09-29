/**
 * Las pantallas del borrador que no son el diagrama: Contenidos (2.11), Intenciones y temas, Variables y datos (2.12)
 * y YAML (2.07). Cada formulario manda un cambio del borrador (acciones/borrador.ts → cambiarBorrador) que se deshace
 * como cualquier otro, también desde la barra de arriba de cada pantalla.
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_TIPO_CAJA, LIMITES, opcionesDe, type Definicion } from '../dominio/definicion';
import { puede } from '../dominio/permisos';
import { yamlDelBorrador } from '../acciones/ejecutar-borrador';
import type { ContextoPantalla } from '../ui/contexto';
import { cargarBot, encabezadoBot, hrefBot, type BotConBorrador, type EncabezadoBotVista, type PestanaBot } from './bot-comun';
import { mensajeDe, type MensajePantalla } from './mensajes';

interface Opcion {
  valor: string;
  texto: string;
}

/** Lo común: encabezado, formulario oculto y la barra de deshacer. */
export interface BaseParte {
  mensaje: MensajePantalla | null;
  encabezado: EncabezadoBotVista;
  campanaId: string;
  botId: string;
  volver: string;
  editable: boolean;
  seq: number;
  deshacer: string | null;
  rehacer: string | null;
  /** Sin borrador (o inválido): la pantalla manda a Flujos para armarlo. */
  sinBorrador: { hrefFlujos: string } | null;
}

async function base(repo: Repositorio, ctx: ContextoPantalla, botId: string, pestana: PestanaBot): Promise<{ b: BotConBorrador; comun: BaseParte } | null> {
  const b = await cargarBot(repo, ctx, botId);
  if (!b) return null;
  const seccion = pestana === 'ajustes' ? '' : pestana;
  return {
    b,
    comun: {
      mensaje: mensajeDe(ctx.parametros),
      encabezado: encabezadoBot(ctx, b.bot, pestana, b.borrador),
      campanaId: ctx.campana.id,
      botId: b.bot.id,
      volver: hrefBot(ctx, b.bot.id, seccion),
      editable: b.editable && !!b.definicion,
      seq: b.borrador?.seq ?? 0,
      deshacer: b.deshacer,
      rehacer: b.rehacer,
      sinBorrador: b.definicion ? null : { hrefFlujos: hrefBot(ctx, b.bot.id, 'flujos') },
    },
  };
}

/** Rellena las variables del bot con su valor y las del contacto con un ejemplo, para las vistas previas. */
export function vistaPrevia(def: Definicion, texto: string): string {
  const bot = new Map(def.variables.map((v) => [v.nombre, v.valor ?? '']));
  const ejemplo: Record<string, string> = { 'contacto.nombre': 'María', 'contacto.zona': 'San Miguelito' };
  return texto.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (_, n: string) => (n.startsWith('contacto.') ? ejemplo[n] ?? `[${n}]` : bot.get(n) || `[${n} sin valor]`));
}

function destinosDe(def: Definicion): Opcion[] {
  return def.flujos.flatMap((f) => f.cajas.map((c) => ({ valor: c.id, texto: `${f.codigo}.${c.codigo} · ${c.nombre || ETIQUETA_TIPO_CAJA[c.tipo]}` })));
}

// ── Contenidos ──────────────────────────────────────────────────────────────────────────────────

export interface FilaContenido {
  id: string;
  nombre: string;
  tipo: 'texto' | 'imagen' | 'documento';
  texto: string;
  largo: number;
  archivo: { url: string; nombre: string } | null;
  usos: { direccion: string; href: string }[];
  sistema: string[];
  previa: string;
  /** Los botones o la lista de las cajas que muestran este contenido (para la vista previa). */
  opciones: { direccion: string; modo: 'botones' | 'lista'; items: { texto: string; largo: number; tope: number }[] }[];
  quitable: boolean;
}

export interface VistaContenidos extends BaseParte {
  limiteTexto: number;
  contenidos: FilaContenido[];
}

const CLAVES_SISTEMA: Record<keyof Definicion['sistema'], string> = {
  noEntendi: 'no entendí', aclaracion: 'aclaración de la doble lectura', cierre: 'cierre', sinMotor: 'sin motor',
};

export async function vistaContenidos(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaContenidos | null> {
  const x = await base(repo, ctx, botId, 'contenidos');
  if (!x) return null;
  const def = x.b.definicion;
  const contenidos: FilaContenido[] = (def?.contenidos ?? []).map((c) => {
    const cajas = def!.flujos.flatMap((f) => f.cajas.filter((k) => 'contenido' in k && k.contenido === c.id).map((k) => ({ f, k })));
    const sistema = Object.entries(def!.sistema).filter(([, id]) => id === c.id).map(([k]) => CLAVES_SISTEMA[k as keyof Definicion['sistema']]);
    return {
      id: c.id, nombre: c.nombre, tipo: c.tipo, texto: c.texto, largo: c.texto.length, archivo: c.archivo ?? null,
      usos: cajas.map(({ f, k }) => ({ direccion: `${f.codigo}.${k.codigo}`, href: hrefBot(ctx, x.b.bot.id, 'flujos', { flujo: f.id, caja: k.id }) })),
      sistema,
      previa: vistaPrevia(def!, c.texto),
      opciones: cajas.filter(({ k }) => opcionesDe(k).length).map(({ f, k }) => {
        const modo = k.tipo === 'menu' ? k.modo : 'botones';
        const tope = modo === 'lista' ? LIMITES.textoOpcionLista : LIMITES.textoBoton;
        return { direccion: `${f.codigo}.${k.codigo}`, modo, items: opcionesDe(k).map((o) => ({ texto: o.texto, largo: o.texto.length, tope })) };
      }),
      quitable: !cajas.length && !sistema.length,
    };
  });
  return { ...x.comun, limiteTexto: LIMITES.texto, contenidos };
}

// ── Intenciones y temas ─────────────────────────────────────────────────────────────────────────

export interface FilaIntencion {
  id: string;
  nombre: string;
  descripcion: string;
  limite: string;
  frases: string;
  cantidadFrases: number;
  destino: string;
  destinoTexto: string;
  hrefDestino: string | null;
  tema: string;
  temaTexto: string;
  /** Cajas de interpretar con una ruta propia para esta intención. */
  rutasPropias: string[];
}

export interface VistaIntenciones extends BaseParte {
  intenciones: FilaIntencion[];
  temas: { id: string; nombre: string; descripcion: string; usos: number }[];
  destinos: Opcion[];
  opcionesTema: Opcion[];
}

export async function vistaIntenciones(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaIntenciones | null> {
  const x = await base(repo, ctx, botId, 'intenciones');
  if (!x) return null;
  const def = x.b.definicion;
  if (!def) return { ...x.comun, intenciones: [], temas: [], destinos: [], opcionesTema: [] };
  const destinos = destinosDe(def);
  const temaDe = (id: string | null) => def.temas.find((t) => t.id === id)?.nombre ?? '';
  return {
    ...x.comun,
    destinos,
    opcionesTema: def.temas.map((t) => ({ valor: t.id, texto: t.nombre })),
    intenciones: def.intenciones.map((i) => {
      const u = i.destino ? def.flujos.find((f) => f.cajas.some((c) => c.id === i.destino)) : undefined;
      return {
        id: i.id, nombre: i.nombre, descripcion: i.descripcion, limite: i.limite, frases: i.frases.join('\n'), cantidadFrases: i.frases.length,
        destino: i.destino ?? '', destinoTexto: destinos.find((d) => d.valor === i.destino)?.texto ?? 'Sin destino',
        hrefDestino: u && i.destino ? hrefBot(ctx, x.b.bot.id, 'flujos', { flujo: u.id, caja: i.destino }) : null,
        tema: i.tema ?? '', temaTexto: temaDe(i.tema),
        rutasPropias: def.flujos.flatMap((f) => f.cajas.filter((c) => c.tipo === 'interpretar' && i.id in c.rutas).map((c) => `${f.codigo}.${c.codigo}`)),
      };
    }),
    temas: def.temas.map((t) => ({
      id: t.id, nombre: t.nombre, descripcion: t.descripcion,
      usos: def.intenciones.filter((i) => i.tema === t.id).length + def.flujos.flatMap((f) => f.cajas).filter((c) => c.tipo === 'respuesta_base' && c.temas.includes(t.id)).length,
    })),
  };
}

// ── Variables y datos ───────────────────────────────────────────────────────────────────────────

export interface VistaVariables extends BaseParte {
  identidad: { candidato: string; candidatoAlias: string; partido: string; partidoAlias: string };
  contacto: { consultasCanal: string; consultasValor: string; aportesCanal: string; aportesValor: string };
  canales: Opcion[];
  variables: { nombre: string; ambito: 'bot' | 'contacto'; descripcion: string; valor: string; usos: string[]; quitable: boolean }[];
  sistema: { clave: string; etiqueta: string; valor: string }[];
  contenidos: Opcion[];
}

export async function vistaVariables(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaVariables | null> {
  const x = await base(repo, ctx, botId, 'variables');
  if (!x) return null;
  const def = x.b.definicion;
  const vacia = { candidato: '', candidatoAlias: '', partido: '', partidoAlias: '' };
  if (!def) return { ...x.comun, identidad: vacia, contacto: { consultasCanal: '', consultasValor: '', aportesCanal: '', aportesValor: '' }, canales: [], variables: [], sistema: [], contenidos: [] };
  const en = (nombre: string, t: string) => new RegExp(`\\{\\{\\s*${nombre.replace('.', '\\.')}\\s*\\}\\}`).test(t);
  return {
    ...x.comun,
    identidad: {
      candidato: def.identidad.candidato.nombre, candidatoAlias: def.identidad.candidato.alias.join(', '),
      partido: def.identidad.partido?.nombre ?? '', partidoAlias: def.identidad.partido?.alias.join(', ') ?? '',
    },
    contacto: {
      consultasCanal: def.contacto.consultas?.canal ?? '', consultasValor: def.contacto.consultas?.valor ?? '',
      aportesCanal: def.contacto.aportes?.canal ?? '', aportesValor: def.contacto.aportes?.valor ?? '',
    },
    canales: [
      { valor: 'whatsapp', texto: 'WhatsApp' }, { valor: 'correo', texto: 'Correo' }, { valor: 'web', texto: 'Sitio web' }, { valor: 'telefono', texto: 'Teléfono' },
    ],
    variables: def.variables.map((v) => {
      const usos = [
        ...def.contenidos.filter((c) => en(v.nombre, c.texto)).map((c) => `contenido ${c.nombre}`),
        ...def.flujos.flatMap((f) => f.cajas
          .filter((c) => (c.tipo === 'pedir_dato' && c.variable === v.nombre) || (c.tipo === 'condicion' && c.casos.some((k) => k.si.tipo === 'variable' && k.si.variable === v.nombre)))
          .map((c) => `caja ${f.codigo}.${c.codigo}`)),
      ];
      return { nombre: v.nombre, ambito: v.nombre.startsWith('bot.') ? 'bot' as const : 'contacto' as const, descripcion: v.descripcion, valor: v.valor ?? '', usos, quitable: !usos.length };
    }),
    sistema: (Object.keys(CLAVES_SISTEMA) as (keyof Definicion['sistema'])[]).map((k) => ({ clave: k, etiqueta: CLAVES_SISTEMA[k], valor: def.sistema[k] })),
    contenidos: def.contenidos.map((c) => ({ valor: c.id, texto: c.nombre })),
  };
}

// ── YAML ────────────────────────────────────────────────────────────────────────────────────────

export interface VistaYaml extends BaseParte {
  yaml: string;
  nombreArchivo: string;
  hrefDescargar: string;
  puedeVer: boolean;
}

export async function vistaYaml(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaYaml | null> {
  const x = await base(repo, ctx, botId, 'yaml');
  if (!x) return null;
  const { bot, borrador, definicion } = x.b;
  const yaml = borrador && definicion ? yamlDelBorrador(bot, borrador, definicion) : '';
  return {
    ...x.comun, yaml, puedeVer: puede(ctx.rol, 'ver'),
    nombreArchivo: `${bot.nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot'}-v${borrador?.numero ?? 0}.yaml`,
    hrefDescargar: hrefBot(ctx, bot.id, 'yaml/descargar'),
  };
}
