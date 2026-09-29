/**
 * Prueba de la base de BotMaker en un Postgres en memoria (PGlite) que imita lo mínimo de Supabase.
 *
 *  1. Aplica el núcleo de desarrollo (core-dev/0000_…, 0001_…) y las migraciones bots_* en orden.
 *  2. Estructura: reglas por fila en todas las tablas de `bots`, horas en timestamptz, funciones sin search_path abierto.
 *  3. Matriz: bots.matriz_permisos() es EXACTAMENTE MATRIZ de dominio/permisos.ts; las fichas de bots.engines y
 *     bots.engine_defaults son las de dominio/motores.ts.
 *  4. Reglas por fila y funciones por rol (Dueño y Administradora de la campaña sin asignación, editor, agente, lector,
 *     integrante sin acceso, alguien de otra organización y el observador de una demo), con dos organizaciones.
 *  5. El repositorio de Supabase (datos/supabase/repositorio-supabase.ts) contra esta base, con el cliente simulado:
 *     lo que lee y cambia cada persona pasa por las mismas reglas.
 *  6. La semilla de desarrollo (core-dev/semilla-desarrollo.sql) se aplica dos veces sin duplicar.
 *
 * Imprime ✓/✗ por prueba y sale con código 1 si alguna falla. Uso: pnpm db:probar (desde la raíz).
 */
import { readFileSync } from 'node:fs';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { baseConMigraciones, clienteSimulado, comoPersona, comoServicio, DIR_CORE_DEV } from './supabase-simulado.ts';
import { ACCIONES, MATRIZ } from '../../modules/botmaker/dominio/permisos.ts';
import { FICHAS_MOTORES, MOTORES_POR_DEFECTO } from '../../modules/botmaker/dominio/motores.ts';
import { RepositorioSupabase } from '../../modules/botmaker/datos/supabase/repositorio-supabase.ts';
import { ErrorDatos } from '../../modules/botmaker/datos/errores.ts';
import { plantillaPolitica } from '../../modules/botmaker/dominio/plantilla-politica.ts';
import { esquemaDefinicion } from '../../modules/botmaker/dominio/definicion.ts';
import { aplicarCambio } from '../../modules/botmaker/dominio/operaciones.ts';
import { pilasDeshacer } from '../../modules/botmaker/dominio/versiones.ts';
import { createHmac } from 'node:crypto';
import { RepositorioPublicoSupabase } from '../../modules/botmaker/datos/supabase/publico-supabase.ts';
import { atenderMensaje } from '../../modules/botmaker/canal-web/nucleo.ts';
import { CapaMotores } from '../../modules/botmaker/motores/capa.ts';
import { AdaptadorSimulado } from '../../modules/botmaker/motores/simulado.ts';

// ── Mini arnés ──────────────────────────────────────────────────────────────────────────────────

let fallas = 0;
let total = 0;

async function prueba(nombre: string, fn: () => Promise<void>): Promise<void> {
  total++;
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`  ✗ ${nombre}\n      ${(e as Error).message.split('\n').join('\n      ')}`);
  }
}

function afirmar(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(mensaje);
}

