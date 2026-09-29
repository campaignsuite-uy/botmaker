/**
 * Núcleo de las corridas de prueba (etapa 4, tareas 4.04 y 4.05), sin Next. La app las corre en tandas: el navegador
 * pide la siguiente tanda hasta terminar (si se cierra la pestaña, la corrida se retoma donde quedó). Cada caso pasa
 * por la capa de motores con uso "pruebas", con los motores del bot o con otra combinación para comparar.
 *
 * Una corrida es de un cambio del borrador: si el borrador cambia en el medio, se cancela (mezclaría dos versiones).
 */
import { ErrorDatos } from '../datos/errores';
import { materialPara, ubicar, type Caso, type Definicion } from '../dominio/definicion';
import { evaluarBase, etiquetaMotores, resumirCorrida, type ResultadoCaso } from '../dominio/corridas';
import { fichaMotor, type FichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { reglaAntesDelMotor } from '../dominio/reglas';
import type { Bot, MotorFuncion } from '../dominio/tipos';
import { validarDatos } from '../dominio/validar-datos';
import type { CapaMotores } from '../motores/capa';
import { contextoDeBot } from '../motores/servicios';
import type { ContextoNucleo, Salida } from './ejecutar-bots';
import { leerBorrador } from './ejecutar-borrador';

export const TANDA = 12;
const PARALELO = 3;

type Contexto = ContextoNucleo & { campana: { nombre: string } };
export type FabricaCapa = (motores?: MotorFuncion[]) => CapaMotores;

async function paralelo<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await f(xs[k]!);
    }
  }));
  return out;
}

/** Corre un caso con la capa: reglas y doble lectura para las intenciones; material y validador para las preguntas. */
export async function correrCaso(capa: CapaMotores, bot: Bot, campana: { nombre: string }, def: Definicion, caso: Caso, personaId: string): Promise<ResultadoCaso> {
  const contexto = contextoDeBot({ bot, campana, definicion: def });
  const pedido = { uso: 'pruebas' as const, bot: { id: bot.id, campanaId: bot.campanaId }, contexto, personaId };
  if (caso.tipo === 'intencion') {
    const validas = new Set([caso.intencion, ...caso.alternativas]);
    const base = { mensaje: caso.mensaje, esperada: caso.intencion, validas: [...validas] };
    const regla = reglaAntesDelMotor(caso.mensaje);
    if (regla) return { caso: caso.id, tipo: 'intencion', ok: validas.has(regla.intencion), costo: 0, resultado: { ...base, lectura: 'regla', regla: regla.regla, final: regla.intencion, aclaracion: false } };
    const r = await capa.llamar({
      ...pedido, funcion: 'interpretar',
      entrada: {
        mensaje: caso.mensaje, turnos: [],
        intenciones: def.intenciones.map((i) => ({ id: i.id, descripcion: i.descripcion, ...(i.limite ? { limite: i.limite } : {}), ejemplos: i.frases })),
        temas: def.temas.map((t) => ({ id: t.id, nombre: t.nombre })),
      },
    });
    if (!r.salida) return { caso: caso.id, tipo: 'intencion', ok: null, costo: r.costoUsd, resultado: { ...base, lectura: 'ninguna', error: r.intentos.map((i) => `${i.motorId}: ${i.error}`).join(' · ') || r.motivo, demoraMs: r.demoraMs } };
    const libre = ubicar(def, def.textoLibre)?.caja;
    const rutas = libre?.tipo === 'interpretar' ? libre.rutas : {};
    const destino = (i: string) => (i in rutas ? rutas[i] : def.intenciones.find((x) => x.id === i)?.destino ?? null);
    const otra = r.salida.alternativas[0]?.intencion;
    const aclaracion = r.lectura?.resultado === 'distintas' && !!otra && destino(otra) !== destino(r.salida.intencion);
    return {
      caso: caso.id, tipo: 'intencion', ok: validas.has(r.salida.intencion), costo: r.costoUsd,
      resultado: {
        ...base, lectura: r.lectura?.resultado ?? 'una', principal: r.lectura?.principal ?? r.salida.intencion, respaldo: r.lectura?.respaldo ?? null,
        final: r.salida.intencion, tema: r.salida.tema, aclaracion, motor: r.motorId, demoraMs: r.demoraMs,
      },
    };
  }
  const material = materialPara(def, []);
  const base = { pregunta: caso.pregunta, esperado: caso.tieneRespuesta, queDecir: caso.queDecir };
  if (!material.length) return { caso: caso.id, tipo: 'base', ok: evaluarBase(caso.tieneRespuesta, 'no', 0), costo: 0, resultado: { ...base, tieneRespuesta: 'no', respuesta: '', secciones: [], cortes: [], sinMaterial: true } };
  const r = await capa.llamar({ ...pedido, funcion: 'responder', entrada: { pregunta: caso.pregunta, turnos: [], material } });
  if (!r.salida) return { caso: caso.id, tipo: 'base', ok: null, costo: r.costoUsd, resultado: { ...base, error: r.intentos.map((i) => `${i.motorId}: ${i.error}`).join(' · ') || r.motivo, demoraMs: r.demoraMs } };
  const citadas = material.filter((s) => r.salida!.secciones.includes(s.codigo)).map((s) => `${s.titulo}\n${s.texto}\n${s.fuente}`);
  const otros = [caso.pregunta, ...def.variables.map((v) => v.valor ?? ''), def.contacto.consultas?.valor ?? '', def.contacto.aportes?.valor ?? ''];
  const cortes = validarDatos(r.salida.respuesta, { citadas, otros }).map((c) => `${c.tipo}: ${c.valor}`);
  return {
    caso: caso.id, tipo: 'base', ok: evaluarBase(caso.tieneRespuesta, r.salida.tiene_respuesta, cortes.length), costo: r.costoUsd,
    resultado: { ...base, respuesta: r.salida.respuesta, secciones: r.salida.secciones, tieneRespuesta: r.salida.tiene_respuesta, cortes, motor: r.motorId, demoraMs: r.demoraMs },
  };
}

