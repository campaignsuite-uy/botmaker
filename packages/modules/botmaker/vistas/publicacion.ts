/**
 * Publicación (etapa 4, tarea 4.06): qué está publicado, qué le falta al borrador para pedir publicar, el pedido
 * pendiente con lo que cambia (con direcciones) y su corrida, y el historial de pedidos, aprobaciones y devoluciones.
 * El editor pide; el administrador aprueba o devuelve con un comentario. La base vuelve a controlar todo.
 */
import type { Repositorio } from '../datos/repositorio';
import { validarDefinicion, type Definicion } from '../dominio/definicion';
import { diferencias, type Diferencia } from '../dominio/diferencias';
import { fechaHoraUtc } from '../dominio/formato';
import { puede } from '../dominio/permisos';
import { revisarBot } from '../dominio/validador';
import { BAJA_MAXIMA_ACIERTO, ETIQUETA_ACCION_PUBLICACION, ETIQUETA_ESTADO_VERSION, type Version } from '../dominio/versiones';
import type { ContextoPantalla } from '../ui/contexto';
import { hrefBot } from './bot-comun';
import { baseParte, type BaseParte } from './partes';
import { resumenLegible } from './pruebas';

export interface Requisito {
  texto: string;
  ok: boolean;
  detalle: string;
  href: string | null;
}

export interface VistaPublicacion extends BaseParte {
  publicada: { numero: number; acierto: string; hrefSimular: string } | null;
  /** Pausar o reanudar (publicar): en pausa no contesta en ningún canal y lo que llega va a la bandeja. */
  pausa: { pausado: boolean; puede: boolean } | null;
  borrador: {
    numero: number;
    requisitos: Requisito[];
    listo: boolean;
    cambios: Diferencia[];
    puedePedir: boolean;
  } | null;
  pedida: {
    versionId: string;
    numero: number;
    pidio: string;
    fecha: string;
    nota: string;
    cambios: Diferencia[];
    corrida: { etiqueta: string; valor: string; nota?: string }[];
    hrefCorrida: string | null;
    puedeResolver: boolean;
  } | null;
  eventos: { fecha: string; accion: string; version: string; quien: string; nota: string }[];
  versiones: { numero: number; estado: string; fecha: string; publicada: boolean }[];
}

const num = (x: number | null) => (x === null ? '—' : `${String(x).replace('.', ',')} %`);

