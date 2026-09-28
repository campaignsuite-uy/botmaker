/**
 * Postgres en memoria (PGlite) con lo mínimo de Supabase para aplicar y probar las migraciones. Copia de
 * CampaignSuite (packages/db/scripts/supabase-simulado.ts, ef6a364); lo único distinto es qué archivos aplica:
 * primero el núcleo de desarrollo (core-dev/0000_…, 0001_…) y después las migraciones de BotMaker (bots_0001_…).
 *
 *  - roles anon, authenticated y service_role (este último saltea RLS, como en Supabase);
 *  - esquema auth con la tabla users y la función auth.uid(), que lee el claim `sub` del JWT desde
 *    current_setting('request.jwt.claim.sub'), igual que PostgREST;
 *  - `comoPersona(...)`: corre consultas como una persona con sesión (rol authenticated + sub);
 *  - `clienteSimulado(...)`: un cliente con la forma de @supabase/supabase-js (el subconjunto que usa el
 *    repositorio de Supabase: schema().from().select/insert/update/upsert/delete, filtros, orden, rango,
 *    single/maybeSingle y rpc) que traduce cada pedido a SQL y lo corre en una transacción con el rol de la persona o
 *    del servidor. Devuelve las filas como PostgREST: fechas como texto ISO, numeric como número, jsonb como objeto.
 *
 * No simula Auth real ni todas las variantes de PostgREST: eso se prueba contra el proyecto de Supabase de desarrollo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const SIMULACION = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Subconjunto de las columnas de auth.users de Supabase (las que usa la semilla).
create table auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  confirmation_token     varchar(255),
  recovery_token         varchar(255),
  email_change_token_new varchar(255),
  email_change           varchar(255),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
`;

export const DIR_CORE_DEV = new URL('../core-dev/', import.meta.url).pathname;
export const DIR_MIGRACIONES = new URL('../migraciones/', import.meta.url).pathname;

/** El núcleo de desarrollo y las migraciones de BotMaker, en el orden en que se aplican (rutas completas). */
export function archivosMigracion(): string[] {
  const core = readdirSync(DIR_CORE_DEV).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort().map((f) => join(DIR_CORE_DEV, f));
  const bots = readdirSync(DIR_MIGRACIONES).filter((f) => /^bots_\d{4}_.+\.sql$/.test(f)).sort().map((f) => join(DIR_MIGRACIONES, f));
  return [...core, ...bots];
}

/**
 * Crea la base, la prepara como Supabase (en UTC) y aplica todas las migraciones en orden (o solo las anteriores a
 * `antesDe`, para probar una migración sobre datos de la versión anterior).
 */
export async function baseConMigraciones(antesDe?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`set timezone = 'UTC';`);
  await db.exec(SIMULACION);
  for (const archivo of archivosMigracion().filter((a) => !antesDe || !a.endsWith(antesDe) && a.split('/').pop()! < antesDe)) {
    try {
      await db.exec(readFileSync(archivo, 'utf8'));
    } catch (e) {
      throw new Error(`Falló la migración ${archivo.split('/').pop()}: ${(e as Error).message}`);
    }
  }
  return db;
}

/**
 * Corre `fn` como la persona `personaId` (rol authenticated, auth.uid() = personaId) dentro de una
 * transacción. Con `deshacer: true` descarta los cambios al terminar.
 */
export async function comoPersona<T>(db: PGlite, personaId: string, fn: (tx: Transaction) => Promise<T>, opciones: { deshacer?: boolean } = {}): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [personaId]);
    await tx.exec(`set local role authenticated; set local timezone = 'UTC';`);
    const r = await fn(tx);
    if (opciones.deshacer) await tx.rollback();
    return r;
  });
}