export interface EleccionCorrida {
  interpretar?: { principal: string; respaldo: string | null; dobleLectura: boolean };
  responder?: { principal: string; respaldo: string | null };
}

/** Empieza una corrida del borrador: con los motores del bot o con los elegidos para comparar. */
export async function ejecutarIniciarCorrida(c: Contexto, e: { botId: string; motores?: EleccionCorrida | null }): Promise<Salida & { corridaId?: string; total?: number }> {
  if (!puede(c.rol, 'correr_pruebas')) return { tipo: 'error', codigo: 'sin_permiso' };
  const bot = await c.repo.bot(e.botId);
  if (!bot || bot.campanaId !== c.campanaId) return { tipo: 'error', codigo: 'no_existe' };
  const l = await leerBorrador(c.repo, bot.id);
  if ('codigo' in l) return { tipo: 'error', codigo: l.codigo };
  if (!l.definicion.casos.length) return { tipo: 'error', codigo: 'sin_casos' };
  const [delBot, fichas] = await Promise.all([c.repo.motoresDeBot(bot.id), c.repo.fichas()]);
  const motores = combinar(delBot, e.motores ?? null, fichas);
  if ('codigo' in motores) return { tipo: 'error', codigo: motores.codigo };
  const nombre = (id: string) => fichaMotor(id, fichas)?.nombre ?? id;
  const etiqueta = `${e.motores ? '' : 'Motores del bot · '}${etiquetaMotores(motores.elegidos, nombre)}`;
  try {
    const id = await c.repo.crearCorrida(l.borrador.id, motores.elegidos, etiqueta, l.definicion.casos.length, c.personaId);
    return { tipo: 'ok', codigo: 'corrida_iniciada', corridaId: id, total: l.definicion.casos.length };
  } catch (x) {
    return { tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' };
  }
}

/** La combinación de una corrida: la del bot, con lo que se haya elegido encima. Valida que cada motor sirva. */
type Elegidos = Record<string, { principal: string; respaldo: string | null; dobleLectura: boolean; tiempoMaximoMs: number }>;

export function combinar(delBot: MotorFuncion[], eleccion: EleccionCorrida | null, fichas: readonly FichaMotor[]): { elegidos: Elegidos } | { codigo: string } {
  const elegidos: Elegidos = {};
  for (const f of ['interpretar', 'responder'] as const) {
    const m = delBot.find((x) => x.funcion === f);
    const e = eleccion?.[f];
    const principal = e?.principal ?? m?.principal;
    if (!principal) continue;
    const respaldo = e ? e.respaldo : m?.respaldo ?? null;
    for (const id of [principal, respaldo].filter((x): x is string => !!x)) {
      const ficha = fichaMotor(id, fichas);
      if (!ficha || !ficha.activo) return { codigo: 'motor' };
      if (!ficha.funciones.includes(f)) return { codigo: 'motor_funcion' };
    }
    if (respaldo === principal) return { codigo: 'respaldo_igual' };
    const doble = f === 'interpretar' && !!respaldo && (e && 'dobleLectura' in e ? e.dobleLectura : m?.dobleLectura ?? false);
    elegidos[f] = { principal, respaldo, dobleLectura: doble, tiempoMaximoMs: m?.tiempoMaximoMs ?? (f === 'interpretar' ? 2500 : 5000) };
  }
  return { elegidos };
}

/** Corre la siguiente tanda de casos pendientes; al terminar, guarda el resumen y cierra la corrida. */
export async function ejecutarAvanzarCorrida(c: Contexto, fabrica: FabricaCapa, e: { corridaId: string }): Promise<Salida & { hechos?: number; total?: number; terminada?: boolean }> {
  if (!puede(c.rol, 'correr_pruebas')) return { tipo: 'error', codigo: 'sin_permiso' };
  const r = await c.repo.corrida(e.corridaId);
  if (!r) return { tipo: 'error', codigo: 'no_existe' };
  const bot = await c.repo.bot(r.botId);
  if (!bot || bot.campanaId !== c.campanaId) return { tipo: 'error', codigo: 'no_existe' };
  if (r.estado !== 'en_curso') return { tipo: 'ok', codigo: 'corrida_terminada', hechos: r.hechos, total: r.total, terminada: true };
  try {
    const v = await c.repo.version(r.versionId);
    if (!v) return { tipo: 'error', codigo: 'no_existe' };
    if (v.seq !== r.versionSeq) {
      await c.repo.cerrarCorrida(r.id, null, 'cancelada', c.personaId);
      return { tipo: 'error', codigo: 'corrida_vieja' };
    }
    const l = await leerBorrador(c.repo, bot.id);
    const def = 'codigo' in l || l.borrador.id !== r.versionId ? null : l.definicion;
    if (!def) return { tipo: 'error', codigo: 'borrador_invalido' };
    const hechos = new Set(r.resultados.map((x) => x.caso));
    const pendientes = def.casos.filter((k) => !hechos.has(k.id)).slice(0, TANDA);
    const motores = Object.entries(r.motores).map(([funcion, m]) => ({ funcion, ...(m as object) })) as MotorFuncion[];
    const capa = fabrica(motores);
    const resultados = await paralelo(pendientes, PARALELO, (k) => correrCaso(capa, bot, c.campana, def, k, c.personaId));
    let n = r.hechos;
    if (resultados.length) n = await c.repo.guardarResultados(r.id, resultados, c.personaId);
    const terminada = n >= def.casos.length;
    if (terminada) {
      const todo = await c.repo.corrida(r.id);
      await c.repo.cerrarCorrida(r.id, resumirCorrida(todo?.resultados ?? []), 'terminada', c.personaId);
    }
    return { tipo: 'ok', codigo: terminada ? 'corrida_terminada' : 'corrida_avanza', hechos: n, total: def.casos.length, terminada };
  } catch (x) {
    return { tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' };
  }
}

export async function ejecutarCancelarCorrida(c: Contexto, e: { corridaId: string }): Promise<Salida> {
  if (!puede(c.rol, 'correr_pruebas')) return { tipo: 'error', codigo: 'sin_permiso' };
  const r = await c.repo.corrida(e.corridaId);
  const bot = r ? await c.repo.bot(r.botId) : null;
  if (!r || !bot || bot.campanaId !== c.campanaId) return { tipo: 'error', codigo: 'no_existe' };
  try {
    await c.repo.cerrarCorrida(r.id, null, 'cancelada', c.personaId);
    return { tipo: 'ok', codigo: 'corrida_cancelada' };
  } catch (x) {
    return { tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' };
  }
}