export async function vistaPublicacion(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaPublicacion | null> {
  const x = await baseParte(repo, ctx, botId, 'publicacion');
  if (!x) return null;
  const bot = x.b.bot;
  const [versiones, corridas, eventos] = await Promise.all([repo.versiones(bot.id), repo.corridas(bot.id), repo.eventosPublicacion(bot.id)]);
  const nombre = (id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien que ya no está' : 'El sistema');
  const numero = new Map(versiones.map((v) => [v.id, v.numero]));
  const definicionDe = async (v: Version | undefined): Promise<Definicion | null> => {
    if (!v) return null;
    const c = await repo.version(v.id);
    const r = c ? validarDefinicion(c.definicion) : null;
    return r?.ok ? r.definicion : null;
  };
  const terminadaDe = (versionId: string, seq: number | null) => corridas.find((r) => r.versionId === versionId && r.estado === 'terminada' && (seq === null || r.versionSeq === seq));

  const vPublicada = versiones.find((v) => v.id === bot.versionPublicadaId);
  const vPedida = versiones.find((v) => v.estado === 'pedida');
  const [defPublicada, defPedida] = await Promise.all([definicionDe(vPublicada), definicionDe(vPedida)]);
  const aciertoPublicada = vPublicada ? terminadaDe(vPublicada.id, null)?.resumen?.acierto ?? null : null;

  let borrador: VistaPublicacion['borrador'] = null;
  if (x.b.borrador && x.b.definicion) {
    const b = x.b.borrador;
    const errores = revisarBot(x.b.definicion).errores.length;
    const corrida = terminadaDe(b.id, b.seq);
    const acierto = corrida?.resumen?.acierto ?? null;
    const baja = acierto !== null && aciertoPublicada !== null && aciertoPublicada - acierto >= BAJA_MAXIMA_ACIERTO;
    const requisitos: Requisito[] = [
      { texto: 'El validador no marca errores', ok: errores === 0, detalle: errores ? `${errores} ${errores === 1 ? 'error' : 'errores'}: se ven en Flujos` : 'sin errores', href: errores ? hrefBot(ctx, bot.id, 'flujos') : null },
      { texto: 'Las pruebas corrieron sobre el último cambio', ok: !!corrida, detalle: corrida ? `corrida del ${fechaHoraUtc(corrida.creadaEn)}` : `falta correrlas sobre el cambio ${b.seq}`, href: hrefBot(ctx, bot.id, corrida ? `pruebas/${corrida.id}` : 'pruebas') },
      {
        texto: `El acierto no baja ${BAJA_MAXIMA_ACIERTO} puntos o más contra la publicada`,
        ok: !baja,
        detalle: aciertoPublicada === null ? 'no hay versión publicada con pruebas para comparar' : acierto === null ? `la publicada tiene ${num(aciertoPublicada)}` : `${num(acierto)} contra ${num(aciertoPublicada)} de la publicada`,
        href: baja && corrida && vPublicada ? hrefBot(ctx, bot.id, 'pruebas/comparar', { a: terminadaDe(vPublicada.id, null)?.id, b: corrida.id }) : null,
      },
    ];
    const listo = requisitos.every((r) => r.ok);
    borrador = {
      numero: b.numero, requisitos, listo,
      cambios: diferencias(defPublicada, x.b.definicion),
      puedePedir: listo && x.comun.editable && puede(ctx.rol, 'pedir_publicacion') && bot.estado !== 'archivado',
    };
  }

  let pedida: VistaPublicacion['pedida'] = null;
  if (vPedida && defPedida) {
    const pedido = eventos.find((e) => e.versionId === vPedida.id && e.accion === 'pedido');
    const corrida = pedido?.corridaId ? corridas.find((r) => r.id === pedido.corridaId) : terminadaDe(vPedida.id, vPedida.seq);
    pedida = {
      versionId: vPedida.id, numero: vPedida.numero,
      pidio: nombre(pedido?.personaId ?? vPedida.creadaPor), fecha: fechaHoraUtc(pedido?.fecha ?? vPedida.actualizadaEn), nota: pedido?.nota ?? '',
      cambios: diferencias(defPublicada, defPedida),
      corrida: resumenLegible(corrida?.resumen ?? null),
      hrefCorrida: corrida ? hrefBot(ctx, bot.id, `pruebas/${corrida.id}`) : null,
      puedeResolver: puede(ctx.rol, 'publicar') && !ctx.organizacion.demo && bot.estado !== 'archivado',
    };
  }

  return {
    ...x.comun,
    publicada: vPublicada ? { numero: vPublicada.numero, acierto: num(aciertoPublicada), hrefSimular: hrefBot(ctx, bot.id, 'simulador', { version: 'publicada' }) } : null,
    pausa: vPublicada && (bot.estado === 'publicado' || bot.estado === 'pausado') ? { pausado: bot.estado === 'pausado', puede: puede(ctx.rol, 'publicar') && !ctx.organizacion.demo } : null,
    borrador,
    pedida,
    eventos: eventos.map((e) => ({ fecha: fechaHoraUtc(e.fecha), accion: ETIQUETA_ACCION_PUBLICACION[e.accion], version: `v${numero.get(e.versionId) ?? '?'}`, quien: nombre(e.personaId), nota: e.nota })),
    versiones: versiones.slice().sort((a, b) => b.numero - a.numero).map((v) => ({ numero: v.numero, estado: ETIQUETA_ESTADO_VERSION[v.estado], fecha: fechaHoraUtc(v.creadaEn), publicada: v.id === bot.versionPublicadaId })),
  };
}
