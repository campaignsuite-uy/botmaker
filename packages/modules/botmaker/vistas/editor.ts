/**
 * Flujos: el editor visual del borrador. La pantalla es del servidor (quién mira, qué puede, el borrador); el diagrama
 * y el inspector son del navegador (ui/editor/editor.tsx) y cambian el borrador con acciones que devuelven el
 * resultado sin recargar.
 */
import type { Repositorio } from '../datos/repositorio';
import { avisosMotores } from '../dominio/avisos';
import type { Definicion, Problema } from '../dominio/definicion';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { cargarBot, encabezadoBot, hrefBot, type EncabezadoBotVista } from './bot-comun';
import { mensajeDe, type MensajePantalla } from './mensajes';

import { numerosDiagrama, type NumerosDiagrama } from './analitica';

export interface EstadoEditor {
  campanaId: string;
  botId: string;
  versionId: string;
  numero: number;
  seq: number;
  definicion: Definicion;
  deshacer: string | null;
  rehacer: string | null;
  editable: boolean;
  flujoInicial: string | null;
  cajaInicial: string | null;
  hrefSimulador: string;
  hrefContenidos: string;
  /** Avisos de los motores del bot para este caso (los da el servidor: el navegador no tiene las fichas). */
  avisosMotores: string[];
  /** Visitas, abandono y opciones de cada caja en los últimos 30 días (null si el bot todavía no conversó). */
  numeros: NumerosDiagrama | null;
  /** Mostrarlos al abrir (se llega desde Analítica con ?numeros=si). */
  numerosVisibles: boolean;
}

export interface VistaEditor {
  mensaje: MensajePantalla | null;
  encabezado: EncabezadoBotVista;
  campanaId: string;
  volver: string;
  editor: EstadoEditor | null;
  problemas: Problema[] | null;
  /** Sin borrador: el formulario para armarlo (con la plantilla o copiando la última versión). */
  armar: { botId: string; conVersiones: boolean; partido: string } | null;
}

export async function vistaEditor(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaEditor | null> {
  const b = await cargarBot(repo, ctx, botId);
  if (!b) return null;
  const volver = hrefBot(ctx, b.bot.id, 'flujos');
  const comun = { mensaje: mensajeDe(ctx.parametros), encabezado: encabezadoBot(ctx, b.bot, 'flujos', b.borrador), campanaId: ctx.campana.id, volver };
  if (!b.borrador || !b.definicion) {
    const conVersiones = !b.borrador && (await repo.versiones(b.bot.id)).length > 0;
    return { ...comun, editor: null, problemas: b.problemas, armar: b.editable && !b.borrador ? { botId: b.bot.id, conVersiones, partido: ctx.organizacion.nombre } : null };
  }
  const [motores, fichas, numeros] = await Promise.all([repo.motoresDeBot(b.bot.id), repo.fichas(), numerosDiagrama(repo, ctx, b.bot)]);
  return {
    ...comun,
    problemas: null,
    armar: null,
    editor: {
      campanaId: ctx.campana.id, botId: b.bot.id, versionId: b.borrador.id, numero: b.borrador.numero, seq: b.borrador.seq,
      definicion: b.definicion, deshacer: b.deshacer, rehacer: b.rehacer, editable: b.editable,
      flujoInicial: ctx.parametros.flujo ?? null, cajaInicial: ctx.parametros.caja ?? null,
      hrefSimulador: hrefBot(ctx, b.bot.id, 'simulador'), hrefContenidos: hrefBot(ctx, b.bot.id, 'contenidos'),
      avisosMotores: avisosMotores(b.bot, motores, fichas).filter((a) => a.nivel === 'atencion').map((a) => a.texto),
      numeros, numerosVisibles: !!numeros && ctx.parametros.numeros === 'si',
    },
  };
}

export { ruta };
