-- BotMaker · 0010 · Analítica (plan técnico, etapa 8: tarea 8.01).
--
--  - bots.stats_hourly: los eventos sumados por bot, canal, versión, hora, métrica, caja y clave (la letra de la opción,
--    la intención, el tema…). La llena bots.tarea_agregar_analitica, de a tramos: la pantalla no recorre los eventos.
--  - bots.session_outcomes: cómo terminó cada conversación (resuelta, derivada o sin resolver), la última caja que mostró
--    el bot y el recorrido de sus primeras cajas. Se calcula a los 30 minutos sin movimiento y se vuelve a calcular si la
--    conversación sigue.
--  - bots.metricas_evento y bots.cierre_conversacion son el mismo cálculo que metricasDeEvento y cierreDeConversacion
--    (packages/modules/botmaker/dominio/analitica.ts), que usa la demo; `pnpm db:probar` controla que den lo mismo.
--  - bots.analitica: lo que lee la pantalla (quien ve el bot); el costo en vivo, solo quien ve costos.
--
-- Resuelta (decisión del 29/9): una respuesta con base completa sin derivar, una conversación que atendió una persona o
-- un cierre de cortesía. Nada de esto tiene textos de personas.

begin;

create table bots.stats_hourly (
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  channel_kind    text not null check (channel_kind in ('web', 'landing', 'whatsapp')),
  version_id      uuid,
  hour            timestamptz not null,
  metric          text not null check (metric in (
    'conversacion', 'caja', 'opcion', 'texto', 'intencion', 'tema', 'respuesta', 'derivada', 'sin_motor', 'aclaracion', 'dato', 'solo_menus', 'baja',
    'tramite', 'condiciones'
  )),
  box_id          text not null default '' check (length(box_id) <= 40),
  key             text not null default '' check (length(key) <= 80),
  n               integer not null check (n >= 0),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.stats_hourly is 'Analítica: los eventos sumados por bot, canal, versión y hora (UTC). La llena bots.tarea_agregar_analitica. Sin textos.';
create unique index stats_hourly_clave on bots.stats_hourly
  (bot_id, channel_kind, coalesce(version_id, '00000000-0000-0000-0000-000000000000'::uuid), hour, metric, box_id, key);
create index stats_hourly_campana on bots.stats_hourly (campaign_id, hour);

create table bots.session_outcomes (
  session_id      uuid primary key references bots.sessions (id) on delete cascade,
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  channel_kind    text not null check (channel_kind in ('web', 'landing', 'whatsapp')),
  version_id      uuid,
  started_at      timestamptz not null,
  result          text not null check (result in ('resuelta', 'derivada', 'sin_resolver')),
  last_box        text not null default '' check (length(last_box) <= 40),
  path            text not null default '' check (length(path) <= 200),
  activity_at     timestamptz not null,
  computed_at     timestamptz not null default now(),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.session_outcomes is 'Analítica: cómo terminó cada conversación (resuelta, derivada, sin resolver), la última caja y el recorrido. Sin textos.';
create index session_outcomes_campana on bots.session_outcomes (campaign_id, started_at);
create index sessions_actividad on bots.sessions (updated_at);

-- Hasta qué evento está sumado (una sola fila).
create table bots.analytics_state (
  id            boolean primary key default true check (id),
  last_event_id bigint not null default 0,
  updated_at    timestamptz
);
comment on table bots.analytics_state is 'Hasta qué evento sumó la analítica y cuándo corrió la tarea por última vez.';
insert into bots.analytics_state default values;

-- ── El cálculo (igual que dominio/analitica.ts) ─────────────────────────────────────────────────

-- A qué métricas suma un evento: metricasDeEvento.
create or replace function bots.metricas_evento(nombre text, caja text, datos jsonb)
returns table (metric text, box_id text, key text)
language sql immutable set search_path = '' as $$
  with v as (
    select coalesce(left(caja, 40), '') as c,
      case when jsonb_typeof(datos -> 'letra') = 'string' and datos ->> 'letra' <> '' then left(datos ->> 'letra', 80) end as letra,
      case when jsonb_typeof(datos -> 'intencion') = 'string' and datos ->> 'intencion' <> '' then left(datos ->> 'intencion', 80) end as intencion,
      case when jsonb_typeof(datos -> 'tema') = 'string' and datos ->> 'tema' <> '' then left(datos ->> 'tema', 80) end as tema
  )
  select x.metric, x.box_id, x.key
  from v cross join lateral (values
    ('conversacion', '', '', nombre = 'sesion_iniciada'),
    ('caja', v.c, '', nombre = 'caja_mostrada' and v.c <> ''),
    ('opcion', v.c, coalesce(v.letra, ''), nombre = 'opcion_elegida' and v.c <> '' and v.letra is not null),
    ('texto', '', '', nombre = 'texto_recibido'),
    ('intencion', '', coalesce(v.intencion, ''), nombre in ('interpretado', 'regla') and v.intencion is not null),
    ('tema', '', coalesce(v.tema, ''), nombre = 'interpretado' and v.tema is not null),
    ('respuesta', v.c, case when datos -> 'completa' = 'true'::jsonb then 'completa' else 'sin_dato' end, nombre = 'respondido_con_base'),
    ('derivada', v.c, '', nombre = 'derivada'),
    ('sin_motor', v.c, '', nombre = 'sin_motor'),
    ('aclaracion', v.c, '', nombre = 'aclaracion'),
    ('dato', v.c, 'guardado', nombre = 'dato_guardado'),
    ('dato', v.c, 'invalido', nombre = 'dato_invalido'),
    ('solo_menus', '', '', nombre = 'solo_menus'),
    ('baja', v.c, '', nombre = 'baja'),
    ('tramite', v.c, '', nombre = 'tramite_electoral'),
    ('condiciones', '', '', nombre = 'condiciones_aceptadas')
  ) as x (metric, box_id, key, suma)
  where x.suma
$$;

-- Cómo terminó una conversación: cierreDeConversacion. Los eventos van en el orden en que se guardaron (id).
create or replace function bots.cierre_conversacion(sesion uuid, atendida boolean) returns jsonb
language sql stable set search_path = '' as $$
  with ev as (select e.id, e.name, e.box_id, e.data from bots.events e where e.session_id = sesion),
  cajas as (select left(ev.box_id, 40) as caja, ev.id from ev where ev.name = 'caja_mostrada' and coalesce(ev.box_id, '') <> ''),
  sin_repetir as (select c.caja, c.id, lag(c.caja) over (order by c.id) as antes from cajas c),
  primeras as (select s.caja, s.id from sin_repetir s where s.antes is distinct from s.caja order by s.id limit 4),
  marcas as (
    select
      coalesce(bool_or(ev.name = 'derivada'), false) as derivada,
      coalesce(bool_or(ev.name = 'respondido_con_base' and ev.data -> 'completa' = 'true'::jsonb), false) as con_base,
      coalesce(bool_or(ev.name = 'regla' and ev.data ->> 'regla' = 'cortesia'
        and exists (select 1 from ev p where p.id < ev.id and p.name in ('interpretado', 'opcion_elegida', 'respondido_con_base'))), false) as cortesia
    from ev
  )
  select jsonb_build_object(
    'resultado', case when atendida or (not m.derivada and (m.con_base or m.cortesia)) then 'resuelta' when m.derivada then 'derivada' else 'sin_resolver' end,
    'ultimaCaja', coalesce((select c.caja from cajas c order by c.id desc limit 1), ''),
    'recorrido', coalesce((select string_agg(p.caja, '>' order by p.id) from primeras p), ''))
  from marcas m
$$;

-- ── La tarea (pg_cron cada 10 minutos, o /api/tareas) ───────────────────────────────────────────

create or replace function bots.tarea_agregar_analitica(ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  desde bigint;
  hasta bigint;
  n_eventos integer;
  n_conversaciones integer;
begin
  select s.last_event_id into desde from bots.analytics_state s where s.id for update;
  -- Un tramo sin huecos: hasta el primer evento del último minuto. Un turno que tardó en confirmarse no queda atrás.
  select coalesce(min(e.id), (select coalesce(max(x.id), 0) + 1 from bots.events x)) into hasta
  from bots.events e where e.id > desde and e.occurred_at > ahora - interval '1 minute';
  hasta := greatest(hasta, desde + 1);

  insert into bots.stats_hourly (organization_id, campaign_id, bot_id, channel_kind, version_id, hour, metric, box_id, key, n)
  select e.organization_id, e.campaign_id, e.bot_id, e.channel_kind, e.version_id, date_trunc('hour', e.occurred_at at time zone 'UTC') at time zone 'UTC',
         m.metric, m.box_id, m.key, count(*)::integer
  from bots.events e
  cross join lateral bots.metricas_evento(e.name, e.box_id, e.data) m
  where e.id > desde and e.id < hasta
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9
  on conflict (bot_id, channel_kind, coalesce(version_id, '00000000-0000-0000-0000-000000000000'::uuid), hour, metric, box_id, key)
  do update set n = bots.stats_hourly.n + excluded.n;
  select count(*) into n_eventos from bots.events e where e.id > desde and e.id < hasta;
  update bots.analytics_state s set last_event_id = hasta - 1, updated_at = ahora where s.id;

  -- Las conversaciones con 30 minutos sin movimiento que no tienen cierre o que siguieron después del último.
  with pendientes as (
    select s.id, s.organization_id, s.campaign_id, s.bot_id, s.channel_kind, s.version_id, s.started_at,
           greatest(s.updated_at, coalesce(s.last_team_at, s.updated_at)) as actividad, s.last_team_at is not null as atendida
    from bots.sessions s
    left join bots.session_outcomes o on o.session_id = s.id
    where greatest(s.updated_at, coalesce(s.last_team_at, s.updated_at)) <= ahora - interval '30 minutes'
      and (o.session_id is null or o.activity_at < greatest(s.updated_at, coalesce(s.last_team_at, s.updated_at)))
    order by 8
    limit 5000
  )
  insert into bots.session_outcomes (session_id, organization_id, campaign_id, bot_id, channel_kind, version_id, started_at, result, last_box, path, activity_at, computed_at)
  select p.id, p.organization_id, p.campaign_id, p.bot_id, p.channel_kind, p.version_id, p.started_at,
         x.c ->> 'resultado', x.c ->> 'ultimaCaja', left(x.c ->> 'recorrido', 200), p.actividad, ahora
  from pendientes p
  cross join lateral (select bots.cierre_conversacion(p.id, p.atendida) as c) x
  on conflict (session_id) do update set
    version_id = excluded.version_id, result = excluded.result, last_box = excluded.last_box, path = excluded.path,
    activity_at = excluded.activity_at, computed_at = excluded.computed_at;
  get diagnostics n_conversaciones = row_count;
  return jsonb_build_object('eventos', n_eventos, 'conversaciones', n_conversaciones);
end $$;

-- ── Lo que lee la pantalla ──────────────────────────────────────────────────────────────────────

-- La analítica de un período (ver): filtro {botId, canal, versionId, desde, hasta}. Un id que no es de la forma de un
-- uuid no filtra nada (devuelve vacío), como un bot que no existe.
create or replace function bots.analitica(campana uuid, filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  forma constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  ninguno constant uuid := '00000000-0000-0000-0000-000000000000';
  bot uuid := case when coalesce(filtro ->> 'botId', '') = '' then null when filtro ->> 'botId' ~ forma then (filtro ->> 'botId')::uuid else ninguno end;
  version uuid := case when coalesce(filtro ->> 'versionId', '') = '' then null when filtro ->> 'versionId' ~ forma then (filtro ->> 'versionId')::uuid else ninguno end;
  canal text := nullif(filtro ->> 'canal', '');
  desde timestamptz := coalesce(nullif(filtro ->> 'desde', '')::timestamptz, now() - interval '30 days');
  hasta timestamptz := coalesce(nullif(filtro ->> 'hasta', '')::timestamptz, now());
begin
  perform bots.exigir(campana, 'ver');
  return jsonb_build_object(
    'metricas', coalesce((
      select jsonb_agg(jsonb_build_object('metrica', x.metric, 'caja', x.box_id, 'clave', x.key, 'n', x.n)
                       order by x.metric collate "C", x.box_id collate "C", x.key collate "C")
      from (
        select h.metric, h.box_id, h.key, sum(h.n)::integer as n
        from bots.stats_hourly h
        where h.campaign_id = campana and (bot is null or h.bot_id = bot) and (canal is null or h.channel_kind = canal)
          and (version is null or h.version_id = version) and h.hour >= desde and h.hour < hasta
        group by 1, 2, 3
      ) x), '[]'::jsonb),
    'porDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', x.dia, 'n', x.n) order by x.dia)
      from (
        select to_char(h.hour at time zone 'UTC', 'YYYY-MM-DD') as dia, sum(h.n)::integer as n
        from bots.stats_hourly h
        where h.campaign_id = campana and h.metric = 'conversacion' and (bot is null or h.bot_id = bot) and (canal is null or h.channel_kind = canal)
          and (version is null or h.version_id = version) and h.hour >= desde and h.hour < hasta
        group by 1
      ) x), '[]'::jsonb),
    'conversaciones', coalesce((
      select jsonb_agg(jsonb_build_object('resultado', x.result, 'ultimaCaja', x.last_box, 'recorrido', x.path, 'n', x.n)
                       order by x.n desc, x.result collate "C", x.path collate "C")
      from (
        select o.result, o.last_box, o.path, count(*)::integer as n
        from bots.session_outcomes o
        where o.campaign_id = campana and (bot is null or o.bot_id = bot) and (canal is null or o.channel_kind = canal)
          and (version is null or o.version_id = version) and o.started_at >= desde and o.started_at < hasta
        group by 1, 2, 3
      ) x), '[]'::jsonb),
    'costos', case when bots.puede(campana, 'ver_costos') then coalesce((
      select jsonb_agg(jsonb_build_object('funcion', x.function, 'motor', x.engine_id, 'usd', x.usd, 'llamadas', x.n) order by x.usd desc, x.function collate "C")
      from (
        select c.function, c.engine_id, sum(c.cost_usd) as usd, count(*)::integer as n
        from bots.engine_calls c
        where c.campaign_id = campana and c.use = 'en_vivo' and (bot is null or c.bot_id = bot) and c.created_at >= desde and c.created_at < hasta
        group by 1, 2
      ) x), '[]'::jsonb) end,
    'actualizadaEn', (select s.updated_at from bots.analytics_state s where s.id));
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.stats_hourly enable row level security;
alter table bots.session_outcomes enable row level security;
alter table bots.analytics_state enable row level security;

create policy "analítica: la ve quien entra al producto" on bots.stats_hourly for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "cierres: los ve quien entra al producto" on bots.session_outcomes for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));

grant select on bots.stats_hourly, bots.session_outcomes to authenticated;
grant all on bots.stats_hourly, bots.session_outcomes, bots.analytics_state to service_role;

revoke execute on function bots.metricas_evento(text, text, jsonb), bots.cierre_conversacion(uuid, boolean), bots.tarea_agregar_analitica(timestamptz),
  bots.analitica(uuid, jsonb) from public;
grant execute on function bots.tarea_agregar_analitica(timestamptz) to service_role;
grant execute on function bots.analitica(uuid, jsonb) to authenticated;

commit;
