/**
 * Pruebas (etapa 4, tareas 4.04 y 4.05): los casos de prueba del bot, correrlos con los motores del bot o con otra
 * combinación, el resultado de cada corrida caso por caso y la comparación de dos corridas lado a lado.
 */
import type { Repositorio } from '../datos/repositorio';
import { casosComoTexto } from '../dominio/casos';
import { compararCorridas, type Corrida, type ResultadoCaso, type ResumenCorrida } from '../dominio/corridas';
import { fechaHoraUtc, usd } from '../dominio/formato';
import { motoresPara } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import type { ContextoPantalla } from '../ui/contexto';
import { hrefBot } from './bot-comun';
import { baseParte, type BaseParte } from './partes';

const ESTADO: Record<Corrida['estado'], string> = { en_curso: 'En curso', terminada: 'Terminada', cancelada: 'Cancelada' };
const num = (x: number | null | undefined, sufijo = ' %') => (x === null || x === undefined ? '—' : `${String(x).replace('.', ',')}${sufijo}`);

export interface FilaCorrida {
  id: string;
  fecha: string;
  version: string;
  /** Es del cambio actual del borrador (sirve para pedir publicar). */
  actual: boolean;
  etiqueta: string;
  estado: Corrida['estado'];
  estadoTexto: string;
  avance: string;
  acierto: string;
  cuandoCoinciden: string;
  aclaracion: string;
  base: string;
  cortadas: string;
  costo: string | null;
  href: string;
}

export interface VistaPruebas extends BaseParte {
  puedeCorrer: boolean;
  casos: { total: number; intencion: number; base: number; lista: { id: string; tipo: string; texto: string; esperado: string }[]; texto: string };
  opcionesMotores: { interpretar: { valor: string; texto: string }[]; responder: { valor: string; texto: string }[] };
  motoresBot: { interpretar: { principal: string; respaldo: string; doble: boolean }; responder: { principal: string; respaldo: string } };
  corridas: FilaCorrida[];
  enCurso: { id: string; hechos: number; total: number } | null;
  hrefComparar: string;
  hrefCasos: string;
}

const fila = (ctx: ContextoPantalla, r: Corrida, versiones: Map<string, number>, borrador: { id: string; seq: number } | null, verCostos: boolean): FilaCorrida => {
  const s = r.resumen;
  return {
    id: r.id, fecha: fechaHoraUtc(r.creadaEn), version: `v${versiones.get(r.versionId) ?? '?'} · cambio ${r.versionSeq}`,
    actual: !!borrador && borrador.id === r.versionId && borrador.seq === r.versionSeq,
    etiqueta: r.etiqueta, estado: r.estado, estadoTexto: ESTADO[r.estado], avance: `${r.hechos}/${r.total}`,
    acierto: num(s?.intencion.acierto), cuandoCoinciden: num(s?.intencion.aciertoCuandoCoinciden), aclaracion: num(s?.intencion.aclaracion),
    base: num(s?.base.acierto), cortadas: num(s?.base.cortadas), costo: verCostos ? usd(r.costoUsd) : null,
    href: hrefBot(ctx, r.botId, `pruebas/${r.id}`),
  };
};

