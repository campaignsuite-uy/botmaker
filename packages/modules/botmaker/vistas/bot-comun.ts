/**
 * Lo común a las pantallas de un bot: el encabezado (nombre, estado) y las pestañas (Flujos, Contenidos, Material,
 * Intenciones, Variables, Simulador, YAML, Ajustes), y la carga del bot y su borrador con los permisos de quien mira.
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_ESTADO_BOT } from '../dominio/bots';
import { validarDefinicion, type Definicion, type Problema } from '../dominio/definicion';
import { puede } from '../dominio/permisos';
import type { Bot, EstadoBot } from '../dominio/tipos';
import { pilasDeshacer, type Borrador } from '../dominio/versiones';
import { ruta, type ContextoPantalla } from '../ui/contexto';

export type PestanaBot = 'flujos' | 'contenidos' | 'material' | 'intenciones' | 'variables' | 'simulador' | 'yaml' | 'ajustes';

export const PESTANAS_BOT: { id: PestanaBot; texto: string; seccion: string }[] = [
  { id: 'flujos', texto: 'Flujos', seccion: 'flujos' },
  { id: 'contenidos', texto: 'Contenidos', seccion: 'contenidos' },
  { id: 'material', texto: 'Material', seccion: 'material' },
  { id: 'intenciones', texto: 'Intenciones y temas', seccion: 'intenciones' },
  { id: 'variables', texto: 'Variables y datos', seccion: 'variables' },
  { id: 'simulador', texto: 'Simulador', seccion: 'simulador' },
  { id: 'yaml', texto: 'YAML', seccion: 'yaml' },
  { id: 'ajustes', texto: 'Ajustes', seccion: '' },
];

export interface EncabezadoBotVista {
  id: string;
  nombre: string;
  estado: EstadoBot;
  estadoTexto: string;
  archivado: boolean;
  hrefLista: string;
  pestanas: { texto: string; href: string; activa: boolean }[];
  /** "Borrador v2 · 14 cambios" o null si no hay borrador. */
  version: string | null;
}

export function hrefBot(ctx: Pick<ContextoPantalla, 'base'>, botId: string, seccion = '', extra: Record<string, string | undefined> = {}): string {
  return ruta(ctx, `${encodeURIComponent(botId)}${seccion ? `/${seccion}` : ''}`, extra);
}

export function encabezadoBot(ctx: ContextoPantalla, bot: Bot, activa: PestanaBot, borrador: Pick<Borrador, 'numero' | 'seq'> | null): EncabezadoBotVista {
  return {
    id: bot.id,
    nombre: bot.nombre,
    estado: bot.estado,
    estadoTexto: ETIQUETA_ESTADO_BOT[bot.estado],
    archivado: bot.estado === 'archivado',
    hrefLista: ruta(ctx),
    pestanas: PESTANAS_BOT.map((p) => ({ texto: p.texto, href: hrefBot(ctx, bot.id, p.seccion), activa: p.id === activa })),
    version: borrador ? `Borrador v${borrador.numero} · ${borrador.seq === 1 ? '1 cambio' : `${borrador.seq} cambios`}` : null,
  };
}

export interface BotConBorrador {
  bot: Bot;
  /** ¿Puede cambiar el borrador? (editor o administrador, bot no archivado, organización que no es demo). */
  editable: boolean;
  borrador: Borrador | null;
  definicion: Definicion | null;
  /** El borrador guardado no es válido (no debería pasar: lo muestra en lugar de romper la pantalla). */
  problemas: Problema[] | null;
  deshacer: string | null;
  rehacer: string | null;
}

/** El bot (si es de esta campaña) con su borrador validado y lo que harían deshacer y rehacer. */
export async function cargarBot(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<BotConBorrador | null> {
  const bot = await repo.bot(botId);
  if (!bot || bot.campanaId !== ctx.campana.id) return null;
  const editable = puede(ctx.rol, 'editar_borrador') && bot.estado !== 'archivado' && !ctx.organizacion.demo;
  const borrador = await repo.borrador(bot.id);
  if (!borrador) return { bot, editable, borrador: null, definicion: null, problemas: null, deshacer: null, rehacer: null };
  const v = validarDefinicion(borrador.definicion);
  const pilas = editable ? pilasDeshacer(await repo.cambios(borrador.id)) : { deshacer: null, rehacer: null };
  return {
    bot, editable, borrador, definicion: v.ok ? v.definicion : null, problemas: v.ok ? null : v.problemas,
    deshacer: pilas.deshacer?.resumen ?? null, rehacer: pilas.rehacer?.resumen ?? null,
  };
}
