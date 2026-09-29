/**
 * Núcleo de las acciones sobre el borrador de un bot, sin Next: armarlo, aplicarle un cambio, deshacer y rehacer.
 * Como las demás: recibe el rol que resolvió el servidor, vuelve a exigir la acción, valida y llama al repositorio (que
 * en Supabase lo exige otra vez en la base). No es un archivo 'use server'.
 *
 * Un cambio se aplica sobre la definición guardada (dominio/operaciones.ts valida que el bot quede bien) y se guarda
 * con el seq que se leyó. Si otra persona guardó en el medio, se vuelve a leer y se aplica otra vez sobre lo último
 * (las operaciones dicen qué hacer, no cómo quedó todo). Deshacer y rehacer no se reintentan: si el borrador cambió, lo
 * que había para deshacer puede ser otra cosa.
 */
import { ErrorDatos } from '../datos/errores';
import type { Repositorio } from '../datos/repositorio';
import { validarDefinicion, type Definicion, type Problema } from '../dominio/definicion';
import { aplicarCambio, aplicarOperacion, ErrorOperacion, operacionImportar } from '../dominio/operaciones';
import { puede } from '../dominio/permisos';
import { plantillaPolitica } from '../dominio/plantilla-politica';
import type { Bot } from '../dominio/tipos';
import { pilasDeshacer, type Borrador, type OrigenCambio } from '../dominio/versiones';
import { exportarYaml, importarYaml, type ProblemaYaml } from '../dominio/yaml';
import type { ContextoNucleo, Salida } from './ejecutar-bots';
import { texto } from './comun';
import { operacionesDeForma } from './formularios-borrador';

/** Cómo queda el borrador después de una acción: lo que necesita la pantalla del editor. */
export interface EstadoBorrador {
  versionId: string;
  numero: number;
  seq: number;
  definicion: Definicion;
  /** El nombre del cambio que desharía el botón (null: no hay). */
  deshacer: string | null;
  rehacer: string | null;
}

export type ResultadoBorrador =
  | ({ ok: true; resumen: string; creados: string[]; otroCambio: boolean } & EstadoBorrador)
  | { ok: false; codigo: string; mensaje?: string; problemas?: Problema[]; problemasYaml?: ProblemaYaml[] };

const falla = (codigo: string, mensaje?: string, problemas?: Problema[]): ResultadoBorrador => ({
  ok: false, codigo, ...(mensaje ? { mensaje } : {}), ...(problemas?.length ? { problemas } : {}),
});

function deError(e: unknown): ResultadoBorrador {
  if (e instanceof ErrorOperacion) return falla(e.codigo, e.message, e.problemas);
  if (e instanceof ErrorDatos) return falla(e.codigo);
  return falla('no_se_pudo');
}

async function botEditable(c: ContextoNucleo, botId: string): Promise<Bot | ResultadoBorrador> {
  if (!puede(c.rol, 'editar_borrador')) return falla('sin_permiso');
  const b = await c.repo.bot(botId);
  if (!b || b.campanaId !== c.campanaId) return falla('no_existe');
  if (b.estado === 'archivado') return falla('archivado');
  return b;
}

/** El borrador guardado, con su definición validada. */
export async function leerBorrador(repo: Repositorio, botId: string): Promise<{ borrador: Borrador; definicion: Definicion } | { codigo: string; problemas?: Problema[] }> {
  const borrador = await repo.borrador(botId);
  if (!borrador) return { codigo: 'sin_borrador' };
  const v = validarDefinicion(borrador.definicion);
  if (!v.ok) return { codigo: 'borrador_invalido', problemas: v.problemas };
  return { borrador, definicion: v.definicion };
}

/** Las pilas de deshacer y rehacer del borrador, con el nombre de lo que haría cada botón. */
export async function pilasDelBorrador(repo: Repositorio, versionId: string) {
  return pilasDeshacer(await repo.cambios(versionId));
}

async function estado(repo: Repositorio, borrador: Borrador, seq: number, definicion: Definicion): Promise<EstadoBorrador> {
  const p = await pilasDelBorrador(repo, borrador.id);
  return { versionId: borrador.id, numero: borrador.numero, seq, definicion, deshacer: p.deshacer?.resumen ?? null, rehacer: p.rehacer?.resumen ?? null };
}

export interface EntradaCambio {
  botId: string;
  /** El seq del borrador que vio la persona (para avisarle si se aplicó sobre algo más nuevo). */
  seq: number;
  operaciones: unknown[];
  origen: Extract<OrigenCambio, 'editor' | 'yaml' | 'copiloto'>;
}