async function error(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** JSON con las claves ordenadas: para comparar lo que vuelve de un jsonb. */
const canonico = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
const filas = async <T = Record<string, unknown>>(tx: Transaction | PGlite, sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows;
const uno = async <T = Record<string, unknown>>(tx: Transaction | PGlite, sql: string, params: unknown[] = []) => (await filas<T>(tx, sql, params))[0];
const cuenta = async (tx: Transaction | PGlite, sql: string, params: unknown[] = []) => Number((await uno<{ n: number }>(tx, sql, params))!.n);

// ── Datos mínimos: dos organizaciones y una demo ────────────────────────────────────────────────

const U = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = {
  dueno: U(1), adminCamp: U(2), editor: U(3), agente: U(4), lector: U(5), sinAcceso: U(6), ajeno: U(7), observador: U(8),
};
const ORG_A = U(101);
const ORG_B = U(102);
const ORG_DEMO = U(103);
const CAMP_A = U(201);
const CAMP_B = U(202);
const CAMP_DEMO = U(203);

async function cargarDatos(db: PGlite): Promise<void> {
  const nombres: Record<string, string> = {
    [P.dueno]: 'Dueña', [P.adminCamp]: 'Administradora de la campaña', [P.editor]: 'Editor', [P.agente]: 'Agente', [P.lector]: 'Lector',
    [P.sinAcceso]: 'Integrante sin acceso', [P.ajeno]: 'Dueño de otra organización', [P.observador]: 'Observadora de la demo',
  };
  const ubicacion = `'PA', 'Panamá', 'Panamá', 'Panamá', 'America/Panama', 8.98, -79.52, 'es'`;
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ${Object.entries(nombres).map(([id, n], i) => `('${id}', 'persona${i}@prueba.test', now(), '{"full_name": "${n}"}')`).join(',\n      ')};
    insert into core.organizations (id, slug, name, kind, country_iso) values
      ('${ORG_A}', 'org-a', 'Organización A', 'partido', 'PA'), ('${ORG_B}', 'org-b', 'Organización B', 'campana', 'UY');
    insert into core.organizations (id, slug, name, kind, country_iso, is_demo, demo_status) values
      ('${ORG_DEMO}', 'demo-bots', 'Demo', 'agencia', 'PA', true, 'lista');
    insert into core.organization_members (organization_id, profile_id, role) values
      ('${ORG_A}', '${P.dueno}', 'dueno'),
      ${[P.adminCamp, P.editor, P.agente, P.lector, P.sinAcceso].map((p) => `('${ORG_A}', '${p}', 'miembro')`).join(', ')},
      ('${ORG_B}', '${P.ajeno}', 'dueno');
    insert into core.organization_products (organization_id, product_id) values
      ('${ORG_A}', 'botmaker'), ('${ORG_B}', 'botmaker'), ('${ORG_DEMO}', 'botmaker');
    insert into core.campaigns (id, organization_id, slug, name, country_iso, country_name, city, region, timezone, latitude, longitude, language) values
      ('${CAMP_A}', '${ORG_A}', 'camp-a', 'Campaña A', ${ubicacion}),
      ('${CAMP_B}', '${ORG_B}', 'camp-b', 'Campaña B', ${ubicacion}),
      ('${CAMP_DEMO}', '${ORG_DEMO}', 'camp-demo', 'Campaña demo', ${ubicacion});
    insert into core.campaign_products (campaign_id, product_id) values
      ('${CAMP_A}', 'botmaker'), ('${CAMP_B}', 'botmaker'), ('${CAMP_DEMO}', 'botmaker');
    select bots.preparar_campana(id, '{}'::jsonb) from core.campaigns;
    insert into core.campaign_members (campaign_id, profile_id, role) values
      ('${CAMP_A}', '${P.adminCamp}', 'administrador'),
      ${[P.editor, P.agente, P.lector, P.sinAcceso].map((p) => `('${CAMP_A}', '${p}', 'integrante')`).join(', ')};
    insert into core.campaign_access (campaign_id, product_id, profile_id, role) values
      ('${CAMP_A}', 'botmaker', '${P.editor}', 'editor'), ('${CAMP_A}', 'botmaker', '${P.agente}', 'agente'), ('${CAMP_A}', 'botmaker', '${P.lector}', 'lector');
    insert into core.platform_admins (email) values ('persona7@prueba.test');
  `);
}

const crearBot = (tx: Transaction, campana: string, nombre = 'Bot', clave: string | null = null) =>
  uno<{ id: string }>(tx, `select bots.crear_bot($1, $2::jsonb, $3) as id`, [campana, JSON.stringify({ nombre, caso: 'electoral', mercado: 'PA', trato: 'usted' }), clave]).then((r) => r!.id);

// ── Pruebas ─────────────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nBase de BotMaker (PGlite)\n');
  let db!: PGlite;

  await prueba('las migraciones se aplican en orden sobre el núcleo de desarrollo', async () => {
    db = await baseConMigraciones();
    await cargarDatos(db);
  });
  if (!db) process.exit(1);

  console.log('\nEstructura');
  await prueba('todas las tablas de bots tienen reglas por fila', async () => {
    const sin = await filas<{ t: string }>(db, `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'bots' and c.relkind = 'r' and not c.relrowsecurity`);
    afirmar(!sin.length, `Sin reglas por fila: ${sin.map((x) => x.t).join(', ')}`);
  });
  await prueba('las horas son timestamptz (UTC)', async () => {
    const mal = await filas<{ c: string }>(db, `select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'bots' and data_type = 'timestamp without time zone'`);
    afirmar(!mal.length, `Sin zona horaria: ${mal.map((x) => x.c).join(', ')}`);
  });
  await prueba('las funciones de bots fijan search_path', async () => {
    const abiertas = await filas<{ f: string }>(db, `select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'bots' and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%'))`);
    afirmar(!abiertas.length, `Sin search_path: ${abiertas.map((x) => x.f).join(', ')}`);
  });
  await prueba('la persona no escribe ninguna tabla directo (solo funciones)', async () => {
    const e = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`insert into bots.bots (campaign_id, name, public_id, use_case, market) values ($1, 'x', 'abcdefghij', 'electoral', 'PA')`, [CAMP_A]), { deshacer: true }));
    afirmar(e && /permission denied/.test(e), `Esperaba permiso denegado; dio: ${e}`);
  });

  console.log('\nMatriz y motores (código = base)');
  await prueba('bots.matriz_permisos() es igual a MATRIZ', async () => {
    const base = await filas<{ accion: string; rol: string }>(db, 'select accion, rol from bots.matriz_permisos()');
    const deBase = new Map<string, string[]>();
    for (const f of base) deBase.set(f.accion, [...(deBase.get(f.accion) ?? []), f.rol].sort());
    afirmar(deBase.size === ACCIONES.length, `La base tiene ${deBase.size} acciones y el código ${ACCIONES.length}`);
    for (const a of ACCIONES) {
      const c = [...MATRIZ[a]].sort().join(',');
      const b = (deBase.get(a) ?? []).join(',');
      afirmar(c === b, `${a}: código [${c}] ≠ base [${b}]`);
    }
  });
  await prueba('una acción desconocida es un error, no un "no"', async () => {
    const e = await error(() => db.query(`select bots.rol_permite('administrador', 'volar')`));
    afirmar(e && /Acción desconocida/.test(e), `Dio: ${e}`);
  });
  await prueba('bots.engines es igual a FICHAS_MOTORES', async () => {
    const base = await filas<Record<string, any>>(db, 'select * from bots.engines order by id');
    afirmar(base.length === FICHAS_MOTORES.length, `La base tiene ${base.length} motores y el código ${FICHAS_MOTORES.length}`);
    for (const f of FICHAS_MOTORES) {
      const b = base.find((x) => x.id === f.id);
      afirmar(b, `Falta en la base: ${f.id}`);
      const pares: [string, unknown, unknown][] = [
        ['name', b.name, f.nombre], ['company', b.company, f.empresa], ['route', b.route, f.ruta], ['model', b.model, f.modelo],
        ['provider_prefs', JSON.stringify(b.provider_prefs), JSON.stringify(f.proveedor)], ['reasoning', JSON.stringify(b.reasoning), JSON.stringify(f.razonamiento)],
        ['no_temperature', b.no_temperature, f.sinTemperatura], ['cache', b.cache, f.cache],
        ['price_in', Number(b.price_in_usd_mtok), f.precioEntrada], ['price_out', Number(b.price_out_usd_mtok), f.precioSalida],
        ['price_cache', b.price_cache_usd_mtok == null ? null : Number(b.price_cache_usd_mtok), f.precioCache], ['strict_json', b.strict_json, f.jsonEstricto],
        ['allows_electoral', b.allows_electoral, f.permiteElectoral], ['allows_political', b.allows_political, f.permitePolitico],
        ['requires_ai_notice', b.requires_ai_notice, f.exigeAvisoIa], ['allows_personalization', b.allows_personalization, f.permitePersonalizacion],
        ['trains_on_data', b.trains_on_data, f.entrena], ['retention', b.retention, f.retencion], ['region', b.region, f.region],
        ['conditions', b.conditions, f.condiciones], ['functions', JSON.stringify(b.functions), JSON.stringify(f.funciones)], ['active', b.active, f.activo],
      ];
      for (const [col, x, y] of pares) afirmar(x === y, `${f.id}.${col}: base ${JSON.stringify(x)} ≠ código ${JSON.stringify(y)}`);
    }
  });
  await prueba('bots.engine_defaults es igual a MOTORES_POR_DEFECTO', async () => {
    const base = await filas<{ function: string; primary_engine_id: string; fallback_engine_id: string | null; timeout_ms: number; double_read: boolean }>(db, 'select * from bots.engine_defaults');
    afirmar(base.length === MOTORES_POR_DEFECTO.length, `La base tiene ${base.length} funciones y el código ${MOTORES_POR_DEFECTO.length}`);
    for (const m of MOTORES_POR_DEFECTO) {
      const b = base.find((x) => x.function === m.funcion);
      afirmar(b && b.primary_engine_id === m.principal && b.fallback_engine_id === m.respaldo && b.timeout_ms === m.tiempoMaximoMs && b.double_read === m.dobleLectura, `${m.funcion}: base ${JSON.stringify(b)} ≠ código ${JSON.stringify(m)}`);
    }
  });
  await prueba('el producto está en el catálogo con los roles del código', async () => {
    const p = await uno<{ valid_roles: string[]; route: string }>(db, `select valid_roles, route from core.products where id = 'botmaker'`);
    afirmar(p?.route === 'bots' && p.valid_roles.join(',') === 'administrador,editor,agente,lector', JSON.stringify(p));
  });

  console.log('\nRoles (core.rol_en_campana con la cascada de CampaignSuite)');
  await prueba('cada persona tiene el rol esperado', async () => {
    const esperado: [string, string, string | null][] = [
      [P.dueno, CAMP_A, 'administrador'], [P.adminCamp, CAMP_A, 'administrador'], [P.editor, CAMP_A, 'editor'], [P.agente, CAMP_A, 'agente'],
      [P.lector, CAMP_A, 'lector'], [P.sinAcceso, CAMP_A, null], [P.ajeno, CAMP_A, null], [P.ajeno, CAMP_B, 'administrador'], [P.observador, CAMP_DEMO, 'observador'],
    ];
    for (const [p, c, r] of esperado) {
      const x = await uno<{ r: string | null }>(db, `select bots.rol_efectivo($1, $2) as r`, [c, p]);
      afirmar(x?.r === r, `${p} en ${c}: esperaba ${r}, dio ${x?.r}`);
    }
  });

  console.log('\nFunciones y reglas por fila');
  let botA = '';
  await prueba('crear un bot: el editor y los administradores sí; agente, lector, sin acceso, ajeno y observador no', async () => {
    botA = await comoPersona(db, P.editor, (tx) => crearBot(tx, CAMP_A, 'Bot del editor'));
    await comoPersona(db, P.dueno, (tx) => crearBot(tx, CAMP_A, 'Bot de la dueña'));
    await comoPersona(db, P.adminCamp, (tx) => crearBot(tx, CAMP_A, 'Bot de la administradora'));
    for (const [p, c] of [[P.agente, CAMP_A], [P.lector, CAMP_A], [P.sinAcceso, CAMP_A], [P.ajeno, CAMP_A], [P.observador, CAMP_DEMO]] as const) {
      const e = await error(() => comoPersona(db, p, (tx) => crearBot(tx, c)));
      afirmar(e && /no permite/.test(e), `${p} pudo crear (${e})`);
    }
  });
  await prueba('el bot nace con organization_id de la campaña, id público y los motores por defecto', async () => {
    const b = await uno<{ organization_id: string; public_id: string; status: string }>(db, `select organization_id, public_id, status from bots.bots where id = $1`, [botA]);
    afirmar(b?.organization_id === ORG_A && /^[a-z0-9]{10}$/.test(b.public_id) && b.status === 'borrador', JSON.stringify(b));
    afirmar(await cuenta(db, `select count(*) as n from bots.bot_engines where bot_id = $1`, [botA]) === 3, 'Faltan motores del bot');
    const m = await filas<{ function: string; primary_engine_id: string; double_read: boolean }>(db, `select function, primary_engine_id, double_read from bots.bot_engines where bot_id = $1 order by function`, [botA]);
    afirmar(m.every((x) => x.double_read === (x.function === 'interpretar')), `Doble lectura: ${JSON.stringify(m)}`);
    afirmar(m.find((x) => x.function === 'interpretar')?.primary_engine_id === 'gemini-3.1-flash-lite', `Interpretar: ${JSON.stringify(m)}`);
  });
  await prueba('crear con la misma clave devuelve el mismo bot; con la clave de otra campaña, error', async () => {
    const clave = U(900);
    const a = await comoPersona(db, P.editor, (tx) => crearBot(tx, CAMP_A, 'Idempotente', clave));
    const b = await comoPersona(db, P.editor, (tx) => crearBot(tx, CAMP_A, 'Idempotente', clave));
    afirmar(a === b, 'Creó dos bots con la misma clave');
    const e = await error(() => comoPersona(db, P.ajeno, (tx) => crearBot(tx, CAMP_B, 'Otra', clave)));
    afirmar(e && /otra campaña/.test(e), `Dio: ${e}`);
  });
  await prueba('leer: cada rol de la campaña ve sus bots; sin acceso, ajeno y otra campaña no', async () => {
    for (const p of [P.dueno, P.adminCamp, P.editor, P.agente, P.lector]) {
      const n = await comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.bots where campaign_id = $1`, [CAMP_A]));
      afirmar(n === 4, `${p} ve ${n} bots`);
    }
    for (const p of [P.sinAcceso, P.ajeno]) {
      const n = await comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.bots where campaign_id = $1`, [CAMP_A]));
      afirmar(n === 0, `${p} ve ${n} bots`);
    }
  });
  await prueba('guardar datos: editor sí; agente no; un bot inexistente, error claro', async () => {
    await comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_bot($1, $2::jsonb)`, [botA, JSON.stringify({ nombre: 'Renombrado', trato: 'tu' })]));
    const b = await uno<{ name: string; treatment: string; use_case: string }>(db, `select name, treatment, use_case from bots.bots where id = $1`, [botA]);
    afirmar(b?.name === 'Renombrado' && b.treatment === 'tu' && b.use_case === 'electoral', JSON.stringify(b));
    const e = await error(() => comoPersona(db, P.agente, (tx) => tx.query(`select bots.guardar_bot($1, '{"nombre":"x"}'::jsonb)`, [botA])));
    afirmar(e && /no permite/.test(e), `Dio: ${e}`);
    const e2 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_bot($1, '{"nombre":"x"}'::jsonb)`, [U(999)])));
    afirmar(e2 && /No existe el bot/.test(e2), `Dio: ${e2}`);
  });
  await prueba('motores y topes: solo el administrador; valida motores y respaldo; queda en la actividad', async () => {
    const motores = JSON.stringify({ interpretar: { principal: 'claude-haiku-4.5', respaldo: 'gpt-oss-120b' } });
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, null)`, [botA, motores])));
    afirmar(e && /no permite/.test(e), `El editor pudo: ${e}`);
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, '{"diario": 2, "mensual": 30}'::jsonb)`, [botA, motores]));
    const m = await uno<{ primary_engine_id: string }>(db, `select primary_engine_id from bots.bot_engines where bot_id = $1 and function = 'interpretar'`, [botA]);
    afirmar(m?.primary_engine_id === 'claude-haiku-4.5', JSON.stringify(m));
    const b = await uno<{ daily_cap_usd: string }>(db, `select daily_cap_usd from bots.bots where id = $1`, [botA]);
    afirmar(Number(b?.daily_cap_usd) === 2, JSON.stringify(b));
    for (const [mal, patron] of [
      ['{"interpretar": {"principal": "gpt-9"}}', /Motor desconocido/],
      ['{"interpretar": {"principal": "gpt-oss-120b", "respaldo": "gpt-oss-120b"}}', /otro motor/],
      ['{"volar": {"principal": "gpt-oss-120b"}}', /Función desconocida/],
      ['{"copiloto": {"principal": "gemini-3.1-flash-lite"}}', /no sirve para la función/],
      ['{"interpretar": {"principal": "mistral-small-4"}}', /apagado/],
      ['{"interpretar": {"principal": "gpt-oss-120b", "dobleLectura": true}}', /necesita un motor de respaldo/],
      ['{"responder": {"principal": "gpt-oss-120b", "respaldo": "claude-haiku-4.5", "dobleLectura": true}}', /solo para interpretar/],
    ] as const) {
      const x = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, null)`, [botA, mal])));
      afirmar(x && patron.test(x), `${mal}: ${x}`);
    }
    const x = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, '{}'::jsonb, '{"diario": 50, "mensual": 10}'::jsonb)`, [botA])));
    afirmar(x, 'Aceptó un tope diario mayor que el mensual');
    for (const t of ['{"diario": "NaN", "mensual": "NaN"}', '{"diario": 1, "mensual": 5000000}']) {
      const y = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, '{}'::jsonb, $2::jsonb)`, [botA, t])));
      afirmar(y, `Aceptó los topes ${t}`);
    }
    const det = await uno<{ detail: Record<string, unknown> }>(db, `select detail from core.audit_log where action = 'bots.motores_cambiados' order by id desc limit 1`);
    const d = det?.detail as { interpretar?: { principal?: string; respaldo?: string; dobleLectura?: boolean } } | undefined;
    afirmar(Object.keys(d ?? {}).join() === 'interpretar' && d?.interpretar?.principal === 'claude-haiku-4.5' && d.interpretar.respaldo === 'gpt-oss-120b' && d.interpretar.dobleLectura === true && Object.keys(d.interpretar).length === 3, `La actividad guarda lo validado: ${JSON.stringify(det)}`);
    const act = await filas<{ action: string }>(db, `select action from core.audit_log where product_id = 'botmaker' and action in ('bots.motores_cambiados', 'bots.topes_cambiados')`);
    afirmar(act.length === 2, `Actividad: ${JSON.stringify(act)}`);
  });
  await prueba('doble lectura: se prende y se apaga; quitar el respaldo la apaga', async () => {
    const leer = () => uno<{ fallback_engine_id: string | null; double_read: boolean }>(db, `select fallback_engine_id, double_read from bots.bot_engines where bot_id = $1 and function = 'interpretar'`, [botA]);
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, null)`, [botA, '{"interpretar": {"principal": "gemini-3.1-flash-lite", "respaldo": "gpt-oss-120b", "dobleLectura": false}}']));
    afirmar((await leer())?.double_read === false, 'No se apagó');
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, null)`, [botA, '{"interpretar": {"principal": "gemini-3.1-flash-lite", "respaldo": "gpt-oss-120b", "dobleLectura": true}}']));
    afirmar((await leer())?.double_read === true, 'No se prendió');
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_motores($1, $2::jsonb, null)`, [botA, '{"interpretar": {"principal": "gemini-3.1-flash-lite"}}']));
    const x = await leer();
    afirmar(x?.fallback_engine_id === null && x.double_read === false, `Sin respaldo: ${JSON.stringify(x)}`);
  });
  await prueba('datos personales: solo el administrador', async () => {
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_datos_personales($1, true, 30)`, [botA])));
    afirmar(e && /no permite/.test(e), `El editor pudo: ${e}`);
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.guardar_datos_personales($1, true, 30)`, [botA]));
    const b = await uno<{ personalization: boolean; retention_days: number }>(db, `select personalization, retention_days from bots.bots where id = $1`, [botA]);
    afirmar(b?.personalization === true && b.retention_days === 30, JSON.stringify(b));
  });
  await prueba('llamadas a motores: solo las agrega el servidor; suman el gasto del día; solo las ve quien ve costos', async () => {
    const e = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`insert into bots.engine_calls (campaign_id, bot_id, use, function, engine_id, ok, cost_usd) values ($1, $2, 'en_vivo', 'interpretar', 'gpt-oss-120b', true, 0.01)`, [CAMP_A, botA])));
    afirmar(e && /permission denied/.test(e), `La persona pudo registrar una llamada: ${e}`);
    await comoServicio(db, (tx) => tx.query(`insert into bots.engine_calls (campaign_id, bot_id, use, function, engine_id, ok, cost_usd) values ($1, $2, 'en_vivo', 'interpretar', 'gpt-oss-120b', true, 0.01), ($1, $2, 'en_vivo', 'responder', 'gpt-oss-120b', true, 0.02)`, [CAMP_A, botA]));
    const g = await uno<{ cost_usd: string; calls: number; organization_id: string }>(db, `select cost_usd, calls, organization_id from bots.spend_daily where bot_id = $1 and use = 'en_vivo'`, [botA]);
    afirmar(Number(g?.cost_usd) === 0.03 && g?.calls === 2 && g.organization_id === ORG_A, JSON.stringify(g));
    const e2 = await error(() => comoServicio(db, (tx) => tx.query(`update bots.engine_calls set cost_usd = 0 where bot_id = $1`, [botA])));
    afirmar(e2 && /permission denied|solo admite agregar/.test(e2), `Se pudo cambiar una llamada: ${e2}`);
    const e3 = await error(() => comoServicio(db, (tx) => tx.query(`delete from bots.engine_calls where bot_id = $1`, [botA])));
    afirmar(e3 && /permission denied/.test(e3), `Se pudo borrar una llamada: ${e3}`);
    for (const [p, n] of [[P.dueno, 2], [P.adminCamp, 2], [P.editor, 0], [P.agente, 0], [P.lector, 0], [P.ajeno, 0]] as const) {
      const x = await comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.engine_calls where bot_id = $1`, [botA]));
      afirmar(x === n, `${p} ve ${x} llamadas (esperaba ${n})`);
    }
  });
  await prueba('una llamada no puede cruzar organizaciones', async () => {
    const e = await error(() => comoServicio(db, (tx) => tx.query(`insert into bots.engine_calls (campaign_id, bot_id, use, function, engine_id, ok) values ($1, $2, 'en_vivo', 'interpretar', 'gpt-oss-120b', true)`, [CAMP_B, botA])));
    afirmar(e && /foreign key/.test(e), `Dio: ${e}`);
  });
  await prueba('equipo: el administrador da y quita roles; el editor no; el Dueño no cambia de rol', async () => {
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.asignar_rol($1, $2, 'lector')`, [CAMP_A, P.sinAcceso]));
    afirmar((await uno<{ r: string }>(db, `select bots.rol_efectivo($1, $2) as r`, [CAMP_A, P.sinAcceso]))?.r === 'lector', 'No quedó como lector');
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.asignar_rol($1, $2, '')`, [CAMP_A, P.sinAcceso]));
    afirmar((await uno<{ r: string | null }>(db, `select bots.rol_efectivo($1, $2) as r`, [CAMP_A, P.sinAcceso]))?.r === null, 'No quedó sin acceso');
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.asignar_rol($1, $2, 'lector')`, [CAMP_A, P.sinAcceso])));
    afirmar(e && /no permite/.test(e), `El editor pudo: ${e}`);
    const e2 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.asignar_rol($1, $2, 'lector')`, [CAMP_A, P.adminCamp])));
    afirmar(e2 && /Administrador en todos sus productos/.test(e2), `Dio: ${e2}`);
    const e3 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.asignar_rol($1, $2, 'revisor')`, [CAMP_A, P.sinAcceso])));
    afirmar(e3 && /Rol desconocido/.test(e3), `Dio: ${e3}`);
  });
  await prueba('archivar: solo el administrador; archivado no se cambia; queda en la actividad', async () => {
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.archivar($1)`, [botA])));
    afirmar(e && /no permite/.test(e), `El editor pudo: ${e}`);
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.archivar($1)`, [botA]));
    const e2 = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_bot($1, '{"nombre":"x"}'::jsonb)`, [botA])));
    afirmar(e2 && /archivado/.test(e2), `Dio: ${e2}`);
    const acciones = (await filas<{ action: string }>(db, `select action from core.audit_log where product_id = 'botmaker' order by id`)).map((x) => x.action);
    for (const a of ['bots.crear', 'bots.motores_cambiados', 'bots.topes_cambiados', 'bots.datos_personales_cambiados', 'bots.rol_asignado', 'bots.archivar']) afirmar(acciones.includes(a), `Falta ${a} en la actividad`);
  });
  await prueba('la actividad la leen el Dueño y el Administrador de la organización, no el editor', async () => {
    const d = await comoPersona(db, P.dueno, (tx) => cuenta(tx, `select count(*) as n from core.audit_log where product_id = 'botmaker' and organization_id = $1`, [ORG_A]));
    const e = await comoPersona(db, P.editor, (tx) => cuenta(tx, `select count(*) as n from core.audit_log where product_id = 'botmaker'`));
    afirmar(d > 0 && e === 0, `Dueño ${d}, editor ${e}`);
  });
  await prueba('en una demo el observador ve todo (también costos) y no cambia nada', async () => {
    const botDemo = await comoServicio(db, async (tx) => (await uno<{ id: string }>(tx, `insert into bots.bots (campaign_id, name, public_id, use_case, market) values ($1, 'Bot demo', 'demodemo22', 'electoral', 'PA') returning id`, [CAMP_DEMO]))!.id);
    await comoServicio(db, (tx) => tx.query(`insert into bots.engine_calls (campaign_id, bot_id, use, function, engine_id, ok, cost_usd) values ($1, $2, 'simulador', 'interpretar', 'simulado', true, 0)`, [CAMP_DEMO, botDemo]));
    const n = await comoPersona(db, P.observador, (tx) => cuenta(tx, `select count(*) as n from bots.bots where campaign_id = $1`, [CAMP_DEMO]));
    const c = await comoPersona(db, P.observador, (tx) => cuenta(tx, `select count(*) as n from bots.engine_calls where campaign_id = $1`, [CAMP_DEMO]));
    afirmar(n === 1 && c === 1, `Ve ${n} bots y ${c} llamadas`);
    const e = await error(() => comoPersona(db, P.observador, (tx) => tx.query(`select bots.guardar_bot($1, '{"nombre":"x"}'::jsonb)`, [botDemo])));
    afirmar(e && /no permite/.test(e), `Dio: ${e}`);
  });
  await prueba('borrar una campaña con bots y llamadas borra todo en cascada', async () => {
    const botB = await comoPersona(db, P.ajeno, (tx) => crearBot(tx, CAMP_B, 'Bot de B'));
    await comoServicio(db, (tx) => tx.query(`insert into bots.engine_calls (campaign_id, bot_id, use, function, engine_id, ok, cost_usd) values ($1, $2, 'pruebas', 'interpretar', 'simulado', true, 0)`, [CAMP_B, botB]));
    await db.query(`delete from core.campaigns where id = $1`, [CAMP_B]);
    const quedan = await cuenta(db, `select (select count(*) from bots.bots where campaign_id = $1) + (select count(*) from bots.engine_calls where campaign_id = $1) + (select count(*) from bots.spend_daily where campaign_id = $1) as n`, [CAMP_B]);
    afirmar(quedan === 0, `Quedaron ${quedan} filas de la campaña borrada`);
  });

  console.log('\nRepositorio de Supabase (cliente simulado)');
  const repoDe = (persona: string) => new RepositorioSupabase({
    servicio: clienteSimulado(db, { servicio: true }) as never,
    persona: async () => clienteSimulado(db, { persona }) as never,
  });
  await prueba('lee los bots con las reglas de cada persona', async () => {
    const editor = await repoDe(P.editor).bots(CAMP_A);
    afirmar(editor.length === 3 && editor.every((b) => b.campanaId === CAMP_A && b.estado !== 'archivado'), JSON.stringify(editor.map((b) => b.nombre)));
    const conArchivados = await repoDe(P.editor).bots(CAMP_A, { archivados: true });
    afirmar(conArchivados.length === 4, `Con archivados: ${conArchivados.length}`);
    afirmar((await repoDe(P.sinAcceso).bots(CAMP_A)).length === 0, 'Sin acceso ve bots');
    afirmar(await repoDe(P.editor).campanaPreparada(CAMP_A), 'La campaña no figura preparada');
    afirmar(!(await repoDe(P.ajeno).campanaPreparada(CAMP_A)), 'El ajeno ve la campaña preparada');
  });
  await prueba('crea, guarda y elige motores por las funciones; los errores llegan con código', async () => {
    const r = repoDe(P.editor);
    const id = await r.crearBot(CAMP_A, { nombre: 'Desde el repositorio', caso: 'politico', mercado: 'UY', trato: 'tu' }, U(901), P.editor);
    const b = await r.bot(id);
    afirmar(b?.nombre === 'Desde el repositorio' && b.mercado === 'UY' && b.topeDiarioUsd === 5, JSON.stringify(b));
    await r.guardarBot(id, { avisoIa: 'Soy un asistente virtual.' }, P.editor);
    afirmar((await r.bot(id))?.avisoIa === 'Soy un asistente virtual.', 'No guardó el aviso');
    try {
      await r.guardarMotores(id, { responder: { principal: 'claude-haiku-4.5', respaldo: null } }, null, P.editor);
      throw new Error('El editor pudo elegir motores');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    await repoDe(P.dueno).guardarMotores(id, { responder: { principal: 'claude-haiku-4.5', respaldo: null } }, { diarioUsd: 1, mensualUsd: 20 }, P.dueno);
    const m = await r.motoresDeBot(id);
    afirmar(m.map((x) => x.funcion).join(',') === 'interpretar,responder,copiloto' && m[1]?.principal === 'claude-haiku-4.5' && m[1].respaldo === null, JSON.stringify(m));
    afirmar(m[0]?.dobleLectura === true, `La doble lectura llega al repositorio: ${JSON.stringify(m[0])}`);
    for (const [eleccion, codigo] of [
      [{ interpretar: { principal: 'mistral-small-4', respaldo: null } }, 'motor'],
      [{ interpretar: { principal: 'gemini-3.1-flash-lite', respaldo: null, dobleLectura: true } }, 'doble_lectura'],
    ] as const) {
      try {
        await repoDe(P.dueno).guardarMotores(id, eleccion, null, P.dueno);
        throw new Error(`Aceptó ${JSON.stringify(eleccion)}`);
      } catch (e) {
        afirmar(e instanceof ErrorDatos && e.codigo === codigo, `${JSON.stringify(eleccion)}: ${(e as Error).message}`);
      }
    }
  });
  await prueba('registra llamadas con la clave de servicio y el gasto sale de spend_daily', async () => {
    const r = repoDe(P.editor);
    const [b] = await r.bots(CAMP_A);
    await r.registrarLlamada({ botId: b!.id, campanaId: CAMP_A, uso: 'simulador', funcion: 'interpretar', motorId: 'simulado', modelo: 'simulado', proveedor: 'simulado', respaldo: false, ok: true, error: null, demoraMs: 3, tokensEntrada: 10, tokensSalida: 2, tokensCache: 0, tokensRazonamiento: 0, costoUsd: 0.5, idGeneracion: null, personaId: P.editor });
    const hoy = new Date().toISOString().slice(0, 10);
    afirmar(await r.gastoBot(b!.id, hoy) === 0.5, 'El gasto del bot no suma');
    afirmar(await r.gastoBot(b!.id, hoy, 'en_vivo') === 0, 'El gasto en vivo no filtra por uso');
    afirmar((await r.llamadas(CAMP_A)).length === 0, 'El editor ve las llamadas');
    const dueno = repoDe(P.dueno);
    const ll = await dueno.llamadas(CAMP_A, { botId: b!.id });
    afirmar(ll.length === 1 && ll[0]!.costoUsd === 0.5 && ll[0]!.personaId === P.editor, JSON.stringify(ll));
    afirmar((await dueno.gastoPorDia(CAMP_A, hoy)).some((g) => g.botId === b!.id && g.costoUsd === 0.5), 'gastoPorDia');
  });
  await prueba('topes del bot con la clave de servicio (la capa los lee también sin sesión)', async () => {
    const [b] = await repoDe(P.lector).bots(CAMP_A);
    const t = await repoDe(P.lector).topesBot(b!.id);
    afirmar(t && Number.isFinite(t.diarioUsd) && Number.isFinite(t.mensualUsd), JSON.stringify(t));
    afirmar((await repoDe(P.lector).topesBot(U(998))) === null, 'Un bot que no existe devolvió topes');
  });
  await prueba('fichas y motores por defecto', async () => {
    const r = repoDe(P.lector);
    afirmar((await r.fichas()).length === FICHAS_MOTORES.length, 'fichas');
    afirmar(JSON.stringify(await r.motoresPorDefecto()) === JSON.stringify(MOTORES_POR_DEFECTO), 'por defecto');
  });
  await prueba('asigna roles por bots.asignar_rol', async () => {
    await repoDe(P.dueno).asignarRol(CAMP_A, P.sinAcceso, 'agente', P.dueno);
    afirmar((await uno<{ r: string }>(db, `select bots.rol_efectivo($1, $2) as r`, [CAMP_A, P.sinAcceso]))?.r === 'agente', 'No quedó como agente');
    await repoDe(P.dueno).asignarRol(CAMP_A, P.sinAcceso, null, P.dueno);
  });

  console.log('\nVersiones y borrador');
  const plantilla = plantillaPolitica({ candidato: 'Candidata', trato: 'usted', mercado: 'PA' });
  const crearConPlantilla = (tx: Transaction, nombre: string) =>
    uno<{ id: string }>(tx, `select bots.crear_bot($1, $2::jsonb, null) as id`, [CAMP_A, JSON.stringify({ nombre, caso: 'electoral', mercado: 'PA', trato: 'usted', definicion: plantilla })]).then((r) => r!.id);
  const guardar = (tx: Transaction, version: string, seq: number, extra: { origen?: string; objetivo?: number | null; definicion?: unknown } = {}) =>
    uno<{ s: number }>(tx, `select bots.guardar_cambio($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb) as s`, [
      version, seq, extra.origen ?? 'editor', JSON.stringify([{ tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre: 'x' } }]),
      JSON.stringify({ tipo: 'restaurar', partes: {} }), 'Editó la caja 1.2', extra.objetivo ?? null, JSON.stringify(extra.definicion ?? plantilla),
    ]).then((r) => r!.s);
  let botV = '';
  let verV = '';
  await prueba('crear un bot con la plantilla crea su versión 1 en borrador, en la misma transacción', async () => {
    botV = await comoPersona(db, P.editor, (tx) => crearConPlantilla(tx, 'Con plantilla'));
    const v = await uno<{ id: string; number: number; status: string; seq: number; organization_id: string; created_by: string }>(db, `select id, number, status, seq, organization_id, created_by from bots.versions where bot_id = $1`, [botV]);
    afirmar(v?.number === 1 && v.status === 'borrador' && v.seq === 0 && v.organization_id === ORG_A && v.created_by === P.editor, JSON.stringify(v));
    verV = v.id;
    const sin = await comoPersona(db, P.editor, (tx) => crearBot(tx, CAMP_A, 'Sin plantilla'));
    afirmar(await cuenta(db, `select count(*) as n from bots.versions where bot_id = $1`, [sin]) === 0, 'Sin definición no crea versión');
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.crear_bot($1, $2::jsonb, null)`, [CAMP_A, JSON.stringify({ nombre: 'Mala', caso: 'electoral', mercado: 'PA', definicion: { flujos: [] } })])));
    afirmar(e && /check/.test(e), `Una definición sin formato 1 no entra: ${e}`);
    afirmar(await cuenta(db, `select count(*) as n from bots.bots where name = 'Mala'`) === 0, 'El bot de la definición mala quedó creado');
  });
  await prueba('crear borrador: devuelve el que hay; sin versiones y sin definición, error claro; solo editor y administrador', async () => {
    const mismo = await comoPersona(db, P.adminCamp, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, null) as id`, [botV]));
    afirmar(mismo?.id === verV, `Creó otro borrador: ${JSON.stringify(mismo)}`);
    const sin = await comoPersona(db, P.editor, (tx) => crearBot(tx, CAMP_A, 'Sin versiones'));
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.crear_borrador($1, null)`, [sin])));
    afirmar(e && /versión de la que partir/.test(e), `Dio: ${e}`);
    for (const p of [P.agente, P.lector, P.sinAcceso, P.ajeno]) {
      const x = await error(() => comoPersona(db, p, (tx) => tx.query(`select bots.crear_borrador($1, $2::jsonb)`, [sin, JSON.stringify(plantilla)])));
      afirmar(x && /no permite/.test(x), `${p} pudo crear un borrador: ${x}`);
    }
    const nuevo = await comoPersona(db, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, $2::jsonb) as id`, [sin, JSON.stringify(plantilla)]));
    const v = await uno<{ number: number; based_on_id: string | null }>(db, `select number, based_on_id from bots.versions where id = $1`, [nuevo!.id]);
    afirmar(v?.number === 1 && v.based_on_id === null, JSON.stringify(v));
    afirmar(await cuenta(db, `select count(*) as n from core.audit_log where action = 'bots.borrador_creado'`) === 1, 'Crear el borrador no quedó en la actividad');
  });
  await prueba('guardar un cambio: sube el seq y queda en el historial; con un seq viejo corta con 40001', async () => {
    const s1 = await comoPersona(db, P.editor, (tx) => guardar(tx, verV, 0));
    const s2 = await comoPersona(db, P.adminCamp, (tx) => guardar(tx, verV, 1));
    afirmar(s1 === 1 && s2 === 2, `seq ${s1}, ${s2}`);
    const e = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 1)));
    afirmar(e && /borrador cambió/.test(e), `Dio: ${e}`);
    const code = await comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_cambio($1, 0, 'editor', '[]', '{}', 'x', null, $2::jsonb)`, [verV, JSON.stringify(plantilla)]).then(() => '', (x: { code?: string }) => x.code ?? ''));
    afirmar(code === '40001', `Código ${code}`);
    const h = await filas<{ seq: number; profile_id: string; organization_id: string }>(db, `select seq, profile_id, organization_id from bots.version_changes where version_id = $1 order by seq`, [verV]);
    afirmar(h.length === 2 && h[0]!.profile_id === P.editor && h[1]!.profile_id === P.adminCamp && h[0]!.organization_id === ORG_A, JSON.stringify(h));
    afirmar(await cuenta(db, `select seq as n from bots.versions where id = $1`, [verV]) === 2, 'El seq de la versión no quedó en 2');
  });
  await prueba('guardar un cambio: agente, lector, sin acceso y ajeno no; deshacer sin objetivo o una definición sin formato, no', async () => {
    for (const p of [P.agente, P.lector, P.sinAcceso, P.ajeno]) {
      const x = await error(() => comoPersona(db, p, (tx) => guardar(tx, verV, 2)));
      afirmar(x && /no permite/.test(x), `${p} pudo: ${x}`);
    }
    const x = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 2, { origen: 'deshacer' })));
    afirmar(x && /check/.test(x), `Deshacer sin objetivo: ${x}`);
    const y = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 2, { origen: 'deshacer', objetivo: 5 })));
    afirmar(y && /check/.test(y), `Deshacer un cambio futuro: ${y}`);
    const z = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 2, { definicion: { formato: 2 } })));
    afirmar(z && /check/.test(z), `Formato 2: ${z}`);
    const w = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 2, { origen: 'magia' })));
    afirmar(w && /check/.test(w), `Origen desconocido: ${w}`);
    afirmar(await cuenta(db, `select seq as n from bots.versions where id = $1`, [verV]) === 2, 'Un intento rechazado cambió el seq');
    const ok = await comoPersona(db, P.editor, (tx) => guardar(tx, verV, 2, { origen: 'deshacer', objetivo: 2 }));
    afirmar(ok === 3, `Deshacer válido: ${ok}`);
  });
  await prueba('el historial solo se agrega: ni la persona ni el servidor lo cambian', async () => {
    const e = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`insert into bots.version_changes (campaign_id, version_id, seq, origin, operations, inverse, summary) values ($1, $2, 99, 'editor', '[]', '{}', 'x')`, [CAMP_A, verV]), { deshacer: true }));
    afirmar(e && /permission denied/.test(e), `La persona pudo escribir el historial: ${e}`);
    const e2 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`update bots.versions set seq = 0 where id = $1`, [verV]), { deshacer: true }));
    afirmar(e2 && /permission denied/.test(e2), `La persona pudo cambiar la versión: ${e2}`);
    const e3 = await error(() => comoServicio(db, (tx) => tx.query(`update bots.version_changes set summary = 'otro' where version_id = $1`, [verV])));
    afirmar(e3 && /permission denied|solo admite agregar/.test(e3), `El servidor pudo cambiar el historial: ${e3}`);
  });
  await prueba('leer versiones e historial: los roles de la campaña sí; sin acceso y ajeno no', async () => {
    for (const p of [P.dueno, P.adminCamp, P.editor, P.agente, P.lector]) {
      const n = await comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.version_changes where version_id = $1`, [verV]));
      const v = await comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.versions where id = $1`, [verV]));
      afirmar(n === 3 && v === 1, `${p} ve ${v} versiones y ${n} cambios`);
    }
    for (const p of [P.sinAcceso, P.ajeno]) {
      const n = await comoPersona(db, p, (tx) => cuenta(tx, `select (select count(*) from bots.version_changes where version_id = $1) + (select count(*) from bots.versions where id = $1) as n`, [verV]));
      afirmar(n === 0, `${p} ve ${n}`);
    }
  });
  await prueba('una versión que ya no es borrador no se cambia; el borrador nuevo la copia como v2', async () => {
    await comoServicio(db, (tx) => tx.query(`update bots.versions set status = 'publicada' where id = $1`, [verV]));
    await comoServicio(db, (tx) => tx.query(`update bots.bots set published_version_id = $1 where id = $2`, [verV, botV]));
    const e = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verV, 3)));
    afirmar(e && /ya no es un borrador/.test(e), `Dio: ${e}`);
    const nuevo = await comoPersona(db, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, null) as id`, [botV]));
    const v = await uno<{ number: number; based_on_id: string; status: string; seq: number; iguales: boolean }>(db,
      `select n.number, n.based_on_id, n.status, n.seq, n.definition = p.definition as iguales from bots.versions n, bots.versions p where n.id = $1 and p.id = $2`, [nuevo!.id, verV]);
    afirmar(v?.number === 2 && v.based_on_id === verV && v.status === 'borrador' && v.seq === 0 && v.iguales, JSON.stringify(v));
    const dos = await error(() => comoServicio(db, (tx) => tx.query(`insert into bots.versions (campaign_id, bot_id, number, definition) values ($1, $2, 3, '{"formato": 1}')`, [CAMP_A, botV])));
    afirmar(dos && /duplicate key|unique/.test(dos), `Dos borradores del mismo bot: ${dos}`);
  });
  await prueba('un bot archivado no cambia su borrador', async () => {
    const id = await comoPersona(db, P.editor, (tx) => crearConPlantilla(tx, 'Para archivar'));
    const ver = (await uno<{ id: string }>(db, `select id from bots.versions where bot_id = $1`, [id]))!.id;
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.archivar($1)`, [id]));
    const e = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, ver, 0)));
    afirmar(e && /archivado/.test(e), `Dio: ${e}`);
  });
  await prueba('repositorio de Supabase: borrador, cambios, deshacer y errores con código', async () => {
    const r = repoDe(P.editor);
    const id = await r.crearBot(CAMP_A, { nombre: 'Repo con plantilla', caso: 'electoral', mercado: 'PA', trato: 'usted' }, U(902), P.editor, plantilla);
    const b = await r.borrador(id);
    // jsonb ordena las claves a su manera: el servidor vuelve a pasar la definición por zod, que las deja en su orden.
    afirmar(b?.numero === 1 && b.seq === 0 && JSON.stringify(esquemaDefinicion.parse(b.definicion)) === JSON.stringify(plantilla), JSON.stringify({ ...b, definicion: '…' }));
    const c = aplicarCambio(plantilla, [{ tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre: 'Menú' } }]);
    const s = await r.guardarCambio(b.id, 0, { origen: 'editor', operaciones: c.operaciones, inversa: c.inversa, resumen: c.resumen, objetivo: null }, c.definicion, P.editor);
    afirmar(s === 1, `seq ${s}`);
    try {
      await r.guardarCambio(b.id, 0, { origen: 'editor', operaciones: c.operaciones, inversa: c.inversa, resumen: c.resumen, objetivo: null }, c.definicion, P.editor);
      throw new Error('Guardó con un seq viejo');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'borrador_cambio', `Dio: ${(e as Error).message}`);
    }
    const h = await repoDe(P.lector).cambios(b.id);
    afirmar(h.length === 1 && h[0]!.resumen === 'Editó la caja 1.2' && h[0]!.personaId === P.editor && !('inversa' in h[0]!), JSON.stringify(h));
    const completo = await r.cambio(b.id, 1);
    afirmar(canonico(completo?.inversa) === canonico(c.inversa) && completo?.operaciones.length === 1, JSON.stringify(completo));
    afirmar(pilasDeshacer(h).deshacer?.desde === 1, 'Pilas');
    afirmar((await r.versiones(id)).map((v) => `${v.numero}:${v.estado}:${v.seq}`).join() === '1:borrador:1', 'Versiones');
    afirmar(await r.crearBorrador(id, null, P.editor) === b.id, 'crearBorrador devolvió otro');
    try {
      await repoDe(P.agente).guardarCambio(b.id, 1, { origen: 'editor', operaciones: c.operaciones, inversa: c.inversa, resumen: c.resumen, objetivo: null }, c.definicion, P.agente);
      throw new Error('El agente pudo guardar');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    const sin = await r.crearBot(CAMP_A, { nombre: 'Repo sin plantilla', caso: 'electoral', mercado: 'PA', trato: 'usted' }, U(903), P.editor);
    afirmar((await r.borrador(sin)) === null, 'Un bot sin plantilla tiene borrador');
    try {
      await r.crearBorrador(sin, null, P.editor);
      throw new Error('Creó un borrador de la nada');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_version', `Dio: ${(e as Error).message}`);
    }
  });
  console.log('\nCorridas de prueba y publicación');
  const botP = await comoPersona(db, P.editor, (tx) => crearConPlantilla(tx, 'Para publicar'));
  const verP = (await uno<{ id: string }>(db, `select id from bots.versions where bot_id = $1`, [botP]))!.id;
  const correr = async (persona: string, version: string, acierto: number) => {
    const id = (await comoPersona(db, persona, (tx) => uno<{ id: string }>(tx, `select bots.crear_corrida($1, $2::jsonb, 'Motores del bot', 2) as id`, [version, '{"interpretar": {"principal": "gemini-3.1-flash-lite"}}'])))!.id;
    const n = await comoPersona(db, persona, (tx) => uno<{ n: number }>(tx, `select bots.guardar_resultados($1, $2::jsonb) as n`, [id, JSON.stringify([
      { caso: 'c001', tipo: 'intencion', ok: true, resultado: { final: 'cortesia' }, costo: 0.001 },
      { caso: 'c002', tipo: 'base', ok: false, resultado: { tieneRespuesta: 'no' }, costo: 0.002 },
      { caso: 'c001', tipo: 'intencion', ok: false, resultado: {}, costo: 9 },
    ])]));
    afirmar(n?.n === 2, `Guardó ${n?.n} resultados (el repetido no cuenta)`);
    await comoPersona(db, persona, (tx) => tx.query(`select bots.cerrar_corrida($1, $2::jsonb, 'terminada')`, [id, JSON.stringify({ acierto })]));
    return id;
  };
  let corridaP = '';
  await prueba('corridas: editor y administrador corren; agente y lector no; los repetidos no se duplican; costo sumado', async () => {
    for (const p of [P.agente, P.lector, P.ajeno]) {
      const e = await error(() => comoPersona(db, p, (tx) => tx.query(`select bots.crear_corrida($1, '{}'::jsonb, 'x', 1)`, [verP])));
      afirmar(e && /no permite/.test(e), `${p} pudo correr: ${e}`);
    }
    corridaP = await correr(P.editor, verP, 90);
    const r = await uno<{ status: string; done: number; cost_usd: string; version_seq: number; organization_id: string }>(db, `select status, done, cost_usd, version_seq, organization_id from bots.test_runs where id = $1`, [corridaP]);
    afirmar(r?.status === 'terminada' && r.done === 2 && Number(r.cost_usd) === 0.003 && r.version_seq === 0 && r.organization_id === ORG_A, JSON.stringify(r));
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.guardar_resultados($1, '[]'::jsonb)`, [corridaP])));
    afirmar(e && /ya terminó/.test(e), `Una corrida terminada aceptó resultados: ${e}`);
    const lector = await comoPersona(db, P.lector, (tx) => cuenta(tx, `select count(*) as n from bots.test_results where run_id = $1`, [corridaP]));
    const ajeno = await comoPersona(db, P.ajeno, (tx) => cuenta(tx, `select count(*) as n from bots.test_results where run_id = $1`, [corridaP]));
    afirmar(lector === 2 && ajeno === 0, `lector ${lector}, ajeno ${ajeno}`);
  });
  await prueba('pedir publicar: sin corrida sobre el último cambio no; el agente no; con corrida sí, y la versión queda pedida', async () => {
    await comoPersona(db, P.editor, (tx) => guardar(tx, verP, 0));
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 1, '')`, [verP])));
    afirmar(e && /Falta correr las pruebas/.test(e), `Dio: ${e}`);
    await correr(P.editor, verP, 90);
    const e2 = await error(() => comoPersona(db, P.agente, (tx) => tx.query(`select bots.pedir_publicacion($1, 1, '')`, [verP])));
    afirmar(e2 && /no permite/.test(e2), `El agente pudo pedir: ${e2}`);
    const e3 = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 0, '')`, [verP])));
    afirmar(e3 && /borrador cambió/.test(e3), `Con un seq viejo: ${e3}`);
    await comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 1, 'Primera')`, [verP]));
    const v = await uno<{ status: string }>(db, `select status from bots.versions where id = $1`, [verP]);
    afirmar(v?.status === 'pedida', JSON.stringify(v));
    const e4 = await error(() => comoPersona(db, P.editor, (tx) => guardar(tx, verP, 1)));
    afirmar(e4 && /ya no es un borrador/.test(e4), `Una versión pedida se pudo cambiar: ${e4}`);
  });
  await prueba('aprobar: solo el administrador; la versión queda publicada y el bot publicado; queda en la actividad', async () => {
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.aprobar_publicacion($1, '')`, [verP])));
    afirmar(e && /no permite/.test(e), `El editor pudo aprobar: ${e}`);
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.aprobar_publicacion($1, 'Bien')`, [verP]));
    const b = await uno<{ status: string; published_version_id: string }>(db, `select status, published_version_id from bots.bots where id = $1`, [botP]);
    afirmar(b?.status === 'publicado' && b.published_version_id === verP, JSON.stringify(b));
    const ev = (await filas<{ action: string }>(db, `select action from bots.publication_events where bot_id = $1 order by id`, [botP])).map((x) => x.action).join();
    afirmar(ev === 'pedido,aprobado', ev);
    const act = await cuenta(db, `select count(*) as n from core.audit_log where action in ('bots.publicacion_pedida', 'bots.publicacion_aprobada')`);
    afirmar(act === 2, `Actividad: ${act}`);
  });
  await prueba('una versión nueva que baja 2 puntos no se puede pedir; devolver pide comentario y vuelve a borrador', async () => {
    const v2 = (await comoPersona(db, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, null) as id`, [botP])))!.id;
    await correr(P.editor, v2, 87.5);
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 0, '')`, [v2])));
    afirmar(e && /baja el acierto/.test(e), `Dio: ${e}`);
    await correr(P.editor, v2, 88.5);
    await comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 0, '')`, [v2]));
    const e2 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select bots.devolver_publicacion($1, '  ')`, [v2])));
    afirmar(e2 && /hace falta un comentario/.test(e2), `Dio: ${e2}`);
    await comoPersona(db, P.dueno, (tx) => tx.query(`select bots.devolver_publicacion($1, 'Revisar el menú')`, [v2]));
    const v = await uno<{ status: string }>(db, `select status from bots.versions where id = $1`, [v2]);
    afirmar(v?.status === 'borrador', JSON.stringify(v));
    const e3 = await error(() => comoServicio(db, (tx) => tx.query(`update bots.publication_events set note = 'x' where bot_id = $1`, [botP])));
    afirmar(e3 && /permission denied|solo admite agregar/.test(e3), `Se pudo cambiar un evento: ${e3}`);
  });
  await prueba('con un pedido pendiente, el borrador nuevo parte de lo pedido (no de lo publicado)', async () => {
    const botQ = await comoPersona(db, P.editor, (tx) => crearConPlantilla(tx, 'Pedido pendiente'));
    const v1 = (await uno<{ id: string }>(db, `select id from bots.versions where bot_id = $1`, [botQ]))!.id;
    await correr(P.editor, v1, 90);
    await comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 0, '')`, [v1]));
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.aprobar_publicacion($1, '')`, [v1]));
    const v2 = (await comoPersona(db, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, null) as id`, [botQ])))!.id;
    const pedida = { ...plantilla, contenidos: plantilla.contenidos.map((c, i) => (i ? c : { ...c, texto: 'Lo que se pidió publicar.' })) };
    await comoPersona(db, P.editor, (tx) => guardar(tx, v2, 0, { definicion: pedida }));
    await correr(P.editor, v2, 90);
    await comoPersona(db, P.editor, (tx) => tx.query(`select bots.pedir_publicacion($1, 1, '')`, [v2]));
    const v3 = (await comoPersona(db, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, null) as id`, [botQ])))!.id;
    const r = await uno<{ based_on_id: string; iguales: boolean }>(db, `select n.based_on_id, n.definition = p.definition as iguales from bots.versions n, bots.versions p where n.id = $1 and p.id = $2`, [v3, v2]);
    afirmar(r?.based_on_id === v2 && r.iguales, `El borrador nuevo parte de: ${JSON.stringify(r)}`);
    // Devolver el pedido con otro borrador abierto lo deja como "devuelta" (no puede haber dos borradores).
    await comoPersona(db, P.adminCamp, (tx) => tx.query(`select bots.devolver_publicacion($1, 'Falta el menú')`, [v2]));
    const e = await uno<{ status: string }>(db, `select status from bots.versions where id = $1`, [v2]);
    afirmar(e?.status === 'devuelta', JSON.stringify(e));
  });
  await prueba('repositorio de Supabase: corridas, resultados y publicación con códigos de error', async () => {
    const r = repoDe(P.editor);
    const b = (await r.borrador(botP))!;
    const otro = await r.crearBot(CAMP_A, { nombre: 'Sin corridas', caso: 'electoral', mercado: 'PA', trato: 'usted' }, U(904), P.editor, plantilla);
    try {
      const bo = (await r.borrador(otro))!;
      await r.pedirPublicacion(bo.id, bo.seq, '', P.editor);
      throw new Error('Pidió sin corrida');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_corrida', `Dio: ${(e as Error).message}`);
    }
    const id = await r.crearCorrida(b.id, { interpretar: { principal: 'gemini-3.1-flash-lite' } }, 'Motores del bot', 1, P.editor);
    const n = await r.guardarResultados(id, [{ caso: 'c001', tipo: 'intencion', ok: true, resultado: { final: 'cortesia' }, costo: 0.001 }], P.editor);
    afirmar(n === 1, `Resultados: ${n}`);
    await r.cerrarCorrida(id, { casos: 1, acierto: 100, intencion: { casos: 1, porReglas: 0, sinRespuesta: 0, acierto: 100, coinciden: 100, aciertoCuandoCoinciden: 100, aclaracion: 0 }, base: { casos: 0, sinRespuesta: 0, acierto: null, contesta: null, reconoce: null, cortadas: null }, costoUsd: 0.001, demoraP50: null }, 'terminada', P.editor);
    const c = await repoDe(P.lector).corrida(id);
    afirmar(c?.estado === 'terminada' && c.resultados.length === 1 && c.resumen?.acierto === 100 && c.costoUsd === 0.001, JSON.stringify(c));
    afirmar((await r.corridas(botP)).length >= 4, 'corridas');
    await r.pedirPublicacion(b.id, b.seq, 'Otra vez', P.editor);
    try {
      await r.aprobarPublicacion(b.id, '', P.editor);
      throw new Error('El editor aprobó');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    await repoDe(P.dueno).aprobarPublicacion(b.id, '', P.dueno);
    const vs = await r.versiones(botP);
    afirmar(vs.map((v) => `${v.numero}:${v.estado}`).join() === '2:publicada,1:archivada', JSON.stringify(vs.map((v) => [v.numero, v.estado])));
    afirmar((await r.eventosPublicacion(botP)).map((x) => x.accion).join() === 'aprobado,pedido,devuelto,pedido,aprobado,pedido', 'eventos');
    afirmar((await r.version(b.id))?.estado === 'publicada', 'version()');
  });
  console.log('\nCanal web (bots_0006)');
  const pub = new RepositorioPublicoSupabase(clienteSimulado(db, { servicio: true }) as never);
  const hmac = (t: string) => createHmac('sha256', 'clave-de-prueba').update(t).digest('hex');
  const idPublico = (await uno<{ public_id: string }>(db, `select public_id from bots.bots where id = $1`, [botP]))!.public_id;
  let convWeb = '';
  await prueba('la app pública ve el bot publicado con su canal; una persona no puede llamar a las funciones públicas', async () => {
    const bp = await pub.botPublico(idPublico);
    afirmar(bp?.version && bp.bot.estado === 'publicado' && bp.canal.activo && bp.canal.modoCondiciones === 'aviso' && bp.condiciones === null && bp.campana.nombre === 'Campaña A' && bp.publicadoDesde, JSON.stringify(bp?.canal));
    afirmar(typeof bp.bot.topeDiarioUsd === 'number', 'topes');
    afirmar((await pub.botPublico('noexiste00')) === null, 'Un id que no existe devuelve algo');
    const e = await error(() => comoPersona(db, P.editor, (tx) => tx.query(`select bots.publico_bot($1)`, [idPublico])));
    afirmar(e && /permission denied/.test(e), `Una persona llamó a publico_bot: ${e}`);
    const e2 = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`select * from bots.rate_limits`)));
    afirmar(e2 && /permission denied/.test(e2) || (await comoPersona(db, P.dueno, (tx) => cuenta(tx, `select count(*) as n from bots.rate_limits`))) === 0, `rate_limits a la vista: ${e2}`);
  });
  await prueba('conteos por ventana fija; conversación nueva, la misma, y otra después de 30 minutos', async () => {
    const t0 = new Date('2026-09-30T20:00:10Z');
    afirmar((await pub.contar([{ clave: 'ip:x:m', ventanaSegundos: 60 }, { clave: 'ip:x:d', ventanaSegundos: 86400 }], t0)).join() === '1,1', 'primer conteo');
    afirmar((await pub.contar([{ clave: 'ip:x:m', ventanaSegundos: 60 }], t0)).join() === '2', 'segundo conteo');
    afirmar((await pub.contar([{ clave: 'ip:x:m', ventanaSegundos: 60 }], new Date('2026-09-30T20:01:01Z'))).join() === '1', 'ventana nueva');
    const h = hmac('contacto-1');
    const a = await pub.abrirConversacion({ botId: botP, contactoHash: h, canal: 'web', verificadoAhora: true, ahora: t0 });
    afirmar(a.nueva && a.conversacion.verificada && a.conversacion.estado === 'bot' && a.contacto.hash === h, JSON.stringify(a.conversacion));
    const b = await pub.abrirConversacion({ botId: botP, contactoHash: h, canal: 'web', verificadoAhora: false, ahora: new Date('2026-09-30T20:05:00Z') });
    afirmar(!b.nueva && b.conversacion.id === a.conversacion.id, 'No siguió la misma');
    convWeb = a.conversacion.id;
  });
  await prueba('guardar un turno: mensajes, datos del contacto, eventos; otro turno a la vez corta; un reintento no se duplica', async () => {
    const t = (n: number) => ({
      entrante: { tipo: 'texto' as const, texto: `Hola ${n}`, datos: null, idCanal: `m-${n}` }, salientes: [{ autor: 'bot' as const, texto: 'Hola, ¿cómo se llama?', cajaId: 'n_sumate', datos: null }, { autor: 'bot' as const, texto: 'Otra', cajaId: null, datos: { opciones: [{ letra: 'A', texto: 'Sí' }], modo: 'botones' as const } }],
      decision: { recorrido: ['n_sumate'], costoUsd: 0.001, secciones: ['S01'] }, sesion: { espera: null, variables: { 'contacto.nombre': 'Rosa' }, estado: 'bot' as const, turnos: [], iniciada: true },
      estado: 'bot' as const, cajaActual: 'n_sumate', versionId: null, eventos: [{ nombre: 'texto_recibido' as const, cajaId: null, datos: { largo: 6 } }],
      derivacion: null, datosContacto: { 'contacto.nombre': 'Rosa' }, muestra: true, ahora: '2026-09-30T20:06:00Z',
    });
    const ms = await pub.guardarTurno(convWeb, 0, t(1));
    afirmar(ms.map((m) => `${m.n}:${m.autor}`).join() === '1:contacto,2:bot,3:bot' && ms[1]!.decision && !ms[2]!.decision && ms[1]!.muestra && !ms[2]!.muestra, JSON.stringify(ms.map((m) => [m.n, m.autor, !!m.decision, m.muestra])));
    try {
      await pub.guardarTurno(convWeb, 0, t(2));
      throw new Error('Guardó con un seq viejo');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'conversacion_cambio', `Dio: ${(e as Error).message}`);
    }
    try {
      await pub.guardarTurno(convWeb, 3, t(1));
      throw new Error('Guardó un repetido');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'repetido', `Dio: ${(e as Error).message}`);
    }
    const c = await uno<{ name: string; seq: number }>(db, `select c.name, s.seq from bots.sessions s join bots.contacts c on c.id = s.contact_id where s.id = $1`, [convWeb]);
    afirmar(c?.name === 'Rosa' && c.seq === 3, JSON.stringify(c));
    afirmar(await cuenta(db, `select count(*) as n from bots.events where session_id = $1 and name = 'texto_recibido' and contact_hash is not null`, [convWeb]) === 1, 'eventos');
    afirmar((await pub.mensajes(convWeb, 1)).length === 2 && (await pub.mensajePorIdCanal(convWeb, 'm-1'))?.n === 1, 'mensajes');
  });
  await prueba('reglas por fila: conversaciones para quien lee conversaciones; eventos para quien entra al producto', async () => {
    const ve = async (p: string, tabla: string) => comoPersona(db, p, (tx) => cuenta(tx, `select count(*) as n from bots.${tabla} where campaign_id = $1`, [CAMP_A]));
    afirmar(await ve(P.agente, 'messages') === 3 && await ve(P.editor, 'sessions') === 1 && await ve(P.dueno, 'contacts') === 1, 'agente, editor y dueño');
    afirmar(await ve(P.lector, 'messages') === 0 && await ve(P.lector, 'contacts') === 0 && await ve(P.ajeno, 'sessions') === 0, 'lector y ajeno');
    afirmar(await ve(P.lector, 'events') === 1 && await ve(P.ajeno, 'events') === 0, 'eventos');
    const e = await error(() => comoPersona(db, P.dueno, (tx) => tx.query(`update bots.messages set text = 'x'`)));
    afirmar(e && /permission denied/.test(e), `Una persona cambió un mensaje: ${e}`);
  });
  await prueba('canal web, condiciones y pausa: cada cosa con su permiso y en la actividad', async () => {
    const r = repoDe(P.editor);
    try {
      await r.guardarCanalWeb(botP, { activo: false, modoCondiciones: 'acepto' }, P.editor);
      throw new Error('El editor configuró el canal');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    const a = repoDe(P.adminCamp);
    await a.guardarCanalWeb(botP, { activo: true, modoCondiciones: 'acepto' }, P.adminCamp);
    afirmar(JSON.stringify(await r.canalWeb(botP)) === '{"activo":true,"modoCondiciones":"acepto"}', 'canal');
    afirmar(await a.publicarCondiciones(botP, 'Condiciones uno', P.adminCamp) === 1 && await a.publicarCondiciones(botP, 'Condiciones dos', P.adminCamp) === 2, 'números');
    afirmar((await r.condiciones(botP)).map((c) => c.numero).join() === '2,1', 'condiciones');
    const e = await error(() => comoServicio(db, (tx) => tx.query(`update bots.terms set body = 'x' where bot_id = $1`, [botP])));
    afirmar(e && /permission denied|solo admite agregar/.test(e), `Se cambió una versión de las condiciones: ${e}`);
    await a.pausarBot(botP, true, P.adminCamp);
    afirmar((await pub.botPublico(idPublico))?.bot.estado === 'pausado', 'pausa');
    try {
      await a.pausarBot(botP, true, P.adminCamp);
      throw new Error('Pausó dos veces');
    } catch (e2) {
      afirmar(e2 instanceof ErrorDatos && e2.codigo === 'no_publicado', `Dio: ${(e2 as Error).message}`);
    }
    await a.pausarBot(botP, false, P.adminCamp);
    await a.guardarCanalWeb(botP, { activo: true, modoCondiciones: 'aviso' }, P.adminCamp);
    const act = await cuenta(db, `select count(*) as n from core.audit_log where action in ('bots.pausar', 'bots.reanudar', 'bots.canal_web', 'bots.condiciones')`);
    afirmar(act === 6, `Actividad: ${act}`);
  });
  await prueba('de punta a punta: el núcleo del canal web contra la base (turno con motor simulado, derivación y mensaje en espera)', async () => {
    const capa = new CapaMotores({ repo: pub, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
    const entorno = { ahora: () => new Date('2026-09-30T20:10:00Z'), ip: '203.0.113.9', hash: hmac, verificar: async () => true, verificacionConfigurada: true, capa };
    let n = 0;
    const pedir = (entrada: unknown) => atenderMensaje(pub, entorno, { bot: idPublico, contacto: 'contacto-punta-0000001', canal: 'landing', id: `p-${String(++n).padStart(8, '0')}`, entrada, verificacion: 'ok' });
    const i = await pedir({ tipo: 'inicio' });
    afirmar(i.ok && i.mensajes.some((m) => m.enlace === 'condiciones') && i.mensajes.some((m) => m.opcionesDe === 'n_menu'), JSON.stringify(i).slice(0, 300));
    const d = await pedir({ tipo: 'texto', texto: 'Quiero hablar con una persona del equipo' });
    afirmar(d.ok && d.estado === 'derivada', JSON.stringify(d).slice(0, 300));
    const s = await pedir({ tipo: 'texto', texto: '¿Hay alguien?' });
    afirmar(s.ok && s.mensajes.length === 0 && s.estado === 'derivada', JSON.stringify(s).slice(0, 300));
    const c = await uno<{ terms_number: number; state: string; handoff_reason: string }>(db, `select c.terms_number, s.state, s.handoff_reason from bots.sessions s join bots.contacts c on c.id = s.contact_id where c.external_id_hash = $1`, [hmac(`contacto:${botP}:contacto-punta-0000001`)]);
    afirmar(c?.terms_number === 2 && c.state === 'derivada' && c.handoff_reason === 'Pidió hablar con el equipo', JSON.stringify(c));
  });

  console.log('\nBandeja (bots_0007)');
  let convDerivada = '';
  await prueba('la bandeja: la leen el agente y el editor; el lector y el ajeno no', async () => {
    const filas = await repoDe(P.agente).conversaciones(CAMP_A, { estado: 'derivada' });
    afirmar(filas.length === 1 && filas[0]!.ultimo?.autor === 'contacto' && filas[0]!.contacto.nombre === null, JSON.stringify(filas));
    convDerivada = filas[0]!.conversacion.id;
    afirmar((await repoDe(P.editor).conversaciones(CAMP_A)).length === 2, 'editor');
    for (const p of [P.lector, P.ajeno]) {
      try {
        await repoDe(p).conversaciones(CAMP_A);
        throw new Error(`${p} leyó la bandeja`);
      } catch (e) {
        afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
      }
    }
    const c = await repoDe(P.agente).conversacion(convDerivada);
    afirmar(c && c.mensajes.length >= 4 && c.contacto.condicionesVersion === 2, 'conversación');
    afirmar((await repoDe(P.lector).conversacion(convDerivada)) === null, 'El lector ve una conversación');
  });
  await prueba('alerta de derivada sin respuesta a las 2 horas (fechas simuladas); el agente toma, responde y se cierra la alerta', async () => {
    const tareas = pub;
    // La derivación, hace 3 horas (la respuesta del equipo queda con la hora real).
    await db.query(`update bots.sessions set handoff_at = now() - interval '3 hours' where id = $1`, [convDerivada]);
    const hace = (min: number) => new Date(Date.now() - min * 60_000);
    afirmar((await tareas.revisarAlertas(hace(61))).abiertas === 0, 'Abrió antes de las 2 horas');
    afirmar((await tareas.revisarAlertas(hace(59))).abiertas === 1, 'No abrió a las 2 horas');
    afirmar((await tareas.revisarAlertas(hace(58))).abiertas === 0, 'Abrió dos veces');
    afirmar((await repoDe(P.agente).alertas(CAMP_A, { abiertas: true })).map((a) => a.tipo).join() === 'derivada_sin_respuesta', 'alertas');
    try {
      await repoDe(P.editor).tomarConversacion(convDerivada, P.editor);
      throw new Error('El editor tomó la conversación');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    await repoDe(P.agente).tomarConversacion(convDerivada, P.agente);
    const n = await repoDe(P.agente).responderConversacion(convDerivada, 'Hola, soy del equipo.', P.agente);
    afirmar(n > 4, `n: ${n}`);
    const r = await tareas.revisarAlertas(new Date(Date.now() + 60_000));
    afirmar(r.cerradas === 1, JSON.stringify(r));
    const pn = await pub.mensajes(convDerivada, n - 1);
    afirmar(pn.length === 1 && pn[0]!.autor === 'agente', 'El navegador no recibe la respuesta');
    await repoDe(P.agente).devolverConversacion(convDerivada, { mensajes: [{ texto: '¿Algo más?', cajaId: 'n_masayuda', datos: null }], sesion: { espera: null, variables: {}, estado: 'bot', turnos: [], iniciada: true }, decision: { recorrido: ['n_masayuda'], costoUsd: 0 }, cajaActual: 'n_masayuda', eventos: [] }, P.agente);
    afirmar((await repoDe(P.agente).conversacion(convDerivada))?.conversacion.estado === 'bot', 'devolver');
    await repoDe(P.dueno).cerrarConversacion(convDerivada, P.dueno);
    afirmar((await repoDe(P.agente).conversacion(convDerivada))?.conversacion.estado === 'cerrada', 'cerrar');
  });
  await prueba('revisión por muestreo: el editor revisa; el agente no', async () => {
    const m = await repoDe(P.editor).muestra(CAMP_A, { pendientes: true });
    afirmar(m.length === 1 && m[0]!.conversacionId === convWeb && m[0]!.n === 2 && m[0]!.pregunta === 'Hola 1' && m[0]!.secciones.join() === 'S01', JSON.stringify(m));
    try {
      await repoDe(P.agente).revisarRespuesta(convWeb, 2, 'correcta', false, P.agente);
      throw new Error('El agente revisó');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    await repoDe(P.editor).revisarRespuesta(convWeb, 2, 'correcta', true, P.editor);
    afirmar((await repoDe(P.editor).muestra(CAMP_A, { pendientes: true })).length === 0, 'pendientes');
    const t = await repoDe(P.editor).muestra(CAMP_A);
    afirmar(t[0]!.veredicto === 'correcta' && t[0]!.convertida && t[0]!.revisadaPor === P.editor, JSON.stringify(t));
  });
  await prueba('datos de un contacto: el administrador busca, exporta y borra; queda registrado sin el dato', async () => {
    const a = repoDe(P.adminCamp);
    const f = await a.buscarContactos(CAMP_A, 'Rosa', P.adminCamp);
    afirmar(f.length === 1 && f[0]!.conversaciones === 1, JSON.stringify(f));
    try {
      await repoDe(P.agente).buscarContactos(CAMP_A, 'Rosa', P.agente);
      throw new Error('El agente buscó');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    const x = await a.exportarContacto(f[0]!.contacto.id, P.adminCamp);
    afirmar(x.contacto.nombre === 'Rosa' && x.conversaciones[0]!.mensajes.length === 3 && !('sesion' in x.conversaciones[0]!.conversacion), 'exportación');
    await a.borrarContacto(f[0]!.contacto.id, 'Lo pidió', P.adminCamp);
    afirmar(await cuenta(db, `select count(*) as n from bots.messages where session_id = $1 and text is not null`, [convWeb]) === 0, 'Quedaron textos');
    afirmar((await a.pedidosDatos(CAMP_A)).map((p) => p.tipo).join() === 'borrar,exportar', 'pedidos');
    afirmar(await cuenta(db, `select count(*) as n from core.audit_log where action = 'bots.datos_contacto' and detail::text not like '%Rosa%'`) === 2, 'actividad sin el dato');
    const e = await error(() => comoServicio(db, (tx) => tx.query(`update bots.data_requests set note = 'x'`)));
    afirmar(e && /permission denied|solo admite agregar/.test(e), `Se cambió un pedido: ${e}`);
  });
  await prueba('borrado por vencimiento: vacía los textos pasados los días de guardado (fechas simuladas)', async () => {
    afirmar(await pub.borrarVencidos(new Date('2026-10-30T00:00:00Z')) === 0, 'Borró antes de tiempo');
    const n = await pub.borrarVencidos(new Date('2027-02-01T00:00:00Z'));
    afirmar(n > 0 && await cuenta(db, `select count(*) as n from bots.messages where campaign_id = $1 and text is not null`, [CAMP_A]) === 0, `Borró ${n}`);
    afirmar(await cuenta(db, `select count(*) as n from bots.events where campaign_id = $1`, [CAMP_A]) > 0, 'Se borraron los eventos');
  });
  await prueba('borrar un bot borra sus versiones y su historial', async () => {
    await db.query(`delete from bots.bots where id = $1`, [botV]);
    afirmar(await cuenta(db, `select (select count(*) from bots.versions where bot_id = $1) + (select count(*) from bots.version_changes where version_id = $2) as n`, [botV, verV]) === 0, 'Quedaron versiones');
  });

  console.log('\nMigración 0002 sobre una base con bots de la 0001');
  await prueba('los bots que ya existían conservan sus motores; los nuevos nacen con los elegidos', async () => {
    const db3 = await baseConMigraciones('bots_0002_motores_elegidos.sql');
    await cargarDatos(db3);
    const viejo = await comoPersona(db3, P.editor, (tx) => crearBot(tx, CAMP_A, 'Bot de antes'));
    await db3.exec(readFileSync(new URL('../migraciones/bots_0002_motores_elegidos.sql', import.meta.url), 'utf8'));
    await db3.exec(readFileSync(new URL('../migraciones/bots_0003_versiones.sql', import.meta.url), 'utf8'));
    const m = await uno<{ primary_engine_id: string; fallback_engine_id: string; double_read: boolean }>(db3, `select primary_engine_id, fallback_engine_id, double_read from bots.bot_engines where bot_id = $1 and function = 'interpretar'`, [viejo]);
    afirmar(m?.primary_engine_id === 'gpt-oss-120b' && m.fallback_engine_id === 'claude-haiku-4.5' && m.double_read === false, `El bot viejo cambió: ${JSON.stringify(m)}`);
    const nuevo = await comoPersona(db3, P.editor, (tx) => crearBot(tx, CAMP_A, 'Bot de después'));
    const n = await uno<{ primary_engine_id: string; double_read: boolean }>(db3, `select primary_engine_id, double_read from bots.bot_engines where bot_id = $1 and function = 'interpretar'`, [nuevo]);
    afirmar(n?.primary_engine_id === 'gemini-3.1-flash-lite' && n.double_read === true, `El bot nuevo: ${JSON.stringify(n)}`);
    afirmar(await cuenta(db3, `select count(*) as n from bots.engines where active`) === FICHAS_MOTORES.filter((f) => f.activo).length, 'Motores activos');
    // Con la 0003: el bot de antes no tiene versiones y su borrador se arma con la plantilla.
    afirmar(await cuenta(db3, `select count(*) as n from bots.versions where bot_id = $1`, [viejo]) === 0, 'El bot de antes tiene versiones');
    const ver = await comoPersona(db3, P.editor, (tx) => uno<{ id: string }>(tx, `select bots.crear_borrador($1, $2::jsonb) as id`, [viejo, JSON.stringify(plantillaPolitica({ candidato: 'X', trato: 'usted', mercado: 'PA' }))]));
    afirmar(!!ver?.id, 'No se armó el borrador del bot de antes');
  });

  console.log('\nSemilla de desarrollo');
  await prueba('se aplica dos veces sin duplicar y deja al Dueño como administrador', async () => {
    const db2 = await baseConMigraciones();
    await db2.exec(`
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
        ('${U(301)}', 'duena@prueba.test', now(), '{"full_name": "Dueña"}'), ('${U(302)}', 'editora@prueba.test', now(), '{"full_name": "Editora"}');
    `);
    const semilla = readFileSync(`${DIR_CORE_DEV}semilla-desarrollo.sql`, 'utf8')
      .replace('{{DUENO}}', 'duena@prueba.test').replace('{{EDITOR}}', 'editora@prueba.test').replace('{{AGENTE}}', 'nadie@prueba.test');
    await db2.exec(semilla);
    await db2.exec(semilla);
    afirmar(await cuenta(db2, `select count(*) as n from core.campaigns`) === 1, 'Duplicó la campaña');
    afirmar(await cuenta(db2, `select count(*) as n from bots.campaign_settings`) === 1, 'No preparó BotMaker en la campaña');
    const roles = await filas<{ email: string; r: string }>(db2, `select p.email, bots.rol_efectivo(c.id, p.id) as r from core.campaigns c cross join core.profiles p order by p.email`);
    afirmar(JSON.stringify(roles) === JSON.stringify([{ email: 'duena@prueba.test', r: 'administrador' }, { email: 'editora@prueba.test', r: 'editor' }]), JSON.stringify(roles));
  });

  console.log(`\n${total - fallas} de ${total} pruebas bien.${fallas ? ` ${fallas} fallaron.` : ''}\n`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
