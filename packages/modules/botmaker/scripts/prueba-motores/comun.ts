/**
 * Lo común de la prueba de motores (tarea 2.15): la capa de motores del producto con un repositorio en memoria (cada
 * "bot" de la prueba es una combinación de motores), las claves desde apps/web/.env.local y la corrida en paralelo.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FICHAS_MOTORES, type FichaMotor } from '../../dominio/motores';
import type { LlamadaMotor, MotorFuncion, NuevaLlamada, FuncionMotor } from '../../dominio/tipos';
import { CapaMotores, type RepositorioCapa } from '../../motores/capa';
import { VARIABLE_CLAVE } from '../../motores/claves';
import { AdaptadorOpenRouter } from '../../motores/openrouter';
import { AdaptadorSimulado } from '../../motores/simulado';

export const RAIZ = new URL('../../../../../', import.meta.url).pathname;

/** Carga apps/web/.env.local (las claves viven ahí, con permisos 600; nunca se imprimen). */
export function cargarEntorno(): void {
  const archivo = join(RAIZ, 'apps/web/.env.local');
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

export interface Opciones {
  motores: string[];
  limite: number | null;
  paralelo: number;
  simular: boolean;
  juez: string;
  tiempoMs: number | null;
  apagados: boolean;
}

export function leerOpciones(argv: string[], porDefecto: { motores: string[]; juez?: string }): Opciones {
  const valor = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    motores: (valor('motores') ?? porDefecto.motores.join(',')).split(',').map((x) => x.trim()).filter(Boolean),
    limite: valor('limite') ? Number(valor('limite')) : null,
    paralelo: Number(valor('paralelo') ?? 3),
    simular: argv.includes('--simular'),
    juez: valor('juez') ?? porDefecto.juez ?? 'claude-sonnet-5',
    tiempoMs: valor('tiempo') ? Number(valor('tiempo')) : null,
    apagados: argv.includes('--incluir-apagados'),
  };
}

/**
 * Una combinación de motores: "a" solo, "a>b" con respaldo en serie, "a+b" en doble lectura (solo interpretar).
 * Se usa como id del bot de la prueba, así la capa elige sola.
 */
export function motorFuncion(spec: string, funcion: FuncionMotor, tiempoMs: number): MotorFuncion {
  const doble = spec.includes('+');
  const [principal, respaldo] = spec.split(/[+>]/);
  return { funcion, principal: principal!, respaldo: respaldo ?? null, tiempoMaximoMs: tiempoMs, dobleLectura: doble && funcion === 'interpretar' };
}

export function validarSpecs(specs: string[], funcion: FuncionMotor, apagados: boolean): string[] {
  const errores: string[] = [];
  for (const s of specs) {
    for (const id of s.split(/[+>]/)) {
      const f = FICHAS_MOTORES.find((x) => x.id === id);
      if (!f) errores.push(`No existe el motor ${id}. Los que hay: ${FICHAS_MOTORES.map((x) => x.id).join(', ')}.`);
      else if (!f.funciones.includes(funcion)) errores.push(`${id} no sirve para ${funcion}.`);
      else if (!f.activo && !apagados) errores.push(`${id} está apagado: agregá --incluir-apagados para probarlo igual.`);
    }
  }
  return errores;
}

export function armarCapa(o: Opciones, funcion: FuncionMotor, tiempoMs: number) {
  const llamadas: LlamadaMotor[] = [];
  const fichas: FichaMotor[] = FICHAS_MOTORES.map((f) => ({ ...f, activo: f.activo || o.apagados }));
  const repo: RepositorioCapa = {
    async topesBot() { return { diarioUsd: 1e6, mensualUsd: 1e6 }; },
    async fichas() { return fichas; },
    async motoresDeBot(botId) { return [motorFuncion(botId, funcion, tiempoMs)]; },
    async gastoBot() { return 0; },
    async registrarLlamada(l: NuevaLlamada) { llamadas.push({ ...l, id: llamadas.length + 1, fecha: l.fecha ?? new Date().toISOString() }); },
  };
  const capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorOpenRouter(), simulado: new AdaptadorSimulado() }, simular: o.simular });
  return { capa, llamadas, fichas };
}

export function faltaClave(o: Opciones): string | null {
  if (o.simular) return null;
  const v = VARIABLE_CLAVE.pruebas;
  return process.env[v]?.trim() ? null : `Falta ${v} (la clave de tareas de fondo). Cargala con scripts/cargar-variable.sh ${v} o corré con --simular.`;
}

/** Corre `tarea` sobre cada elemento con hasta `n` a la vez, mostrando el avance. */
export async function enParalelo<T, R>(items: T[], n: number, tarea: (x: T, i: number) => Promise<R>, etiqueta: string): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  let hechos = 0;
  const trabajador = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= items.length) return;
      salida[i] = await tarea(items[i]!, i);
      hechos++;
      if (hechos % 10 === 0 || hechos === items.length) process.stdout.write(`\r  ${etiqueta}: ${hechos}/${items.length}   `);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, n) }, trabajador));
  process.stdout.write('\n');
  return salida;
}

export function carpetaResultados(nombre: string): string {
  const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = join(RAIZ, 'resultados', `${fecha}-${nombre}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const percentil = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]!;
};
export const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);
export const usd = (x: number) => `USD ${x.toFixed(4)}`;