/** Aplica y guarda un cambio del borrador (una o varias operaciones que se deshacen juntas). */
export async function ejecutarCambio(c: ContextoNucleo, e: EntradaCambio, opciones: { azar?: () => number } = {}): Promise<ResultadoBorrador> {
  const b = await botEditable(c, e.botId);
  if ('ok' in b) return b;
  if (!Array.isArray(e.operaciones) || !e.operaciones.length) return falla('operacion_invalida');
  for (let intento = 1; ; intento++) {
    const l = await leerBorrador(c.repo, b.id);
    if ('codigo' in l) return falla(l.codigo, undefined, l.problemas);
    try {
      const r = aplicarCambio(l.definicion, e.operaciones, opciones);
      const seq = await c.repo.guardarCambio(
        l.borrador.id, l.borrador.seq, { origen: e.origen, operaciones: r.operaciones, inversa: r.inversa, resumen: r.resumen, objetivo: null }, r.definicion, c.personaId,
      );
      return { ok: true, resumen: r.resumen, creados: r.creados, otroCambio: l.borrador.seq !== e.seq, ...(await estado(c.repo, l.borrador, seq, r.definicion)) };
    } catch (x) {
      if (x instanceof ErrorDatos && x.codigo === 'borrador_cambio' && intento < 3) continue;
      return deError(x);
    }
  }
}

/** Deshace el último cambio hecho (o rehace el último deshecho), si el borrador sigue en el seq que vio la persona. */
export async function ejecutarDeshacer(c: ContextoNucleo, e: { botId: string; seq: number; rehacer?: boolean }): Promise<ResultadoBorrador> {
  const b = await botEditable(c, e.botId);
  if ('ok' in b) return b;
  const l = await leerBorrador(c.repo, b.id);
  if ('codigo' in l) return falla(l.codigo, undefined, l.problemas);
  if (l.borrador.seq !== e.seq) return falla('borrador_cambio');
  const pilas = await pilasDelBorrador(c.repo, l.borrador.id);
  const paso = e.rehacer ? pilas.rehacer : pilas.deshacer;
  if (!paso) return falla(e.rehacer ? 'nada_que_rehacer' : 'nada_que_deshacer');
  try {
    const desde = await c.repo.cambio(l.borrador.id, paso.desde);
    if (!desde) return falla('no_se_pudo');
    const r = aplicarOperacion(l.definicion, desde.inversa);
    const origen = e.rehacer ? 'rehacer' : 'deshacer';
    const resumen = `${e.rehacer ? 'Rehízo' : 'Deshizo'}: ${paso.resumen}`;
    const seq = await c.repo.guardarCambio(l.borrador.id, l.borrador.seq, { origen, operaciones: [desde.inversa], inversa: r.inversa, resumen, objetivo: paso.objetivo }, r.definicion, c.personaId);
    return { ok: true, resumen, creados: [], otroCambio: false, ...(await estado(c.repo, l.borrador, seq, r.definicion)) };
  } catch (x) {
    return deError(x);
  }
}

/**
 * Arma el borrador de un bot que no tiene: copia la versión publicada (o la última) o, si el bot no tiene ninguna
 * (los creados antes de las versiones), lo arma con la plantilla política y el candidato del formulario.
 */
export async function ejecutarCrearBorrador(c: ContextoNucleo, e: { botId: string; candidato: string; partido: string }): Promise<Salida> {
  const b = await botEditable(c, e.botId);
  if ('ok' in b) return { tipo: 'error', codigo: b.ok ? 'no_se_pudo' : b.codigo };
  try {
    if ((await c.repo.versiones(b.id)).length) {
      await c.repo.crearBorrador(b.id, null, c.personaId);
      return { tipo: 'ok', codigo: 'borrador_creado' };
    }
    const candidato = e.candidato.trim();
    if (!candidato) return { tipo: 'error', codigo: 'candidato_vacio' };
    if (candidato.length > 80) return { tipo: 'error', codigo: 'candidato_largo' };
    if (e.partido.trim().length > 80) return { tipo: 'error', codigo: 'partido_largo' };
    const definicion = plantillaPolitica({ candidato, partido: e.partido.trim() || null, trato: b.trato, mercado: b.mercado });
    await c.repo.crearBorrador(b.id, definicion, c.personaId);
    return { tipo: 'ok', codigo: 'borrador_creado' };
  } catch (x) {
    return { tipo: 'error', codigo: x instanceof ErrorDatos ? x.codigo : 'no_se_pudo' };
  }
}

// ── YAML ────────────────────────────────────────────────────────────────────────────────────────

