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
    const base = await filas<{ function: string; primary_engine_id: string; fallback_engine_id: string | null; timeout_ms: number }>(db, 'select * from bots.engine_defaults');
    for (const m of MOTORES_POR_DEFECTO) {
      const b = base.find((x) => x.function === m.funcion);
      afirmar(b && b.primary_engine_id === m.principal && b.fallback_engine_id === m.respaldo && b.timeout_ms === m.tiempoMaximoMs, `${m.funcion}: base ${JSON.stringify(b)} ≠ código ${JSON.stringify(m)}`);
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
      ['{"copiloto": {"principal": "ministral-8b"}}', /no sirve para la función/],
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
    const d = det?.detail as { interpretar?: { principal?: string; respaldo?: string } } | undefined;
    afirmar(Object.keys(d ?? {}).join() === 'interpretar' && d?.interpretar?.principal === 'claude-haiku-4.5' && d.interpretar.respaldo === 'gpt-oss-120b' && Object.keys(d.interpretar).length === 2, `La actividad guarda lo validado: ${JSON.stringify(det)}`);
    const act = await filas<{ action: string }>(db, `select action from core.audit_log where product_id = 'botmaker' and action in ('bots.motores_cambiados', 'bots.topes_cambiados')`);
    afirmar(act.length === 2, `Actividad: ${JSON.stringify(act)}`);
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
      await r.guardarMotores(id, { responder: { principal: 'mistral-small-4', respaldo: null } }, null, P.editor);
      throw new Error('El editor pudo elegir motores');
    } catch (e) {
      afirmar(e instanceof ErrorDatos && e.codigo === 'sin_permiso', `Dio: ${(e as Error).message}`);
    }
    await repoDe(P.dueno).guardarMotores(id, { responder: { principal: 'mistral-small-4', respaldo: null } }, { diarioUsd: 1, mensualUsd: 20 }, P.dueno);
    const m = await r.motoresDeBot(id);
    afirmar(m.map((x) => x.funcion).join(',') === 'interpretar,responder,copiloto' && m[1]?.principal === 'mistral-small-4' && m[1].respaldo === null, JSON.stringify(m));
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
