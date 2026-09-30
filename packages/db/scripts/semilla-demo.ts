/**
 * La semilla de demo para Supabase (3-semilla-demo.sql): los tres bots de ejemplo de la demo en memoria, con sus
 * versiones (y su material y casos), motores, condiciones, contactos, conversaciones y mensajes, los eventos de
 * analítica (con la historia inventada del bot publicado) y las llamadas a motores. Sale de las mismas funciones que
 * arman la demo (datos/demo/semilla*.ts): lo que se ve con Supabase es lo mismo que en la demo.
 *
 * - Va sobre la organización y la campaña de 2-semilla.sql (pruebas / pa-pruebas). Todo lo que en la demo hizo una
 *   persona inventada (Lucía, Andrés…) queda a nombre del Dueño: en Supabase las personas son cuentas de verdad.
 * - Se puede correr de nuevo: borra los bots de ejemplo (sus ids son fijos) y los vuelve a cargar.
 * - Las horas quedan corridas a la hora en que se corre: la historia siempre termina "hoy".
 * - Sin WhatsApp: el canal necesita una clave de 360dialog de verdad (en Vault). La conversación de Marta queda como
 *   conversación de WhatsApp, sin canal: la bandeja la muestra, pero no se le puede escribir.
 */
import { createHash } from 'node:crypto';
import { semillaDemo } from '../../modules/botmaker/datos/demo/semilla.ts';
import { semillaCanal } from '../../modules/botmaker/datos/demo/semilla-canal.ts';
import { historiaAnalitica } from '../../modules/botmaker/datos/demo/semilla-analitica.ts';

/** Un uuid fijo para cada id de la demo ("bot-demo-1" da siempre el mismo). */
export function uuidDemo(id: string): string {
  const h = createHash('sha1').update(`botmaker-demo:${id}`).digest('hex');
  const variante = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const hex64 = (t: string) => createHash('sha256').update(t).digest('hex');
const texto = (v: unknown): string => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? 'null' : String(v));
const bool = (v: boolean) => (v ? 'true' : 'false');
const jsonb = (v: unknown) => (v === null || v === undefined ? 'null' : `${texto(JSON.stringify(v))}::jsonb`);
const hora = (iso: string | null | undefined) => (iso ? `pg_temp.t(${texto(iso)})` : 'null');
const id = (x: string | null | undefined) => (x ? `'${uuidDemo(x)}'::uuid` : 'null');

/** Muchas filas en un insert, de a 400 (el SQL Editor de Supabase las toma sin problema). */
function insertar(tabla: string, columnas: string[], filas: string[][]): string {
  const bloques: string[] = [];
  for (let i = 0; i < filas.length; i += 400) {
    const trozo = filas.slice(i, i + 400).map((f) => `  (pg_temp.org(), pg_temp.campana(), ${f.join(', ')})`).join(',\n');
    bloques.push(`insert into ${tabla} (organization_id, campaign_id, ${columnas.join(', ')}) values\n${trozo};`);
  }
  return bloques.join('\n');
}

export interface OpcionesSemillaDemo {
  /** Cuándo se arma: las horas de la demo salen de acá. */
  ahora: Date;
  /** true (por defecto): las horas se corren a la hora en que se corre el SQL. false: quedan tal cual (pruebas). */
  relativo?: boolean;
}

