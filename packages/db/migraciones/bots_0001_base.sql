-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- bots_0001_base.sql — BotMaker, etapa 1: el esquema `bots` con lo que necesita la base del producto.
--
--  · El producto en el catálogo de la plataforma (core.products), espejo de PRODUCTOS en platform/src/catalogo.ts.
--  · La matriz de permisos (espejo de MATRIZ en packages/modules/botmaker/dominio/permisos.ts; `pnpm db:probar`
--    controla que coincidan) y las funciones que la aplican: bots.puede y bots.campanas_donde_puede.
--  · Lo de BotMaker en cada campaña (bots.campaign_settings), los bots, la ficha de los motores (bots.engines), el motor
--    por defecto de cada función (bots.engine_defaults), el motor de cada función en cada bot (bots.bot_engines), cada
--    llamada a un motor (bots.engine_calls) y el gasto por día (bots.spend_daily).
--  · Las funciones con que el equipo cambia algo: crear_bot, guardar_bot, guardar_motores, guardar_datos_personales,
--    archivar y asignar_rol. Cada una vuelve a exigir su acción de la matriz y las que importan quedan en
--    core.audit_log con product_id = 'botmaker'.
--
-- Reglas de este esquema (las mismas que aipos en CampaignSuite):
--  1. Cada tabla con datos de un cliente lleva organization_id y campaign_id; un disparador completa organization_id
--     desde la campaña y la clave foránea compuesta (campaign_id, organization_id) → bots.campaign_settings impide
--     cruzar organizaciones. Toda referencia entre tablas de BotMaker incluye campaign_id.
--  2. El rol sale siempre de core.rol_en_campana(campaña, 'botmaker', persona). BotMaker no guarda roles propios.
--  3. Leer: reglas por fila con bots.campanas_donde_puede('<acción>'). Escribir: solo por funciones que exigen la
--     acción (la persona no tiene insert ni update directo sobre ninguna tabla).
--  4. engine_calls solo se agrega. Horas en timestamptz (UTC). Dinero en numeric(12,6), en USD.
--
-- Al mudarse a CampaignSuite este archivo pasa a ser su migración siguiente, sin cambios, y core.habilitar_producto
-- llama a bots.preparar_campana como llama a aipos.preparar_campana.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists bots;
comment on schema bots is 'Producto BotMaker: asistentes conversacionales de la campaña.';
grant usage on schema bots to authenticated, service_role;

-- ── El producto en el catálogo de la plataforma ─────────────────────────────────────────────────

insert into core.products (id, name, description, layer, valid_roles, route, sort_order)
values ('botmaker', 'BotMaker', 'Asistentes conversacionales de la campaña para responder a los ciudadanos en la web y en WhatsApp.',
        'Mensajería', array['administrador', 'editor', 'agente', 'lector'], 'bots', 2)
on conflict (id) do update
  set name = excluded.name, description = excluded.description, layer = excluded.layer,
      valid_roles = excluded.valid_roles, route = excluded.route;

-- ── Matriz de permisos ──────────────────────────────────────────────────────────────────────────
-- 'observador' es quien mira una organización demo: ve todo lo que ve un administrador y no cambia nada.

create or replace function bots.matriz_permisos() returns table (accion text, rol text)
language sql immutable set search_path = '' as $$
  select m.a, unnest(m.r)
  from (values
    ('ver',                       array['administrador', 'editor', 'agente', 'lector', 'observador']),
    ('editar_borrador',           array['administrador', 'editor']),
    ('correr_pruebas',            array['administrador', 'editor']),
    ('pedir_publicacion',         array['administrador', 'editor']),
    ('publicar',                  array['administrador']),
    ('configurar_canales',        array['administrador']),
    ('elegir_motores',            array['administrador']),
    ('leer_conversaciones',       array['administrador', 'editor', 'agente', 'observador']),
    ('responder_conversaciones',  array['administrador', 'agente']),
    ('gestionar_datos_contactos', array['administrador']),
    ('ver_costos',                array['administrador', 'observador']),
    ('gestionar_equipo',          array['administrador'])
  ) as m(a, r)
