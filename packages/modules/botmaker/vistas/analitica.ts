/**
 * Analítica (8.01): cuántas conversaciones hubo y cómo terminaron, qué consultó la gente, por dónde pasó y dónde dejó,
 * y lo que costaron los motores en vivo. Sale de los eventos del bot, que no tienen textos de personas. Días y horas en
 * UTC.
 *
 * La ven todos los que entran a BotMaker (acción `ver`: la matriz dice «ver bots, flujos, contenidos y métricas»); el
 * costo, quienes ven costos. Los recorridos y el embudo por flujo son de un bot: las cajas de dos bots armados con la
 * misma plantilla se llaman igual y no se suman.
 */
import type { Repositorio } from '../datos/repositorio';
import {
  ETIQUETA_RESULTADO, porcentaje, resumirAnalitica, RESULTADOS, type DatosAnalitica, type FiltroAnalitica, type NumerosCaja,
} from '../dominio/analitica';
import { CANALES, ETIQUETA_CANAL, type Canal } from '../dominio/conversaciones';
import { etiquetaConsulta, INTENCIONES_SIN_CONSULTA } from '../dominio/contactos';
import { opcionesDe, ubicar, validarDefinicion, type Definicion } from '../dominio/definicion';
import { entero, fechaHoraUtc, fechaUtc, usd } from '../dominio/formato';
import { ETIQUETA_FUNCION, fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import type { Bot, FuncionMotor } from '../dominio/tipos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { hrefBot } from './bot-comun';
import { mensajeDe, type MensajePantalla } from './mensajes';

export const PERIODOS = [
  { valor: 'hoy', texto: 'Hoy', dias: 1 },
  { valor: '7', texto: 'Últimos 7 días', dias: 7 },
  { valor: '30', texto: 'Últimos 30 días', dias: 30 },
  { valor: '90', texto: 'Últimos 90 días', dias: 90 },
] as const;
const TODOS = 'todos';
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** La definición con que se leen los nombres de un bot: la publicada o, si no hay, la última versión. */
export async function definicionDeBot(repo: Repositorio, bot: Bot): Promise<Definicion | null> {
  const id = bot.versionPublicadaId ?? (await repo.versiones(bot.id))[0]?.id ?? null;
  const v = id ? await repo.version(id) : null;
  const d = v ? validarDefinicion(v.definicion) : null;
  return d?.ok ? d.definicion : null;
}

/** El período de la dirección: desde y hasta (días en UTC) o uno de los períodos; 30 días si no hay nada. */
export function periodoDe(p: Record<string, string | undefined>, ahora: Date): { desde: string; hasta: string; periodo: string; desdeDia: string; hastaDia: string } {
  const inicioHoy = new Date(ahora);
  inicioHoy.setUTCHours(0, 0, 0, 0);
  if (p.desde && DIA.test(p.desde) && p.hasta && DIA.test(p.hasta) && p.desde <= p.hasta) {
    const hasta = new Date(`${p.hasta}T00:00:00.000Z`);
    hasta.setUTCDate(hasta.getUTCDate() + 1);
    return { desde: `${p.desde}T00:00:00.000Z`, hasta: hasta.toISOString(), periodo: '', desdeDia: p.desde, hastaDia: p.hasta };
  }
  const per = PERIODOS.find((x) => x.valor === p.periodo) ?? PERIODOS[2];
  const desde = new Date(inicioHoy.getTime() - (per.dias - 1) * 864e5);
  return { desde: desde.toISOString(), hasta: ahora.toISOString(), periodo: per.valor, desdeDia: desde.toISOString().slice(0, 10), hastaDia: ahora.toISOString().slice(0, 10) };
}

export interface FilaRanking {
  texto: string;
  n: string;
  porcentaje: string;
  /** Ancho de la barra, de 0 a 100. */
  ancho: number;
  href?: string;
}

export interface VistaAnalitica {
  mensaje: MensajePantalla | null;
  filtros: { bot: string; canal: string; version: string; periodo: string; desde: string; hasta: string };
  opcionesBot: { valor: string; texto: string }[];
  opcionesCanal: { valor: string; texto: string }[];
  opcionesVersion: { valor: string; texto: string }[];
  opcionesPeriodo: { valor: string; texto: string }[];
  rango: string;
  actualizada: string;
  vacia: boolean;
  kpis: { etiqueta: string; valor: string; nota: string }[];
  porDia: { dia: string; n: number; alto: number; titulo: string }[];
  resultados: { clave: string; texto: string; n: string; porcentaje: string; ancho: number }[];
  consultas: FilaRanking[];
  temas: FilaRanking[];
  noEntendidas: { texto: string; n: string }[];
  /** Solo con un bot elegido. */
  bot: {
    nombre: string;
    hrefDiagrama: string;
    recorridos: FilaRanking[];
    embudo: {
      flujo: string;
      cajas: { direccion: string; nombre: string; visitas: string; abandonos: string; abandono: string; opciones: string; alerta: boolean; hrefCaja: string }[];
    }[];
  } | null;
  costos: { filas: { funcion: string; motor: string; costo: string; llamadas: string }[]; total: string; porConversacion: string; hrefCostos: string } | null;
}

const ancho = (n: number, max: number) => (max > 0 ? Math.max(2, Math.round((100 * n) / max)) : 0);

function ranking(items: { texto: string; n: number; href?: string }[], total: number, limite = 10): FilaRanking[] {
  const max = Math.max(0, ...items.map((x) => x.n));
  return items.slice(0, limite).map((x) => ({ texto: x.texto, n: entero(x.n), porcentaje: porcentaje(x.n, total), ancho: ancho(x.n, max), ...(x.href ? { href: x.href } : {}) }));
}

/** Las cajas que solo pasan de largo (ir a otro flujo, condición) no aportan al recorrido que se lee. */
function recorridoLegible(def: Definicion | null, recorrido: string): string {
  return recorrido.split('>').filter((id) => {
    const t = def ? ubicar(def, id)?.caja.tipo : undefined;
    return t !== 'ir_a_flujo' && t !== 'condicion';
  }).map((id) => {
    const u = def ? ubicar(def, id) : null;
    return u?.caja.nombre || id;
  }).join(' › ');
}

export async function vistaAnalitica(repo: Repositorio, ctx: ContextoPantalla, ahora = new Date()): Promise<VistaAnalitica> {
  const p = ctx.parametros;
  const bots = await repo.bots(ctx.campana.id, { archivados: true });
  // Si hay un solo bot publicado, arranca con él (con su embudo); si hay varios, con todos.
  const publicados = bots.filter((b) => b.estado === 'publicado');
  const porDefecto = publicados.length === 1 ? publicados[0]!.id : TODOS;
  const botId = p.bot === TODOS ? TODOS : bots.some((b) => b.id === p.bot) ? p.bot! : porDefecto;
  const bot = bots.find((b) => b.id === botId) ?? null;
  const canal = (CANALES as readonly string[]).includes(p.canal ?? '') ? (p.canal as Canal) : '';
  const versiones = bot ? await repo.versiones(bot.id) : [];
  const version = versiones.some((v) => v.id === p.version) ? p.version! : '';
  const per = periodoDe(p, ahora);
  const filtro: FiltroAnalitica = { desde: per.desde, hasta: per.hasta, ...(bot ? { botId: bot.id } : {}), ...(canal ? { canal } : {}), ...(version ? { versionId: version } : {}) };
  const [d, defs] = await Promise.all([
    repo.analitica(ctx.campana.id, filtro, ctx.persona.id),
    Promise.all(bots.map(async (b) => [b.id, await definicionDeBot(repo, b)] as const)).then((x) => new Map(x)),
  ]);
  const def = bot ? defs.get(bot.id) ?? null : null;
  const todas = [...defs.values()];
  const nombre = (tipo: 'tema' | 'intencion', clave: string) => {
    if (def) return etiquetaConsulta(def, { tipo, clave });
    for (const x of todas) {
      const t = etiquetaConsulta(x, { tipo, clave });
      if (t !== clave) return t;
    }
    return clave;
  };
  const r = resumirAnalitica(d);
  const filtroHref = (extra: Record<string, string | undefined>) => ruta(ctx, 'contactos', { ...(bot ? { bot: bot.id } : {}), ...extra });

  // Conversaciones por día, con los días sin conversaciones en cero.
  const dias: string[] = [];
  for (let t = Date.parse(`${per.desdeDia}T00:00:00.000Z`); t <= Date.parse(`${per.hastaDia}T00:00:00.000Z`) && dias.length < 120; t += 864e5) dias.push(new Date(t).toISOString().slice(0, 10));
  const porDiaMapa = new Map(d.porDia.map((x) => [x.dia, x.n]));
  const maxDia = Math.max(0, ...dias.map((x) => porDiaMapa.get(x) ?? 0));

  const consultas = r.intenciones.filter((x) => !INTENCIONES_SIN_CONSULTA.includes(x.clave));
  const totalConsultas = consultas.reduce((s, x) => s + x.n, 0);
  const totalTemas = r.temas.reduce((s, x) => s + x.n, 0);
  const n = (clave: string) => r.intenciones.find((x) => x.clave === clave)?.n ?? 0;
  const maxResultado = Math.max(0, ...RESULTADOS.map((x) => r.resultados[x]));

  let costos: VistaAnalitica['costos'] = null;
  if (d.costos && puede(ctx.rol, 'ver_costos')) {
    const total = d.costos.reduce((s, x) => s + x.usd, 0);
    costos = {
      filas: d.costos.map((x) => ({
        funcion: ETIQUETA_FUNCION[x.funcion as FuncionMotor] ?? x.funcion, motor: fichaMotor(x.motor)?.nombre ?? x.motor, costo: usd(x.usd), llamadas: entero(x.llamadas),
      })),
      total: usd(total),
      porConversacion: r.conversaciones ? usd(total / r.conversaciones) : '—',
      hrefCostos: ruta(ctx, 'costos'),
    };
  }

  return {
    mensaje: mensajeDe(p),
    filtros: { bot: botId, canal, version, periodo: per.periodo, desde: per.desdeDia, hasta: per.hastaDia },
    opcionesBot: [{ valor: TODOS, texto: 'Todos los bots' }, ...bots.map((b) => ({ valor: b.id, texto: `${b.nombre}${b.estado === 'publicado' ? '' : ` (${b.estado})`}` }))],
    opcionesCanal: CANALES.map((c) => ({ valor: c, texto: ETIQUETA_CANAL[c] })),
    opcionesVersion: versiones.map((v) => ({ valor: v.id, texto: `v${v.numero} · ${v.estado}` })),
    opcionesPeriodo: PERIODOS.map((x) => ({ valor: x.valor, texto: x.texto })),
    rango: `del ${fechaUtc(per.desdeDia)} al ${fechaUtc(per.hastaDia)} (UTC)`,
    actualizada: d.actualizadaEn ? `Sumado hasta el ${fechaHoraUtc(d.actualizadaEn)}: la tarea de fondo suma lo nuevo cada 10 minutos.` : 'Al momento.',
    vacia: r.conversaciones === 0 && r.terminadas === 0,
    kpis: [
      { etiqueta: 'Conversaciones', valor: entero(r.conversaciones), nota: `${entero(r.textos)} mensajes escritos` },
      { etiqueta: 'Resueltas', valor: porcentaje(r.resultados.resuelta, r.terminadas), nota: `${entero(r.resultados.resuelta)} de ${entero(r.terminadas)} terminadas` },
      { etiqueta: 'Derivadas al equipo', valor: entero(r.derivadas), nota: `${entero(r.resultados.derivada)} terminaron sin que nadie las atendiera` },
      { etiqueta: 'No entendidas', valor: porcentaje(r.noEntendidas, r.textos), nota: `${entero(r.noEntendidas)} mensajes que el bot no pudo leer` },
    ],
    porDia: dias.map((x) => ({ dia: x, n: porDiaMapa.get(x) ?? 0, alto: ancho(porDiaMapa.get(x) ?? 0, maxDia), titulo: `${fechaUtc(x)}: ${entero(porDiaMapa.get(x) ?? 0)} conversaciones` })),
    resultados: RESULTADOS.map((x) => ({ clave: x, texto: ETIQUETA_RESULTADO[x], n: entero(r.resultados[x]), porcentaje: porcentaje(r.resultados[x], r.terminadas), ancho: ancho(r.resultados[x], maxResultado) })),
    consultas: ranking(consultas.map((x) => ({ texto: nombre('intencion', x.clave), n: x.n, href: puede(ctx.rol, 'leer_conversaciones') ? filtroHref({ consulta: `intencion:${x.clave}` }) : undefined })), totalConsultas),
    temas: ranking(r.temas.map((x) => ({ texto: nombre('tema', x.clave), n: x.n, href: puede(ctx.rol, 'leer_conversaciones') ? filtroHref({ consulta: `tema:${x.clave}` }) : undefined })), totalTemas),
    noEntendidas: [
      { texto: 'No se entendió (sin sentido, audio o imagen sin texto)', n: entero(n('no_entendible')) },
      { texto: 'Sin motor disponible (tope de gasto o falla)', n: entero(d.metricas.filter((x) => x.metrica === 'sin_motor').reduce((s, x) => s + x.n, 0)) },
      { texto: 'Las dos lecturas no coincidieron y el bot preguntó', n: entero(r.aclaraciones) },
      { texto: 'Fuera de tema', n: entero(n('fuera_de_tema')) },
      { texto: 'Intentos de manipular al bot', n: entero(n('intento_manipulacion')) },
      { texto: 'Pasaron a solo menús por el límite de mensajes', n: entero(r.soloMenus) },
    ],
    bot: bot ? {
      nombre: bot.nombre,
      hrefDiagrama: hrefBot(ctx, bot.id, 'flujos', { numeros: 'si' }),
      recorridos: (() => {
        const legibles = new Map<string, number>();
        for (const x of r.recorridos) {
          const t = recorridoLegible(def, x.recorrido);
          legibles.set(t, (legibles.get(t) ?? 0) + x.n);
        }
        return ranking([...legibles].map(([texto, k]) => ({ texto, n: k })).sort((a, b) => b.n - a.n), r.terminadas, 8);
      })(),
      embudo: def ? def.flujos.map((f) => ({
        flujo: `${f.codigo}. ${f.nombre}`,
        cajas: f.cajas.filter((c) => c.tipo !== 'ir_a_flujo' && c.tipo !== 'condicion').map((c) => {
          const x: NumerosCaja = r.porCaja.get(c.id) ?? { visitas: 0, abandonos: 0, derivadas: 0, opciones: {} };
          const elegidas = Object.values(x.opciones).reduce((s, k) => s + k, 0);
          return {
            direccion: `${f.codigo}.${c.codigo}`, nombre: c.nombre ?? '', visitas: x.visitas ? entero(x.visitas) : '—', abandonos: x.abandonos ? entero(x.abandonos) : '—',
            abandono: x.visitas ? porcentaje(x.abandonos, x.visitas) : '—',
            opciones: opcionesDe(c).filter((o) => x.opciones[o.letra]).map((o) => `${o.letra} ${o.texto}: ${porcentaje(x.opciones[o.letra] ?? 0, elegidas)}`).join(' · '),
            alerta: x.visitas >= 10 && x.abandonos / x.visitas >= 0.3,
            hrefCaja: hrefBot(ctx, bot.id, 'flujos', { caja: c.id, numeros: 'si' }),
          };
        }),
      })).filter((f) => f.cajas.length) : [],
    } : null,
    costos,
  };
}

// ── Números sobre el diagrama ───────────────────────────────────────────────────────────────────

export interface NumerosDiagrama {
  periodo: string;
  porCaja: Record<string, { visitas: string; abandono: string | null; titulo: string; opciones: Record<string, string> }>;
}

/** Visitas por caja, porcentaje de cada opción y abandono de los últimos 30 días de un bot (null si no conversó). */
export async function numerosDiagrama(repo: Repositorio, ctx: ContextoPantalla, bot: Bot, ahora = new Date()): Promise<NumerosDiagrama | null> {
  const per = periodoDe({ periodo: '30' }, ahora);
  let d: DatosAnalitica;
  try {
    d = await repo.analitica(ctx.campana.id, { botId: bot.id, desde: per.desde, hasta: per.hasta }, ctx.persona.id);
  } catch {
    return null;
  }
  const r = resumirAnalitica(d);
  if (!r.porCaja.size) return null;
  const porCaja: NumerosDiagrama['porCaja'] = {};
  for (const [id, x] of r.porCaja) {
    const elegidas = Object.values(x.opciones).reduce((s, k) => s + k, 0);
    porCaja[id] = {
      visitas: entero(x.visitas),
      abandono: x.visitas && x.abandonos ? porcentaje(x.abandonos, x.visitas) : null,
      titulo: `${entero(x.visitas)} visitas en 30 días${x.abandonos ? ` · ${entero(x.abandonos)} conversaciones terminaron acá sin resolver` : ''}`,
      opciones: Object.fromEntries(Object.entries(x.opciones).map(([letra, k]) => [letra, porcentaje(k, elegidas)])),
    };
  }
  return { periodo: `${fechaUtc(per.desdeDia)} al ${fechaUtc(per.hastaDia)}`, porCaja };
}