const RE_EXPORTADO = /Exportado del cambio (\d+) del borrador v(\d+)/;

/** El YAML del borrador, con un encabezado que dice de qué cambio salió (para avisar si al importarlo ya cambió). */
export function yamlDelBorrador(bot: Pick<Bot, 'nombre'>, borrador: Pick<Borrador, 'numero' | 'seq'>, definicion: Definicion, ahora = new Date()): string {
  const fecha = ahora.toISOString().slice(0, 16).replace('T', ' ');
  return exportarYaml(definicion, [`Bot: ${bot.nombre}`, `Exportado del cambio ${borrador.seq} del borrador v${borrador.numero}, el ${fecha} (UTC).`]);
}

/**
 * Importa un YAML sobre el borrador: lo compara y lo guarda como un solo cambio (origen yaml), que se deshace como
 * cualquier otro. Si el YAML salió de un cambio anterior al actual, avisa que se pisarían los cambios de otras
 * personas y solo sigue con `igual`.
 */
export async function ejecutarImportarYaml(c: ContextoNucleo, e: { botId: string; texto: string; igual?: boolean }, opciones: { azar?: () => number } = {}): Promise<ResultadoBorrador> {
  const b = await botEditable(c, e.botId);
  if ('ok' in b) return b;
  const l = await leerBorrador(c.repo, b.id);
  if ('codigo' in l) return falla(l.codigo, undefined, l.problemas);
  const m = e.texto.match(RE_EXPORTADO);
  if (m && !e.igual && (Number(m[1]) !== l.borrador.seq || Number(m[2]) !== l.borrador.numero)) {
    return falla('yaml_desactualizado', `Este YAML salió del cambio ${m[1]} del borrador v${m[2]}, y el borrador ya va por el cambio ${l.borrador.seq} de la v${l.borrador.numero}. Si lo importás, se pierde lo que se cambió en el medio.`);
  }
  const r = importarYaml(e.texto, l.definicion, opciones);
  if (!r.ok) return { ok: false, codigo: 'yaml', problemasYaml: r.problemas };
  const op = operacionImportar(l.definicion, r.definicion);
  if (!op) return falla('sin_cambios');
  try {
    const x = aplicarCambio(l.definicion, [op]);
    const seq = await c.repo.guardarCambio(l.borrador.id, l.borrador.seq, { origen: 'yaml', operaciones: x.operaciones, inversa: x.inversa, resumen: x.resumen, objetivo: null }, x.definicion, c.personaId);
    return { ok: true, resumen: x.resumen, creados: [], otroCambio: false, ...(await estado(c.repo, l.borrador, seq, x.definicion)) };
  } catch (x) {
    return deError(x);
  }
}

// ── Formularios (Contenidos, Intenciones y temas, Variables y datos) ───────────────────────────

/** Un formulario de las pantallas del borrador: sus campos → operaciones → un cambio. Vuelve con ?ok= o ?error=. */
export async function ejecutarFormulario(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const botId = texto(fd, 'botId');
  const b = await botEditable(c, botId);
  if ('ok' in b) return { tipo: 'error', codigo: b.ok ? 'no_se_pudo' : b.codigo };
  const l = await leerBorrador(c.repo, b.id);
  if ('codigo' in l) return { tipo: 'error', codigo: l.codigo };
  // El material se puede subir como archivo de texto (.md o .txt) en lugar de pegarlo.
  const archivo = fd.get('archivo');
  if (archivo && typeof archivo === 'object' && 'text' in archivo && (archivo as File).size > 0) {
    if ((archivo as File).size > 2_000_000) return { tipo: 'error', codigo: 'material_largo' };
    fd.set('texto', await (archivo as File).text());
  }
  const f = operacionesDeForma(fd, l.definicion);
  if ('codigo' in f) return { tipo: 'error', codigo: f.codigo };
  const r = await ejecutarCambio(c, { botId: b.id, seq: Number(texto(fd, 'seq')) || l.borrador.seq, operaciones: f.ops, origen: 'editor' });
  return r.ok ? { tipo: 'ok', codigo: 'cambio_guardado' } : { tipo: 'error', codigo: r.codigo };
}

export async function ejecutarDeshacerFormulario(c: ContextoNucleo, fd: FormData): Promise<Salida> {
  const rehacer = texto(fd, 'rehacer') === 'si';
  const r = await ejecutarDeshacer(c, { botId: texto(fd, 'botId'), seq: Number(texto(fd, 'seq')), rehacer });
  return r.ok ? { tipo: 'ok', codigo: rehacer ? 'rehecho' : 'deshecho' } : { tipo: 'error', codigo: r.codigo };
}
