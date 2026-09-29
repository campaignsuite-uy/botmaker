/**
 * Simulador: conversar con el borrador mientras se arma, con los mismos motores que producción. Cada respuesta
 * muestra por qué salió (cajas, regla, intención, las dos lecturas, motor y costo). Lo usan el editor y el
 * administrador: cada mensaje que va a un motor tiene costo (uso "simulador" en Costos).
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_TIPO_CAJA } from '../dominio/definicion';
import { fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { simularMotores } from '../motores/claves';
import type { ContextoPantalla } from '../ui/contexto';
import { leerPublicada } from '../acciones/ejecutar-simulador';
import { cargarBot, encabezadoBot, hrefBot, type EncabezadoBotVista } from './bot-comun';

export interface EstadoSimulador {
  campanaId: string;
  botId: string;
  versionId: string;
  numero: number;
  seq: number;
  /** Con qué versión conversa: el borrador o la publicada. */
  version: 'borrador' | 'publicada';
  simulado: boolean;
  hrefFlujos: string;
  /** Para mostrar las decisiones con nombres: cajas ("1.2 · Menú principal"), intenciones, temas y motores. */
  cajas: Record<string, { direccion: string; texto: string; flujo: string }>;
  intenciones: Record<string, string>;
  temas: Record<string, string>;
  motores: Record<string, string>;
  variablesContacto: string[];
}

export interface VistaSimulador {
  encabezado: EncabezadoBotVista;
  simulador: EstadoSimulador | null;
  /** Por qué no se puede usar (rol o sin borrador). */
  motivo: string | null;
  hrefFlujos: string;
  /** Para pasar del borrador a la publicada y al revés (null si no hay publicada). */
  otra: { texto: string; href: string } | null;
}

export async function vistaSimulador(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaSimulador | null> {
  const b = await cargarBot(repo, ctx, botId);
  if (!b) return null;
  const hrefFlujos = hrefBot(ctx, b.bot.id, 'flujos');
  const publicada = ctx.parametros.version === 'publicada' && !!b.bot.versionPublicadaId;
  const otra = b.bot.versionPublicadaId
    ? publicada ? { texto: 'Conversar con el borrador', href: hrefBot(ctx, b.bot.id, 'simulador') } : { texto: 'Conversar con la versión publicada', href: hrefBot(ctx, b.bot.id, 'simulador', { version: 'publicada' }) }
    : null;
  const comun = { encabezado: encabezadoBot(ctx, b.bot, 'simulador', b.borrador), hrefFlujos, otra };
  if (!puede(ctx.rol, 'correr_pruebas') || ctx.organizacion.demo) {
    return { ...comun, simulador: null, motivo: 'El simulador lo usan el editor y el administrador: cada mensaje que pasa por un motor de IA tiene costo.' };
  }
  const l = publicada ? await leerPublicada(repo, b.bot) : null;
  if (l && 'codigo' in l) return { ...comun, simulador: null, motivo: 'La versión publicada no se puede abrir.' };
  if (!l && (!b.borrador || !b.definicion)) return { ...comun, simulador: null, motivo: 'Este bot todavía no tiene borrador: armalo en Flujos.' };
  const def = l ? l.definicion : b.definicion!;
  const version = l ? { id: b.bot.versionPublicadaId!, numero: l.borrador.numero, seq: l.borrador.seq } : { id: b.borrador!.id, numero: b.borrador!.numero, seq: b.borrador!.seq };
  const fichas = await repo.fichas();
  const motores = Object.fromEntries(fichas.map((f) => [f.id, fichaMotor(f.id, fichas)?.nombre ?? f.id]));
  return {
    ...comun,
    motivo: null,
    simulador: {
      campanaId: ctx.campana.id, botId: b.bot.id, versionId: version.id, numero: version.numero, seq: version.seq, version: l ? 'publicada' : 'borrador',
      simulado: simularMotores(), hrefFlujos,
      cajas: Object.fromEntries(def.flujos.flatMap((f) => f.cajas.map((c) => [c.id, { direccion: `${f.codigo}.${c.codigo}`, texto: c.nombre || ETIQUETA_TIPO_CAJA[c.tipo], flujo: f.id }]))),
      intenciones: Object.fromEntries(def.intenciones.map((i) => [i.id, i.nombre])),
      temas: Object.fromEntries(def.temas.map((t) => [t.id, t.nombre])),
      motores,
      variablesContacto: def.variables.filter((v) => v.nombre.startsWith('contacto.')).map((v) => v.nombre),
    },
  };
}