$$;
comment on function bots.matriz_permisos() is 'Qué rol puede cada acción de BotMaker. Espejo de MATRIZ (dominio/permisos.ts); pnpm db:probar compara las dos.';

-- ¿El rol permite la acción? Una acción desconocida es un error: una regla mal escrita falla, no deniega en silencio.
create or replace function bots.rol_permite(rol text, accion text) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if not exists (select 1 from bots.matriz_permisos() m where m.accion = rol_permite.accion) then
    raise exception 'Acción desconocida: %', accion using errcode = '22023';
  end if;
  if rol is null then
    return false;
  end if;
  return exists (select 1 from bots.matriz_permisos() m where m.accion = rol_permite.accion and m.rol = rol_permite.rol);
end $$;

-- El rol de una persona en BotMaker en una campaña: el de la plataforma, con su cascada, sin reglas propias.
create or replace function bots.rol_efectivo(campana uuid, persona uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  return core.rol_en_campana(campana, 'botmaker', persona);
end $$;
revoke execute on function bots.rol_efectivo(uuid, uuid) from public;

-- ¿La persona de la sesión puede la acción en la campaña?
create or replace function bots.puede(campana uuid, accion text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return bots.rol_permite(bots.rol_efectivo(campana, auth.uid()), accion);
end $$;

-- Las campañas donde la persona de la sesión puede la acción (se usa en las reglas por fila).
create or replace function bots.campanas_donde_puede(accion text) returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  perform bots.rol_permite(null, accion);  -- valida el nombre de la acción
  -- Se parte de las organizaciones de la persona (miembro activo o, en las demos, Administrador de CampaignSuite): sin
  -- eso no tiene rol en ninguna campaña, y así no se recorren las campañas de toda la plataforma.
  return query
    select s.id
    from bots.campaign_settings s
    where s.organization_id in (
        select m.organization_id from core.organization_members m where m.profile_id = auth.uid() and m.status = 'activo'
        union
        select o.id from core.organizations o where o.is_demo and core.es_admin_producto()
      )
      and bots.rol_permite(bots.rol_efectivo(s.id, auth.uid()), accion);
end $$;

-- Exige la acción o corta con el mensaje de la pantalla. errcode 42501 = sin permiso.
create or replace function bots.exigir(campana uuid, accion text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if campana is null then
    raise exception 'No existe el bot o la campaña.' using errcode = 'P0002';
  end if;
  if not bots.puede(campana, accion) then
    raise exception 'Tu rol no permite esta acción (%).', accion using errcode = '42501';
  end if;
end $$;
revoke execute on function bots.exigir(uuid, text) from public;

-- Actividad común de la plataforma: lo que hace el equipo, nunca textos de conversaciones ni datos de contactos.
create or replace function bots.anotar(org uuid, accion text, objeto text, detalle jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.audit_log (profile_id, organization_id, product_id, action, object, detail)
  values (auth.uid(), org, 'botmaker', accion, coalesce(objeto, ''), detalle);
end $$;
revoke execute on function bots.anotar(uuid, text, text, jsonb) from public;

create or replace function bots.solo_agregar() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Esta tabla solo admite agregar filas.' using errcode = '42501';
end $$;

-- ── Lo de BotMaker en cada campaña ──────────────────────────────────────────────────────────────

create table bots.campaign_settings (
  id              uuid primary key,
  organization_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (id, organization_id) references core.campaigns (id, organization_id) on delete cascade
);
create index campaign_settings_organizacion on bots.campaign_settings (organization_id);
comment on table bots.campaign_settings is 'Lo de BotMaker en cada campaña (id = core.campaigns.id). Existe desde que el producto se habilita en la campaña.';

create or replace function bots.completar_organizacion_ajustes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.organization_id := (select c.organization_id from core.campaigns c where c.id = new.id);
  return new;
end $$;
create trigger campaign_settings_organizacion before insert or update of id, organization_id on bots.campaign_settings
  for each row execute function bots.completar_organizacion_ajustes();
create trigger campaign_settings_actualizado before update on bots.campaign_settings
  for each row execute function core.tocar_actualizado();

-- Se llama al habilitar el producto en una campaña (en CampaignSuite, desde core.habilitar_producto). Idempotente.
create or replace function bots.preparar_campana(campana uuid, datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into bots.campaign_settings (id) values (campana) on conflict (id) do nothing;
end $$;
revoke execute on function bots.preparar_campana(uuid, jsonb) from public;

-- ── Motores: la ficha de cada uno y el de cada función por defecto ──────────────────────────────
-- Es global (no de una campaña): la mantiene el equipo de BotMaker con migraciones. Espejo de FICHAS_MOTORES y
-- MOTORES_POR_DEFECTO (dominio/motores.ts); pnpm db:probar compara las dos.

create table bots.engines (
  id                     text primary key check (id ~ '^[a-z0-9][a-z0-9.\-]*$'),
  name                   text not null,
  company                text not null,
  route                  text not null check (route in ('openrouter', 'simulado')),
  model                  text not null,
  provider_prefs         jsonb not null default '{}',
  reasoning              jsonb,
  no_temperature         boolean not null default false,
  cache                  boolean not null default false,
  price_in_usd_mtok      numeric(10, 4) not null default 0,
  price_out_usd_mtok     numeric(10, 4) not null default 0,
  price_cache_usd_mtok   numeric(10, 4),
  strict_json            boolean not null default false,
  allows_electoral       text not null check (allows_electoral in ('si', 'con_condiciones', 'no')),
  allows_political       text not null check (allows_political in ('si', 'con_condiciones', 'no')),
  requires_ai_notice     boolean not null default false,
  allows_personalization boolean not null default true,
  trains_on_data         boolean not null default false,
  retention              text not null default '',
  region                 text not null default '',
  conditions             text not null default '',
  functions              text[] not null default '{}',
  active                 boolean not null default true,
  updated_at             timestamptz not null default now()
);
comment on table bots.engines is 'Ficha de cada motor de IA: acceso, precios (USD por millón de tokens) y condiciones de uso. El creador la usa para avisar, nunca para bloquear.';

create table bots.engine_defaults (
  function           text primary key check (function in ('interpretar', 'responder', 'copiloto')),
  primary_engine_id  text not null references bots.engines (id),
  fallback_engine_id text references bots.engines (id),
  timeout_ms         integer not null check (timeout_ms between 500 and 120000),
  updated_at         timestamptz not null default now(),
  check (fallback_engine_id is distinct from primary_engine_id)
);
comment on table bots.engine_defaults is 'El motor principal y de respaldo de cada función para los bots nuevos. Cambiar de motor es cambiar esta tabla, no el código.';

insert into bots.engines (id, name, company, route, model, provider_prefs, reasoning, no_temperature, cache,
                          price_in_usd_mtok, price_out_usd_mtok, price_cache_usd_mtok, strict_json,
                          allows_electoral, allows_political, requires_ai_notice, allows_personalization, trains_on_data,
                          retention, region, conditions, functions) values
  ('simulado', 'Motor simulado', 'BotMaker', 'simulado', 'simulado', '{}', null, false, false,
   0, 0, null, true, 'si', 'si', false, true, false,
   'No sale de la app', 'Local', 'Responde por reglas, sin costo. Para la demo, las pruebas y el simulador en desarrollo.',
   '{interpretar,responder,copiloto}'),
  ('gpt-oss-20b', 'gpt-oss-20b (Groq)', 'OpenAI (pesos abiertos) en Groq', 'openrouter', 'openai/gpt-oss-20b',
   '{"only": ["groq"], "allow_fallbacks": false}', '{"effort": "low"}', false, false,
   0.075, 0.30, null, true, 'si', 'si', false, true, false,
   'Groq no guarda por defecto (hasta 30 días para detectar abuso)', 'EE.UU.',
   'Licencia Apache 2.0 y política de Groq, sin cláusula electoral. La prohibición de campañas de OpenAI es de sus servicios; no se encontró que alcance a gpt-oss.',
   '{interpretar}'),
  ('gpt-oss-120b', 'gpt-oss-120b (Groq)', 'OpenAI (pesos abiertos) en Groq', 'openrouter', 'openai/gpt-oss-120b',
   '{"only": ["groq"], "allow_fallbacks": false}', '{"effort": "low"}', false, false,
   0.15, 0.60, null, true, 'si', 'si', false, true, false,
   'Groq no guarda por defecto (hasta 30 días para detectar abuso)', 'EE.UU.',
   'Licencia Apache 2.0 y política de Groq, sin cláusula electoral. La prohibición de campañas de OpenAI es de sus servicios; no se encontró que alcance a gpt-oss.',
   '{interpretar,responder,copiloto}'),
  ('mistral-small-4', 'Mistral Small 4', 'Mistral', 'openrouter', 'mistralai/mistral-small-2603',
   '{}', null, false, false,
   0.15, 0.60, 0.015, true, 'si', 'si', false, true, true,
   'Entrena por defecto: se apaga en el panel de Mistral', 'UE',
   'Sin cláusula de campañas; prohíbe la desinformación que afecte procesos cívicos o políticos.',
   '{interpretar,responder}'),
  ('ministral-8b', 'Ministral 3 8B', 'Mistral', 'openrouter', 'mistralai/ministral-8b-2512',
   '{}', null, false, false,
   0.15, 0.15, 0.015, false, 'si', 'si', false, true, true,
   'Entrena por defecto: se apaga en el panel de Mistral', 'UE',
   'Sin cláusula de campañas; prohíbe la desinformación que afecte procesos cívicos o políticos.',
   '{interpretar}'),
  ('claude-haiku-4.5', 'Claude Haiku 4.5', 'Anthropic', 'openrouter', 'anthropic/claude-haiku-4.5',
   '{"only": ["anthropic"]}', null, false, true,
   1, 5, 0.10, true, 'con_condiciones', 'con_condiciones', true, false, false,
   'No entrena; borra a los 30 días', 'EE.UU.',
   'Permite bots de campaña si avisan que son IA al empezar cada conversación y no segmentan por el perfil de cada persona.',
   '{interpretar,responder}'),
  ('claude-sonnet-5', 'Claude Sonnet 5', 'Anthropic', 'openrouter', 'anthropic/claude-sonnet-5',
   '{"only": ["anthropic"]}', null, true, true,
   2, 10, 0.20, true, 'con_condiciones', 'con_condiciones', true, false, false,
   'No entrena; borra a los 30 días', 'EE.UU.',
   'Permite bots de campaña si avisan que son IA al empezar cada conversación y no segmentan por el perfil de cada persona.',
   '{interpretar,responder,copiloto}'),
  ('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite', 'Google', 'openrouter', 'google/gemini-3.1-flash-lite',
   '{"order": ["google-ai-studio", "google-vertex/global"], "allow_fallbacks": false}', '{"effort": "minimal"}', true, false,
   0.25, 1.50, 0.025, true, 'si', 'si', false, true, false,
   'Plan pago: no entrena; guarda 55 días', 'Global',
   'Sin cláusula electoral. Sus condiciones no admiten servicios a los que probablemente entren menores de 18 años: a aclarar antes de elegirlo.',
   '{interpretar,responder}');

-- Provisorios hasta cerrar la prueba de motores (plan técnico, etapa 1).
insert into bots.engine_defaults (function, primary_engine_id, fallback_engine_id, timeout_ms) values
  ('interpretar', 'gpt-oss-120b', 'claude-haiku-4.5', 2500),
  ('responder', 'gpt-oss-120b', 'claude-haiku-4.5', 4000),
  ('copiloto', 'claude-sonnet-5', 'gpt-oss-120b', 60000);

-- ── Bots ────────────────────────────────────────────────────────────────────────────────────────

create table bots.bots (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  campaign_id          uuid not null,
  name                 text not null check (length(trim(name)) between 1 and 80),
  public_id            text not null unique check (public_id ~ '^[a-z0-9]{10}$'),
  use_case             text not null check (use_case in ('electoral', 'politico')),
  market               text not null check (market ~ '^[A-Z]{2}$'),
  status               text not null default 'borrador' check (status in ('borrador', 'publicado', 'pausado', 'archivado')),
  published_version_id uuid,
  treatment            text not null default 'usted' check (treatment in ('usted', 'tu')),
  ai_notice_text       text not null default '' check (length(ai_notice_text) <= 300),
  personalization      boolean not null default false,
  retention_days       integer not null default 90 check (retention_days between 1 and 365),
  daily_cap_usd        numeric(12, 6) not null default 5 check (daily_cap_usd <> 'NaN' and daily_cap_usd between 0 and 100000),
  monthly_cap_usd      numeric(12, 6) not null default 100 check (monthly_cap_usd <> 'NaN' and monthly_cap_usd between 0 and 999999),
  request_key          uuid unique,
  created_by           uuid references core.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  unique (id, campaign_id),
  check (daily_cap_usd <= monthly_cap_usd),
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.bots is 'Cada bot de la campaña: caso (electoral o político), mercado, estado, versión publicada y ajustes.';
comment on column bots.bots.public_id is 'Id corto para la dirección pública del bot (landing y widget). No cambia.';
comment on column bots.bots.request_key is 'Clave idempotente del formulario que lo creó: un doble envío no crea dos bots.';
create index bots_campana on bots.bots (campaign_id, created_at desc);

create trigger bots_organizacion before insert or update of campaign_id, organization_id on bots.bots
  for each row execute function core.completar_organizacion_campana();
create trigger bots_actualizado before update on bots.bots
  for each row execute function core.tocar_actualizado();

create table bots.bot_engines (
  organization_id    uuid not null,
  campaign_id        uuid not null,
  bot_id             uuid not null,
  function           text not null check (function in ('interpretar', 'responder', 'copiloto')),
  primary_engine_id  text not null references bots.engines (id),
  fallback_engine_id text references bots.engines (id),
  timeout_ms         integer not null check (timeout_ms between 500 and 120000),
  updated_by         uuid references core.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  primary key (bot_id, function),
  check (fallback_engine_id is distinct from primary_engine_id),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.bot_engines is 'El motor principal y de respaldo de cada función en cada bot. Al crear el bot se copia de engine_defaults.';

create trigger bot_engines_organizacion before insert or update of campaign_id, organization_id on bots.bot_engines
  for each row execute function core.completar_organizacion_campana();

-- ── Llamadas a motores y gasto ──────────────────────────────────────────────────────────────────

create table bots.engine_calls (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  campaign_id      uuid not null,
  bot_id           uuid not null,
  use              text not null check (use in ('en_vivo', 'copiloto', 'fondo', 'simulador', 'pruebas')),
  function         text not null check (function in ('interpretar', 'responder', 'copiloto')),
  engine_id        text not null references bots.engines (id),
  model            text not null default '',
  provider         text not null default '',
  is_fallback      boolean not null default false,
  ok               boolean not null,
  error            text check (length(error) <= 300),
  latency_ms       integer check (latency_ms >= 0),
  tokens_in        integer check (tokens_in >= 0),
  tokens_out       integer check (tokens_out >= 0),
  tokens_cached    integer check (tokens_cached >= 0),
  tokens_reasoning integer check (tokens_reasoning >= 0),
  cost_usd         numeric(12, 6) not null default 0 check (cost_usd >= 0),
  generation_id    text,
  profile_id       uuid references core.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.engine_calls is 'Cada intento de llamada a un motor, con su costo. Sin textos: ni el mensaje ni la respuesta. Solo se agrega.';
create index engine_calls_bot on bots.engine_calls (bot_id, created_at desc);
create index engine_calls_campana on bots.engine_calls (campaign_id, created_at desc);

create trigger engine_calls_organizacion before insert on bots.engine_calls
  for each row execute function core.completar_organizacion_campana();
-- Nadie la cambia. Los borrados no se traban con un disparador: los hace solo la cascada de un bot, una campaña o una
-- organización que se borra (la clave de servicio no tiene delete; ver Permisos, al final).
create trigger engine_calls_solo_agregar before update on bots.engine_calls
  for each row execute function bots.solo_agregar();

create table bots.spend_daily (
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  day             date not null,
  use             text not null check (use in ('en_vivo', 'copiloto', 'fondo', 'simulador', 'pruebas')),
  cost_usd        numeric(12, 6) not null default 0,
  calls           integer not null default 0,
  primary key (bot_id, day, use),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.spend_daily is 'Gasto por bot, día (UTC) y uso. Lo suma un disparador de engine_calls; sirve para controlar los topes sin sumar todas las llamadas.';

create or replace function bots.sumar_gasto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into bots.spend_daily (organization_id, campaign_id, bot_id, day, use, cost_usd, calls)
  values (new.organization_id, new.campaign_id, new.bot_id, (new.created_at at time zone 'UTC')::date, new.use, new.cost_usd, 1)
  on conflict (bot_id, day, use) do update
    set cost_usd = bots.spend_daily.cost_usd + excluded.cost_usd, calls = bots.spend_daily.calls + 1;
  return new;
end $$;
create trigger engine_calls_gasto after insert on bots.engine_calls
  for each row execute function bots.sumar_gasto();

-- ── Funciones con que el equipo cambia algo ─────────────────────────────────────────────────────

-- Un id corto para la dirección pública: 10 letras y números sin los que se confunden (0, o, 1, l).
create or replace function bots.nuevo_id_publico() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alfabeto constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  candidato text;
begin
  loop
    select string_agg(substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1), '')
      into candidato from generate_series(1, 10);
    exit when not exists (select 1 from bots.bots b where b.public_id = candidato);
  end loop;
  return candidato;
end $$;
revoke execute on function bots.nuevo_id_publico() from public;

-- Crea un bot en borrador y le copia los motores por defecto. `clave` es la del formulario: con la misma clave devuelve
-- el bot que ya creó. datos: { nombre, caso: electoral|politico, mercado: PA|UY|…, trato: usted|tu }.
create or replace function bots.crear_bot(campana uuid, datos jsonb, clave uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existente uuid;
  nuevo uuid;
  org uuid;
begin
  perform bots.exigir(campana, 'editar_borrador');
  if clave is not null then
    select b.id into existente from bots.bots b where b.request_key = clave;
    if existente is not null then
      if not exists (select 1 from bots.bots b where b.id = existente and b.campaign_id = campana) then
        raise exception 'La clave del formulario es de otra campaña.' using errcode = '23505';
      end if;
      return existente;
    end if;
  end if;
  if not exists (select 1 from bots.campaign_settings s where s.id = campana) then
    raise exception 'BotMaker no está preparado en esta campaña.' using errcode = 'P0002';
  end if;
  insert into bots.bots (campaign_id, name, public_id, use_case, market, treatment, request_key, created_by, personalization)
  values (
    campana,
    trim(datos ->> 'nombre'),
    bots.nuevo_id_publico(),
    datos ->> 'caso',
    upper(datos ->> 'mercado'),
    coalesce(nullif(datos ->> 'trato', ''), 'usted'),
    clave,
    auth.uid(),
    false
  )
  on conflict (request_key) do nothing
  returning id, organization_id into nuevo, org;
  if nuevo is null then
    -- Otro envío con la misma clave llegó primero: se devuelve ese bot (si es de esta campaña).
    select b.id into existente from bots.bots b where b.request_key = clave and b.campaign_id = campana;
    if existente is null then
      raise exception 'La clave del formulario es de otra campaña.' using errcode = '23505';
    end if;
    return existente;
  end if;
  insert into bots.bot_engines (campaign_id, bot_id, function, primary_engine_id, fallback_engine_id, timeout_ms, updated_by)
  select campana, nuevo, d.function, d.primary_engine_id, d.fallback_engine_id, d.timeout_ms, auth.uid()
  from bots.engine_defaults d;
  perform bots.anotar(org, 'bots.crear', trim(datos ->> 'nombre'), jsonb_build_object('bot', nuevo));
  return nuevo;
end $$;

-- Datos generales del bot (editor y administrador). Cambia solo lo que viene en `datos`.
-- datos: { nombre?, caso?, mercado?, trato?, avisoIa? }.
create or replace function bots.guardar_bot(bot uuid, datos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'editar_borrador');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  update bots.bots set
    name = case when datos ? 'nombre' then trim(datos ->> 'nombre') else name end,
    use_case = case when datos ? 'caso' then datos ->> 'caso' else use_case end,
    market = case when datos ? 'mercado' then upper(datos ->> 'mercado') else market end,
    treatment = case when datos ? 'trato' then datos ->> 'trato' else treatment end,
    ai_notice_text = case when datos ? 'avisoIa' then coalesce(datos ->> 'avisoIa', '') else ai_notice_text end
  where id = bot;
end $$;

-- Motores por función y topes de gasto (administrador). motores: { interpretar: { principal, respaldo }, … };
-- topes: { diario, mensual } en USD. Lo que no viene, no cambia.
create or replace function bots.guardar_motores(bot uuid, motores jsonb, topes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  f text;
  m jsonb;
  principal text;
  respaldo text;
  hecho jsonb := '{}';
  diario numeric;
  mensual numeric;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'elegir_motores');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  for f, m in select * from jsonb_each(coalesce(motores, '{}')) loop
    if f not in ('interpretar', 'responder', 'copiloto') then
      raise exception 'Función desconocida: %', f using errcode = '22023';
    end if;
    principal := m ->> 'principal';
    respaldo := nullif(m ->> 'respaldo', '');
    if not exists (select 1 from bots.engines e where e.id = principal and e.active) then
      raise exception 'Motor desconocido o apagado: %', principal using errcode = '22023';
    end if;
    if respaldo is not null and not exists (select 1 from bots.engines e where e.id = respaldo and e.active) then
      raise exception 'Motor desconocido o apagado: %', respaldo using errcode = '22023';
    end if;
    if not exists (select 1 from bots.engines e where e.id = principal and f = any (e.functions))
       or (respaldo is not null and not exists (select 1 from bots.engines e where e.id = respaldo and f = any (e.functions))) then
      raise exception 'El motor no sirve para la función %.', f using errcode = '22023';
    end if;
    if respaldo = principal then
      raise exception 'El respaldo tiene que ser otro motor.' using errcode = '23514';
    end if;
    update bots.bot_engines set primary_engine_id = principal, fallback_engine_id = respaldo, updated_by = auth.uid(), updated_at = now()
    where bot_id = bot and function = f;
    hecho := hecho || jsonb_build_object(f, jsonb_build_object('principal', principal, 'respaldo', respaldo));
  end loop;
  if topes is not null and topes <> '{}'::jsonb then
    diario := coalesce((topes ->> 'diario')::numeric, b.daily_cap_usd);
    mensual := coalesce((topes ->> 'mensual')::numeric, b.monthly_cap_usd);
    update bots.bots set daily_cap_usd = diario, monthly_cap_usd = mensual where id = bot;
    perform bots.anotar(b.organization_id, 'bots.topes_cambiados', b.name, jsonb_build_object('diario', diario, 'mensual', mensual));
  end if;
  if hecho <> '{}'::jsonb then
    perform bots.anotar(b.organization_id, 'bots.motores_cambiados', b.name, hecho);
  end if;
end $$;

-- Personalización y días de guardado de las conversaciones (administrador).
create or replace function bots.guardar_datos_personales(bot uuid, personalizacion boolean, dias integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'gestionar_datos_contactos');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  update bots.bots set
    personalization = coalesce(personalizacion, personalization),
    retention_days = coalesce(dias, retention_days)
  where id = bot;
  perform bots.anotar(b.organization_id, 'bots.datos_personales_cambiados', b.name,
    jsonb_build_object('personalizacion', coalesce(personalizacion, b.personalization), 'dias', coalesce(dias, b.retention_days)));
end $$;

-- Archivar un bot (administrador): deja de aparecer en la lista y no se puede cambiar. Sus datos quedan.
create or replace function bots.archivar(bot uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'publicar');
  if b.status = 'archivado' then
    return;
  end if;
  update bots.bots set status = 'archivado', archived_at = now() where id = bot;
  perform bots.anotar(b.organization_id, 'bots.archivar', b.name, jsonb_build_object('bot', bot));
end $$;

-- El rol de un integrante de la campaña en BotMaker (administrador): lo guarda la plataforma (core.asignar_acceso,
-- que vuelve a exigir el permiso) y queda en la actividad. rol null = sin acceso.
create or replace function bots.asignar_rol(campana uuid, persona uuid, rol text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
begin
  perform bots.exigir(campana, 'gestionar_equipo');
  perform core.asignar_acceso(campana, 'botmaker', persona, nullif(rol, ''), auth.uid());
  select c.organization_id into org from core.campaigns c where c.id = campana;
  perform bots.anotar(org, 'bots.rol_asignado', coalesce(nullif(rol, ''), 'sin acceso'), jsonb_build_object('persona', persona));
end $$;

-- ── Reglas por fila ─────────────────────────────────────────────────────────────────────────────

alter table bots.campaign_settings enable row level security;
alter table bots.engines enable row level security;
alter table bots.engine_defaults enable row level security;
alter table bots.bots enable row level security;
alter table bots.bot_engines enable row level security;
alter table bots.engine_calls enable row level security;
alter table bots.spend_daily enable row level security;

create policy "ajustes: los ve quien entra al producto" on bots.campaign_settings for select to authenticated
  using (id in (select bots.campanas_donde_puede('ver')));
create policy "motores: la ficha la ve cualquier persona con sesión" on bots.engines for select to authenticated
  using (true);
create policy "motores por defecto: los ve cualquier persona con sesión" on bots.engine_defaults for select to authenticated
  using (true);
create policy "bots: los ve quien entra al producto" on bots.bots for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "motores del bot: los ve quien entra al producto" on bots.bot_engines for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "llamadas: las ve quien ve los costos" on bots.engine_calls for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver_costos')));
create policy "gasto: lo ve quien ve los costos" on bots.spend_daily for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver_costos')));

-- ── Permisos ────────────────────────────────────────────────────────────────────────────────────
-- La persona solo lee (con las reglas por fila) y cambia por funciones. La clave de servicio (el servidor) registra
-- las llamadas a motores.

grant select on all tables in schema bots to authenticated;
grant all on all tables in schema bots to service_role;
grant usage, select on all sequences in schema bots to service_role;
revoke update, delete, truncate on bots.engine_calls from service_role;
revoke execute on all functions in schema bots from public;
grant execute on function bots.matriz_permisos() to authenticated, service_role;
grant execute on function bots.rol_permite(text, text) to authenticated, service_role;
grant execute on function bots.puede(uuid, text) to authenticated, service_role;
grant execute on function bots.campanas_donde_puede(text) to authenticated, service_role;
grant execute on function bots.crear_bot(uuid, jsonb, uuid) to authenticated;
grant execute on function bots.guardar_bot(uuid, jsonb) to authenticated;
grant execute on function bots.guardar_motores(uuid, jsonb, jsonb) to authenticated;
grant execute on function bots.guardar_datos_personales(uuid, boolean, integer) to authenticated;
grant execute on function bots.archivar(uuid) to authenticated;
grant execute on function bots.asignar_rol(uuid, uuid, text) to authenticated;
grant execute on function bots.preparar_campana(uuid, jsonb) to service_role;

commit;