export function sqlSemillaDemo(o: OpcionesSemillaDemo): string {
  const s = semillaDemo(o.ahora);
  const c = semillaCanal(o.ahora);
  const h = historiaAnalitica({
    ahora: o.ahora, publicadoDesde: c.publicadoDesde, botId: c.bot.id, campanaId: c.bot.campanaId, versionId: c.version.id, motores: c.motores,
    primerIdLlamada: s.llamadas.length + 1,
  });
  const bots = [...s.bots, c.bot];
  const versiones = [...s.versiones, c.version];
  const motores = new Map([...s.motores, [c.bot.id, c.motores] as const]);
  const persona = () => 'pg_temp.dueno()';
  const hayBot = (botId: string) => bots.some((b) => b.id === botId);

  const partes: string[] = [];
  partes.push(`-- BotMaker · semilla de demo para el proyecto de Supabase de desarrollo. Generado por \`pnpm db:sql --demo\`.
-- Los tres bots de ejemplo de la demo, con su material, conversaciones, condiciones, analítica y costos inventados
-- (datos de prueba: la candidata y todo lo que dice son inventados). Va DESPUÉS de 1-estructura.sql y 2-semilla.sql.
-- Se puede correr de nuevo: borra los bots de ejemplo y los vuelve a cargar, con las horas corridas a hoy.

begin;

create or replace function pg_temp.t(x text) returns timestamptz language sql stable as $$
  select x::timestamptz${o.relativo === false ? '' : ` + (now() - ${texto(o.ahora.toISOString())}::timestamptz)`}
$$;

create temp table demo on commit drop as
select c.organization_id as org, c.id as campana,
       (select m.profile_id from core.organization_members m where m.organization_id = c.organization_id and m.role = 'dueno' order by m.profile_id limit 1) as dueno
from core.campaigns c join core.organizations o on o.id = c.organization_id
where o.slug = 'pruebas' and c.slug = 'pa-pruebas';

create or replace function pg_temp.org() returns uuid language sql stable as $$ select org from demo $$;
create or replace function pg_temp.campana() returns uuid language sql stable as $$ select campana from demo $$;
create or replace function pg_temp.dueno() returns uuid language sql stable as $$ select dueno from demo $$;

do $$
begin
  if not exists (select 1 from demo where dueno is not null) then
    raise exception 'Falta la campaña pa-pruebas de la organización pruebas, con su Dueño: corré primero 2-semilla.sql.';
  end if;
end $$;

-- Lo de una corrida anterior se va con los bots (en cascada).
delete from bots.bots where id in (${bots.map((b) => id(b.id)).join(', ')});
`);

  partes.push('-- ── Bots, motores y versiones ──');
  partes.push(insertar('bots.bots', ['id', 'name', 'public_id', 'use_case', 'market', 'status', 'treatment', 'ai_notice_text', 'personalization', 'retention_days', 'daily_cap_usd', 'monthly_cap_usd', 'created_by', 'created_at', 'updated_at', 'archived_at'],
    bots.map((b) => [id(b.id), texto(b.nombre), texto(b.idPublico), texto(b.caso), texto(b.mercado), texto(b.estado), texto(b.trato), texto(b.avisoIa), bool(b.personalizacion),
      num(b.diasGuardado), num(b.topeDiarioUsd), num(b.topeMensualUsd), persona(), hora(b.creadoEn), hora(b.actualizadoEn), hora(b.archivadoEn)])));
  partes.push(insertar('bots.bot_engines', ['bot_id', 'function', 'primary_engine_id', 'fallback_engine_id', 'timeout_ms', 'double_read', 'updated_by'],
    [...motores].flatMap(([botId, ms]) => ms.map((m) => [id(botId), texto(m.funcion), texto(m.principal), texto(m.respaldo), num(m.tiempoMaximoMs), bool(m.dobleLectura), persona()]))));
  partes.push(insertar('bots.versions', ['id', 'bot_id', 'number', 'status', 'definition', 'based_on_id', 'seq', 'created_by', 'created_at', 'updated_at'],
    versiones.map((v) => [id(v.id), id(v.botId), num(v.numero), texto(v.estado), jsonb(v.definicion), id(v.basadaEn), num(v.seq), persona(), hora(v.creadaEn), hora(v.actualizadaEn)])));
  for (const b of bots.filter((x) => x.versionPublicadaId)) partes.push(`update bots.bots set published_version_id = ${id(b.versionPublicadaId)} where id = ${id(b.id)};`);
  partes.push(insertar('bots.publication_events', ['bot_id', 'version_id', 'action', 'note', 'profile_id', 'created_at'], [
    [id(c.bot.id), id(c.version.id), texto('pedido'), texto('Primera versión para la web'), persona(), hora(new Date(new Date(c.publicadoDesde).getTime() - 3600e3).toISOString())],
    [id(c.bot.id), id(c.version.id), texto('aprobado'), texto(''), persona(), hora(c.publicadoDesde)],
  ]));
  partes.push(insertar('bots.terms', ['bot_id', 'number', 'body', 'published_by', 'published_at'],
    c.condiciones.map((x) => [id(x.botId), num(x.numero), texto(x.texto), persona(), hora(x.publicadasEn)])));

  partes.push('-- ── Contactos, conversaciones y mensajes ──');
  partes.push(insertar('bots.contacts', ['id', 'bot_id', 'channel_kind', 'external_id_hash', 'name', 'data', 'terms_number', 'terms_accepted_at', 'verified_at', 'created_at', 'deleted_at', 'phone', 'profile_name'],
    c.contactos.map((x) => [id(x.id), id(x.botId), texto(x.canal), texto(hex64(x.hash)), texto(x.nombre), jsonb(x.datos), num(x.condicionesVersion), hora(x.condicionesAceptadasEn), hora(x.verificadoEn),
      hora(x.creadoEn), hora(x.borradoEn), texto(x.telefono ?? null), texto(x.nombrePerfil ?? null)])));
  partes.push(insertar('bots.sessions', ['id', 'bot_id', 'contact_id', 'channel_kind', 'version_id', 'state', 'engine_state', 'current_box', 'assigned_to', 'handoff_at', 'handoff_reason', 'handoff_box',
    'last_contact_at', 'last_team_at', 'verified', 'seq', 'started_at', 'updated_at', 'window_expires_at'],
  c.conversaciones.map((x) => [id(x.id), id(x.botId), id(x.contactoId), texto(x.canal), id(x.versionId), texto(x.estado), jsonb(x.sesion), texto(x.cajaActual), x.asignadaA ? persona() : 'null',
    hora(x.derivadaEn), texto(x.motivoDerivacion), texto(x.cajaDerivacion), hora(x.ultimoDelContacto), hora(x.ultimoDelEquipo), bool(x.verificada), num(x.seq), hora(x.iniciadaEn), hora(x.actualizadaEn),
    hora(x.ventanaHasta ?? null)])));
  partes.push(insertar('bots.messages', ['session_id', 'n', 'author', 'profile_id', 'kind', 'text', 'payload', 'box_id', 'decision', 'version_id', 'channel_message_id', 'sampled', 'created_at'],
    [...c.mensajes.values()].flat().map((m) => [id(m.conversacionId), num(m.n), texto(m.autor), m.personaId ? persona() : 'null', texto(m.tipo), texto(m.texto), jsonb(m.datos), texto(m.cajaId), jsonb(m.decision),
      id(m.versionId), texto(m.idCanal), bool(m.muestra), hora(m.creadoEn)])));

  partes.push('-- ── Analítica: los eventos de esas conversaciones y la historia inventada del bot publicado (sin conversaciones) ──');
  const conversaciones = new Set(c.conversaciones.map((x) => x.id));
  partes.push(insertar('bots.events', ['bot_id', 'version_id', 'channel_kind', 'session_id', 'contact_hash', 'name', 'box_id', 'data', 'occurred_at'],
    [...c.analitica, ...h.eventos].map((e) => [id(e.botId), id(e.versionId), texto(e.canal), conversaciones.has(e.conversacionId) ? id(e.conversacionId) : 'null', texto(hex64(e.contactoHash)), texto(e.nombre),
      texto(e.cajaId), jsonb(e.datos), hora(e.fecha)])));

  partes.push('-- ── Llamadas a motores (el gasto por día lo suma el disparador) ──');
  partes.push(insertar('bots.engine_calls', ['bot_id', 'use', 'function', 'engine_id', 'model', 'provider', 'is_fallback', 'ok', 'error', 'latency_ms', 'tokens_in', 'tokens_out', 'tokens_cached', 'tokens_reasoning', 'cost_usd', 'generation_id', 'profile_id', 'created_at'],
    [...s.llamadas, ...h.llamadas].filter((l) => hayBot(l.botId)).map((l) => [id(l.botId), texto(l.uso), texto(l.funcion), texto(l.motorId), texto(l.modelo), texto(l.proveedor), bool(l.respaldo), bool(l.ok), texto(l.error),
      num(l.demoraMs), num(l.tokensEntrada), num(l.tokensSalida), num(l.tokensCache), num(l.tokensRazonamiento), num(l.costoUsd), texto(l.idGeneracion), l.personaId ? persona() : 'null', hora(l.fecha)])));

  partes.push(`
-- La analítica suma lo nuevo: la tarea de fondo también lo hace cada 10 minutos.
select bots.tarea_agregar_analitica(now() + interval '2 minutes');

select b.name as bot, b.status as estado, (select count(*) from bots.sessions s where s.bot_id = b.id) as conversaciones
from bots.bots b where b.id in (${bots.map((b) => id(b.id)).join(', ')}) order by b.created_at;

commit;
`);
  return partes.join('\n\n');
}