/** Igual que comoPersona, pero con la clave de servicio (service_role, sin sesión). */
export async function comoServicio<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role service_role; set local timezone = 'UTC';`);
    return fn(tx);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Cliente simulado con la forma de supabase-js
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type ModoCliente = { persona: string } | { servicio: true };

interface ErrorPostgrest { message: string; code: string; details: string | null; hint: string | null }
interface Respuesta { data: unknown; error: ErrorPostgrest | null; count: number | null; status: number; statusText: string }

interface TipoColumna { nombre: string; json: boolean; arreglo: boolean }

const IDENT = /^[a-z_][a-z0-9_]*$/;
const COLUMNAS_OK = /^[a-z0-9_,\s*]+$/i;

function comilla(id: string): string {
  if (!IDENT.test(id)) throw new Error(`Identificador no admitido por el cliente simulado: ${id}`);
  return `"${id}"`;
}

/** Literal de arreglo de Postgres ('{"a","b"}') para parámetros de tipo arreglo. */
function literalArreglo(xs: unknown[]): string {
  return `{${xs.map((x) => (x === null || x === undefined ? 'NULL' : `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)).join(',')}}`;
}

function serializar(v: unknown, tipo: { json: boolean; arreglo: boolean } | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (tipo?.json) return JSON.stringify(v);
  if (Array.isArray(v)) return literalArreglo(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function errorDe(e: unknown): ErrorPostgrest {
  const x = e as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: x.message ?? String(e), code: x.code ?? 'XX000', details: x.detail ?? null, hint: x.hint ?? null };
}

class Ejecutor {
  private tipos = new Map<string, Map<string, TipoColumna>>();
  private funciones = new Map<string, { argumentos: { nombre: string; json: boolean; arreglo: boolean }[]; retorno: string; conjunto: boolean }>();

  constructor(private db: PGlite, private modo: ModoCliente) {}

  async correr(sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
    return this.db.transaction(async (tx) => {
      if ('persona' in this.modo) {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [this.modo.persona]);
        await tx.exec(`set local role authenticated; set local timezone = 'UTC';`);
      } else {
        await tx.exec(`set local role service_role; set local timezone = 'UTC';`);
      }
      return (await tx.query<Record<string, unknown>>(sql, params)).rows;
    });
  }

  async columnas(esquema: string, tabla: string): Promise<Map<string, TipoColumna>> {
    const clave = `${esquema}.${tabla}`;
    let m = this.tipos.get(clave);
    if (!m) {
      const filas = (await this.db.query<{ attname: string; typname: string; typcategory: string; base: string | null }>(`
        select a.attname, t.typname, t.typcategory, bt.typname as base
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        left join pg_type bt on bt.oid = t.typbasetype
        where a.attrelid = ($1 || '.' || $2)::regclass and a.attnum > 0 and not a.attisdropped`, [esquema, tabla])).rows;
      m = new Map(filas.map((f) => [f.attname, {
        nombre: f.attname,
        json: ['json', 'jsonb'].includes(f.typname) || ['json', 'jsonb'].includes(f.base ?? ''),
        arreglo: f.typcategory === 'A',
      }]));
      this.tipos.set(clave, m);
    }
    return m;
  }

  async funcion(esquema: string, nombre: string) {
    const clave = `${esquema}.${nombre}`;
    let f = this.funciones.get(clave);
    if (!f) {
      const x = (await this.db.query<{ nombres: string[] | null; modos: string[] | null; tipos: string[]; retorno: string; conjunto: boolean }>(`
        select p.proargnames as nombres, p.proargmodes::text[] as modos,
               array(select t.typname || ':' || t.typcategory::text from unnest(p.proargtypes::oid[]) with ordinality u(oid, n) join pg_type t on t.oid = u.oid order by u.n) as tipos,
               format_type(p.prorettype, null) as retorno, p.proretset as conjunto
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.proname = $2`, [esquema, nombre])).rows[0];
      if (!x) throw new Error(`No existe la función ${clave}`);
      const nombres = (x.nombres ?? []).filter((_, i) => !x.modos || ['i', 'b', 'v'].includes(x.modos[i]!));
      f = {
        argumentos: x.tipos.map((t, i) => {
          const [typname, cat] = t.split(':');
          return { nombre: nombres[i] ?? `$${i + 1}`, json: typname === 'json' || typname === 'jsonb', arreglo: cat === 'A' };
        }),
        retorno: x.retorno,
        conjunto: x.conjunto,
      };
      this.funciones.set(clave, f);
    }
    return f;
  }
}

type Filtro = { tipo: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike'; col: string; valor: unknown }
  | { tipo: 'in'; col: string; valores: unknown[] }
  | { tipo: 'is'; col: string; valor: null | boolean };

const OPERADOR = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' } as const;

class Consulta implements PromiseLike<Respuesta> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private cols = '*';
  private retorno: string | null = null;
  private filtros: Filtro[] = [];
  private ordenes: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private desde: number | null = null;
  private hasta: number | null = null;
  private limite: number | null = null;
  private unico: 'single' | 'maybe' | null = null;
  private filas: Record<string, unknown>[] = [];
  private valores: Record<string, unknown> = {};
  private conflicto: string | null = null;
  private ignorar = false;

  constructor(private ej: Ejecutor, private esquema: string, private tabla: string) {}

  private contar = false;
  private soloCabecera = false;
  private alguno: { col: string; tipo: 'eq' | 'in'; valores: string[] }[][] = [];

  select(cols = '*', o: { count?: 'exact'; head?: boolean } = {}) {
    if (!COLUMNAS_OK.test(cols)) throw new Error(`Columnas no admitidas por el cliente simulado: ${cols}`);
    if (this.op === 'select') this.cols = cols;
    else this.retorno = cols;
    this.contar = o.count === 'exact';
    this.soloCabecera = !!o.head;
    return this;
  }
  /** Subconjunto de .or() de PostgREST: "col.eq.valor,col.in.(a,b)". */
  or(expr: string) {
    const partes = expr.match(/[a-z_]+\.(?:eq\.[^,]+|in\.\([^)]*\))/g) ?? [];
    this.alguno.push(partes.map((x) => {
      const [col, tipo, ...resto] = x.split('.');
      const valor = resto.join('.');
      return tipo === 'in' ? { col: col!, tipo: 'in' as const, valores: valor.replace(/^\(|\)$/g, '').split(',').filter(Boolean) } : { col: col!, tipo: 'eq' as const, valores: [valor] };
    }));
    return this;
  }
  insert(v: Record<string, unknown> | Record<string, unknown>[]) { this.op = 'insert'; this.filas = Array.isArray(v) ? v : [v]; return this; }
  upsert(v: Record<string, unknown> | Record<string, unknown>[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.filas = Array.isArray(v) ? v : [v];
    this.conflicto = o.onConflict ?? null;
    this.ignorar = !!o.ignoreDuplicates;
    return this;
  }
  update(v: Record<string, unknown>) { this.op = 'update'; this.valores = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, valor: unknown) { this.filtros.push({ tipo: 'eq', col, valor }); return this; }
  neq(col: string, valor: unknown) { this.filtros.push({ tipo: 'neq', col, valor }); return this; }
  gt(col: string, valor: unknown) { this.filtros.push({ tipo: 'gt', col, valor }); return this; }
  gte(col: string, valor: unknown) { this.filtros.push({ tipo: 'gte', col, valor }); return this; }
  lt(col: string, valor: unknown) { this.filtros.push({ tipo: 'lt', col, valor }); return this; }
  lte(col: string, valor: unknown) { this.filtros.push({ tipo: 'lte', col, valor }); return this; }
  like(col: string, valor: string) { this.filtros.push({ tipo: 'like', col, valor }); return this; }
  ilike(col: string, valor: string) { this.filtros.push({ tipo: 'ilike', col, valor }); return this; }
  in(col: string, valores: unknown[]) { this.filtros.push({ tipo: 'in', col, valores }); return this; }
  is(col: string, valor: null | boolean) { this.filtros.push({ tipo: 'is', col, valor }); return this; }
  order(col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.ordenes.push({ col, asc: o.ascending ?? true, nullsFirst: o.nullsFirst }); return this; }
  range(desde: number, hasta: number) { this.desde = desde; this.hasta = hasta; return this; }
  limit(n: number) { this.limite = n; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }

  then<A = Respuesta, B = never>(ok?: ((r: Respuesta) => A | PromiseLike<A>) | null, mal?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.ejecutar().then(ok, mal);
  }

  private async where(params: unknown[], tipos: Map<string, TipoColumna>): Promise<string> {
    const partes = this.filtros.map((f) => {
      const c = comilla(f.col);
      if (f.tipo === 'is') return `${c} is ${f.valor === null ? 'null' : f.valor ? 'true' : 'false'}`;
      if (f.tipo === 'in') {
        params.push(literalArreglo(f.valores));
        return `${c} = any($${params.length})`;
      }
      params.push(serializar(f.valor, tipos.get(f.col)?.json ? { json: true, arreglo: false } : undefined));
      return `${c} ${OPERADOR[f.tipo]} $${params.length}`;
    });
    for (const grupo of this.alguno) {
      partes.push(`(${grupo.map((g) => {
        const t = tipos.get(g.col);
        const cast = t && !t.json && !t.arreglo ? '' : '';
        params.push(g.tipo === 'in' ? literalArreglo(g.valores) : g.valores[0]);
        return g.tipo === 'in' ? `${comilla(g.col)}::text = any($${params.length}::text[])${cast}` : `${comilla(g.col)}::text = $${params.length}`;
      }).join(' or ')})`);
    }
    return partes.length ? ` where ${partes.join(' and ')}` : '';
  }

  private async ejecutar(): Promise<Respuesta> {
    try {
      const tipos = await this.ej.columnas(this.esquema, this.tabla);
      const t = `${comilla(this.esquema)}.${comilla(this.tabla)}`;
      const params: unknown[] = [];
      let sql: string;
      if (this.op === 'select') {
        const orden = this.ordenes.length
          ? ` order by ${this.ordenes.map((o) => `${comilla(o.col)} ${o.asc ? 'asc' : 'desc'}${o.nullsFirst === undefined ? '' : o.nullsFirst ? ' nulls first' : ' nulls last'}`).join(', ')}`
          : '';
        const where = await this.where(params, tipos);
        let lim = '';
        if (this.desde !== null && this.hasta !== null) lim = ` limit ${this.hasta - this.desde + 1} offset ${this.desde}`;
        else if (this.limite !== null) lim = ` limit ${this.limite}`;
        sql = this.contar && this.soloCabecera
          ? `select count(*)::int as r from ${t}${where}`
          : `select to_jsonb(x) as r from (select ${this.cols} from ${t}${where}${orden}${lim}) x`;
      } else if (this.op === 'insert' || this.op === 'upsert') {
        const columnas = [...new Set(this.filas.flatMap((f) => Object.keys(f)))];
        const valores = this.filas.map((f) => `(${columnas.map((c) => {
          if (!(c in f)) return 'default';
          params.push(serializar(f[c], tipos.get(c)));
          return `$${params.length}`;
        }).join(', ')})`);
        let conflicto = '';
        if (this.op === 'upsert') {
          const objetivo = this.conflicto ? `(${this.conflicto.split(',').map((c) => comilla(c.trim())).join(', ')})` : '';
          const actualizar = columnas.filter((c) => !this.conflicto?.split(',').map((x) => x.trim()).includes(c));
          conflicto = this.ignorar || !actualizar.length
            ? ` on conflict ${objetivo} do nothing`
            : ` on conflict ${objetivo} do update set ${actualizar.map((c) => `${comilla(c)} = excluded.${comilla(c)}`).join(', ')}`;
        }
        const ret = this.retorno ? ` returning ${this.retorno}` : '';
        const dml = `insert into ${t} (${columnas.map(comilla).join(', ')}) values ${valores.join(', ')}${conflicto}${ret}`;
        sql = this.retorno ? `with d as (${dml}) select to_jsonb(d) as r from d` : dml;
      } else if (this.op === 'update') {
        const sets = Object.entries(this.valores).map(([c, v]) => {
          params.push(serializar(v, tipos.get(c)));
          return `${comilla(c)} = $${params.length}`;
        });
        const where = await this.where(params, tipos);
        const ret = this.retorno ? ` returning ${this.retorno}` : '';
        const dml = `update ${t} set ${sets.join(', ')}${where}${ret}`;
        sql = this.retorno ? `with d as (${dml}) select to_jsonb(d) as r from d` : dml;
      } else {
        const where = await this.where(params, tipos);
        const ret = this.retorno ? ` returning ${this.retorno}` : '';
        const dml = `delete from ${t}${where}${ret}`;
        sql = this.retorno ? `with d as (${dml}) select to_jsonb(d) as r from d` : dml;
      }
      const filas = await this.ej.correr(sql, params);
      if (this.op === 'select' && this.contar && this.soloCabecera) return { data: null, error: null, count: Number(filas[0]?.r ?? 0), status: 200, statusText: 'OK' };
      const datos = this.op === 'select' || this.retorno ? filas.map((f) => f.r) : null;
      if (this.unico && datos) {
        if (datos.length > 1 || (this.unico === 'single' && datos.length === 0)) {
          return { data: null, error: { message: `JSON object requested, multiple (or no) rows returned (${datos.length})`, code: 'PGRST116', details: null, hint: null }, count: null, status: 406, statusText: 'Not Acceptable' };
        }
        return { data: datos[0] ?? null, error: null, count: null, status: 200, statusText: 'OK' };
      }
      return { data: datos, error: null, count: null, status: 200, statusText: 'OK' };
    } catch (e) {
      return { data: null, error: errorDe(e), count: null, status: 400, statusText: 'Bad Request' };
    }
  }
}

class Esquema {
  constructor(private ej: Ejecutor, private nombre: string) {}

  from(tabla: string) {
    return new Consulta(this.ej, this.nombre, tabla);
  }

  async rpc(nombre: string, args: Record<string, unknown> = {}): Promise<Respuesta> {
    try {
      const f = await this.ej.funcion(this.nombre, nombre);
      const params: unknown[] = [];
      const llamada = `${comilla(this.nombre)}.${comilla(nombre)}(${Object.entries(args).map(([k, v]) => {
        const a = f.argumentos.find((x) => x.nombre === k);
        if (!a) throw new Error(`La función ${nombre} no tiene el argumento ${k}`);
        params.push(serializar(v, a));
        return `${comilla(k)} => $${params.length}`;
      }).join(', ')})`;
      if (f.retorno === 'void') {
        await this.ej.correr(`select ${llamada}`, params);
        return { data: null, error: null, count: null, status: 204, statusText: 'No Content' };
      }
      if (f.conjunto) {
        const filas = await this.ej.correr(`select to_jsonb(r) as r from ${llamada} r`, params);
        return { data: filas.map((x) => x.r), error: null, count: null, status: 200, statusText: 'OK' };
      }
      const filas = await this.ej.correr(`select to_jsonb(${llamada}) as r`, params);
      return { data: filas[0]?.r ?? null, error: null, count: null, status: 200, statusText: 'OK' };
    } catch (e) {
      return { data: null, error: errorDe(e), count: null, status: 400, statusText: 'Bad Request' };
    }
  }
}

/**
 * Storage en memoria con la forma de `supabase.storage` (upload / list / remove / download), para probar
 * las respuestas crudas del almacén de corridas. Los archivos quedan en `archivos` ("bucket/ruta" → texto).
 */
export class StorageSimulado {
  readonly archivos = new Map<string, string>();

  from(bucket: string) {
    const clave = (ruta: string) => `${bucket}/${ruta}`;
    return {
      upload: async (ruta: string, cuerpo: unknown, o: { upsert?: boolean } = {}) => {
        if (this.archivos.has(clave(ruta)) && !o.upsert) {
          return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
        }
        this.archivos.set(clave(ruta), String(cuerpo));
        return { data: { path: ruta }, error: null };
      },
      list: async (carpeta: string, o: { limit?: number } = {}) => {
        const prefijo = `${clave(carpeta)}/`;
        const nombres = [...this.archivos.keys()].filter((k) => k.startsWith(prefijo)).map((k) => k.slice(prefijo.length)).filter((n) => !n.includes('/')).sort();
        return { data: nombres.slice(0, o.limit ?? 100).map((name) => ({ name, id: name })), error: null };
      },
      remove: async (rutas: string[]) => {
        for (const r of rutas) this.archivos.delete(clave(r));
        return { data: rutas.map((name) => ({ name })), error: null };
      },
      copy: async (de: string, a: string) => {
        const x = this.archivos.get(clave(de));
        if (x === undefined) return { data: null, error: new Error('Object not found') };
        if (this.archivos.has(clave(a))) return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
        this.archivos.set(clave(a), x);
        return { data: { path: a }, error: null };
      },
      download: async (ruta: string) => {
        const x = this.archivos.get(clave(ruta));
        return x === undefined ? { data: null, error: new Error('Object not found') } : { data: new Blob([x]), error: null };
      },
    };
  }
}

/**
 * Cliente con la forma de SupabaseClient (el subconjunto que usan el repositorio y el almacén de
 * corridas) sobre PGlite. Cada pedido corre en su propia transacción, como la persona (`{ persona: uuid }`,
 * con reglas por fila) o como el servidor (`{ servicio: true }`, saltea RLS). En las pruebas se pasa con un
 * cast. `storage`: Storage en memoria (compartilo entre clientes para ver los mismos archivos).
 */
export function clienteSimulado(db: PGlite, modo: ModoCliente, storage: StorageSimulado = new StorageSimulado()) {
  const ej = new Ejecutor(db, modo);
  return {
    schema: (nombre: string) => new Esquema(ej, nombre),
    from: (tabla: string) => new Esquema(ej, 'public').from(tabla),
    rpc: (nombre: string, args?: Record<string, unknown>) => new Esquema(ej, 'public').rpc(nombre, args),
    storage,
  };
}