export async function vistaPruebas(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaPruebas | null> {
  const x = await baseParte(repo, ctx, botId, 'pruebas');
  if (!x) return null;
  const def = x.b.definicion;
  const casos = def?.casos ?? [];
  const [corridas, versiones, motores, fichas] = await Promise.all([repo.corridas(x.b.bot.id), repo.versiones(x.b.bot.id), repo.motoresDeBot(x.b.bot.id), repo.fichas()]);
  const numeros = new Map(versiones.map((v) => [v.id, v.numero]));
  const verCostos = puede(ctx.rol, 'ver_costos');
  const borrador = x.b.borrador ? { id: x.b.borrador.id, seq: x.b.borrador.seq } : null;
  const enCurso = corridas.find((r) => r.estado === 'en_curso' && borrador && r.versionId === borrador.id && r.versionSeq === borrador.seq);
  const m = (f: string) => motores.find((y) => y.funcion === f);
  return {
    ...x.comun,
    puedeCorrer: puede(ctx.rol, 'correr_pruebas') && !ctx.organizacion.demo && x.comun.editable,
    casos: {
      total: casos.length, intencion: casos.filter((k) => k.tipo === 'intencion').length, base: casos.filter((k) => k.tipo === 'base').length,
      lista: casos.map((k) => ({ id: k.id, tipo: k.tipo === 'intencion' ? 'Intención' : 'Con base', texto: k.tipo === 'intencion' ? k.mensaje : k.pregunta, esperado: k.tipo === 'intencion' ? [k.intencion, ...k.alternativas].join(' o ') : `material: ${k.tieneRespuesta}` })),
      texto: casosComoTexto(casos),
    },
    opcionesMotores: {
      interpretar: motoresPara('interpretar', fichas).map((f) => ({ valor: f.id, texto: f.nombre })),
      responder: motoresPara('responder', fichas).map((f) => ({ valor: f.id, texto: f.nombre })),
    },
    motoresBot: {
      interpretar: { principal: m('interpretar')?.principal ?? '', respaldo: m('interpretar')?.respaldo ?? '', doble: !!m('interpretar')?.dobleLectura },
      responder: { principal: m('responder')?.principal ?? '', respaldo: m('responder')?.respaldo ?? '' },
    },
    corridas: corridas.map((r) => fila(ctx, r, numeros, borrador, verCostos)),
    enCurso: enCurso ? { id: enCurso.id, hechos: enCurso.hechos, total: enCurso.total } : null,
    hrefComparar: hrefBot(ctx, x.b.bot.id, 'pruebas/comparar'),
    hrefCasos: hrefBot(ctx, x.b.bot.id, 'pruebas/descargar'),
  };
}

// ── Una corrida ─────────────────────────────────────────────────────────────────────────────────

export interface FilaResultado {
  caso: string;
  tipo: string;
  texto: string;
  esperado: string;
  obtenido: string;
  detalle: string;
  ok: boolean | null;
}

export interface VistaCorrida {
  base: BaseParte;
  corrida: FilaCorrida;
  resumen: { etiqueta: string; valor: string; nota?: string }[];
  filas: FilaResultado[];
  soloErrores: boolean;
  hrefTodos: string;
  hrefErrores: string;
  hrefPruebas: string;
}

function filaResultado(r: ResultadoCaso): FilaResultado {
  const x = r.resultado as Record<string, unknown>;
  if (r.tipo === 'intencion') {
    const lectura = x.lectura === 'regla' ? `regla ${String(x.regla)}` : x.lectura === 'distintas' ? `no coinciden (${String(x.principal)} / ${String(x.respaldo)})${x.aclaracion ? ', pregunta' : ''}` : String(x.lectura ?? '');
    return { caso: r.caso, tipo: 'Intención', texto: String(x.mensaje ?? ''), esperado: (x.validas as string[] | undefined)?.join(' o ') ?? String(x.esperada ?? ''), obtenido: String(x.final ?? x.error ?? '—'), detalle: lectura, ok: r.ok };
  }
  const cortes = (x.cortes as string[] | undefined) ?? [];
  return {
    caso: r.caso, tipo: 'Con base', texto: String(x.pregunta ?? ''), esperado: `material: ${String(x.esperado)}${x.queDecir ? ` · ${String(x.queDecir)}` : ''}`,
    obtenido: x.error ? String(x.error) : `${String(x.tieneRespuesta ?? '')}${(x.secciones as string[] | undefined)?.length ? ` (${(x.secciones as string[]).join(', ')})` : ''}: ${String(x.respuesta ?? '')}`,
    detalle: cortes.length ? `Cortó el validador: ${cortes.join(' · ')}` : x.sinMaterial ? 'El bot no tiene material' : '', ok: r.ok,
  };
}

export function resumenLegible(s: ResumenCorrida | null): VistaCorrida['resumen'] {
  if (!s) return [];
  return [
    { etiqueta: 'Acierto de intenciones', valor: num(s.intencion.acierto), nota: `${s.intencion.casos} casos, ${s.intencion.porReglas} por reglas${s.intencion.sinRespuesta ? `, ${s.intencion.sinRespuesta} sin respuesta del motor` : ''}` },
    { etiqueta: 'Acierto cuando coinciden', valor: num(s.intencion.aciertoCuandoCoinciden), nota: `coinciden en el ${num(s.intencion.coinciden)} de lo que va al motor` },
    { etiqueta: 'Terminan en aclaración', valor: num(s.intencion.aclaracion), nota: 'las dos lecturas no coinciden y llevan a lugares distintos' },
    { etiqueta: 'Respuesta con base', valor: num(s.base.acierto), nota: `${s.base.casos} preguntas · contesta ${num(s.base.contesta)} · reconoce lo que falta ${num(s.base.reconoce)}` },
    { etiqueta: 'Cortadas por el validador', valor: num(s.base.cortadas) },
    { etiqueta: 'Demora típica', valor: s.demoraP50 === null ? '—' : `${(s.demoraP50 / 1000).toFixed(1).replace('.', ',')} s` },
  ];
}

export async function vistaCorrida(repo: Repositorio, ctx: ContextoPantalla, botId: string, corridaId: string): Promise<VistaCorrida | null> {
  const x = await baseParte(repo, ctx, botId, 'pruebas');
  if (!x) return null;
  const r = await repo.corrida(corridaId);
  if (!r || r.botId !== x.b.bot.id) return null;
  const versiones = new Map((await repo.versiones(x.b.bot.id)).map((v) => [v.id, v.numero]));
  const solo = ctx.parametros.solo === 'errores';
  const orden = r.resultados.slice().sort((a, b) => a.caso.localeCompare(b.caso));
  const verCostos = puede(ctx.rol, 'ver_costos');
  return {
    base: x.comun,
    corrida: fila(ctx, r, versiones, x.b.borrador ? { id: x.b.borrador.id, seq: x.b.borrador.seq } : null, verCostos),
    resumen: [...resumenLegible(r.resumen), ...(verCostos ? [{ etiqueta: 'Costo', valor: usd(r.costoUsd) }] : [])],
    filas: orden.filter((y) => !solo || y.ok !== true).map(filaResultado),
    soloErrores: solo,
    hrefTodos: hrefBot(ctx, x.b.bot.id, `pruebas/${r.id}`),
    hrefErrores: hrefBot(ctx, x.b.bot.id, `pruebas/${r.id}`, { solo: 'errores' }),
    hrefPruebas: hrefBot(ctx, x.b.bot.id, 'pruebas'),
  };
}

// ── Comparar dos corridas ───────────────────────────────────────────────────────────────────────

export interface VistaComparar {
  base: BaseParte;
  a: FilaCorrida | null;
  b: FilaCorrida | null;
  resumen: { etiqueta: string; a: string; b: string }[];
  mejoran: { caso: string; texto: string; a: string; b: string }[];
  empeoran: { caso: string; texto: string; a: string; b: string }[];
  enComun: number;
  opciones: { valor: string; texto: string }[];
  hrefPruebas: string;
}

export async function vistaComparar(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaComparar | null> {
  const x = await baseParte(repo, ctx, botId, 'pruebas');
  if (!x) return null;
  const todas = await repo.corridas(x.b.bot.id);
  const versiones = new Map((await repo.versiones(x.b.bot.id)).map((v) => [v.id, v.numero]));
  const verCostos = puede(ctx.rol, 'ver_costos');
  const borrador = x.b.borrador ? { id: x.b.borrador.id, seq: x.b.borrador.seq } : null;
  const terminadas = todas.filter((r) => r.estado === 'terminada');
  const idA = ctx.parametros.a ?? terminadas[1]?.id;
  const idB = ctx.parametros.b ?? terminadas[0]?.id;
  const [ra, rb] = await Promise.all([idA ? repo.corrida(idA) : null, idB ? repo.corrida(idB) : null]);
  const ok = (r: typeof ra) => (r && r.botId === x.b.bot.id ? r : null);
  const a = ok(ra);
  const b = ok(rb);
  const la = resumenLegible(a?.resumen ?? null);
  const lb = resumenLegible(b?.resumen ?? null);
  const texto = (r: ResultadoCaso) => filaResultado(r);
  const c = a && b ? compararCorridas(a.resultados, b.resultados) : { mejoran: [], empeoran: [], enComun: 0 };
  const par = (d: (typeof c.mejoran)[number]) => ({ caso: d.caso, texto: texto(d.a).texto, a: texto(d.a).obtenido, b: texto(d.b).obtenido });
  return {
    base: x.comun,
    a: a ? fila(ctx, a, versiones, borrador, verCostos) : null,
    b: b ? fila(ctx, b, versiones, borrador, verCostos) : null,
    resumen: (la.length ? la : lb).map((f, i) => ({ etiqueta: f.etiqueta, a: la[i]?.valor ?? '—', b: lb[i]?.valor ?? '—' }))
      .concat(verCostos && a && b ? [{ etiqueta: 'Costo', a: usd(a.costoUsd), b: usd(b.costoUsd) }] : []),
    mejoran: c.mejoran.map(par),
    empeoran: c.empeoran.map(par),
    enComun: c.enComun,
    opciones: terminadas.map((r) => ({ valor: r.id, texto: `${fechaHoraUtc(r.creadaEn)} · v${versiones.get(r.versionId) ?? '?'} · ${r.etiqueta}` })),
    hrefPruebas: hrefBot(ctx, x.b.bot.id, 'pruebas'),
  };
}
