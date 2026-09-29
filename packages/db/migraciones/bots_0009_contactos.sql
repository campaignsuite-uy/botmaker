-- BotMaker · 0009 · Base de contactos (plan técnico, etapa 7: tarea 7.06).
--
--  - Lo que consultó cada contacto sale de bots.events, que no tienen textos y no vencen: el tema y la intención que
--    interpretó el motor y las opciones de menú que eligió. bots.consultas_contacto es el mismo cálculo que
--    consultasDeEventos (packages/modules/botmaker/dominio/contactos.ts) y `pnpm db:probar` controla que den lo mismo.
--  - bots.base_contactos y bots.ficha_contacto: la base para quien lee conversaciones, sin los borrados a pedido. El
--    número lo ve solo quien atiende (bots.json_contacto) y solo quien atiende busca por número.
--  - bots.exportar_base_contactos: toda la base que cumple el filtro, para descargarla (solo el administrador), con el
--    registro en bots.contact_exports: quién, cuándo, el filtro sin el texto buscado (puede ser un nombre) y cuántos.
--  - Cada bot tiene su base: un contacto es de un bot (decisión del 29/9).

begin;

create index events_sesion on bots.events (session_id) where session_id is not null;

create table bots.contact_exports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid,
  channel_kind    text check (channel_kind is null or channel_kind in ('web', 'landing', 'whatsapp')),
  consultation    text check (consultation is null or length(consultation) <= 80),
  with_search     boolean not null default false,
  row_count       integer not null check (row_count >= 0),
  handled_by      uuid references core.profiles (id) on delete set null,
  handled_at      timestamptz not null default now(),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete set null (bot_id),
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.contact_exports is 'Descargas de la base de contactos: quién, cuándo, el filtro (sin el texto buscado) y cuántos contactos. Nunca los datos. Solo se agrega.';
create index contact_exports_campana on bots.contact_exports (campaign_id, handled_at desc);

create trigger contact_exports_organizacion before insert on bots.contact_exports
  for each row execute function core.completar_organizacion_campana();
create trigger contact_exports_solo_agregar before update on bots.contact_exports
  for each row execute function bots.solo_agregar();

-- ── Lo que consultó ─────────────────────────────────────────────────────────────────────────────

-- Temas, consultas (intenciones) y opciones de un contacto, las más repetidas primero. Sin saludos, lo que no se
-- entiende, lo ajeno a la campaña, los intentos de manipular al bot ni el tema "ninguno" (INTENCIONES_SIN_CONSULTA y
-- TEMAS_SIN_CONSULTA en el código).
create or replace function bots.consultas_contacto(contacto uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'clave', x.clave, 'veces', x.veces, 'ultima', x.ultima)
                            order by x.veces desc, x.ultima desc, x.tipo collate "C", x.clave collate "C"), '[]'::jsonb)
  from (
    select k.tipo, k.clave, count(*)::integer as veces, max(e.occurred_at) as ultima
    from bots.sessions s
    join bots.events e on e.session_id = s.id
    cross join lateral (
      select 'intencion'::text as tipo, e.data ->> 'intencion' as clave
       where e.name = 'interpretado' and jsonb_typeof(e.data -> 'intencion') = 'string' and e.data ->> 'intencion' <> ''
         and e.data ->> 'intencion' <> all (array['cortesia', 'no_entendible', 'fuera_de_tema', 'intento_manipulacion'])
      union all
      select 'tema', e.data ->> 'tema'
       where e.name = 'interpretado' and jsonb_typeof(e.data -> 'tema') = 'string' and e.data ->> 'tema' <> '' and e.data ->> 'tema' <> 'ninguno'
      union all
      select 'opcion', e.box_id || '|' || (e.data ->> 'letra')
       where e.name = 'opcion_elegida' and coalesce(e.box_id, '') <> '' and jsonb_typeof(e.data -> 'letra') = 'string' and e.data ->> 'letra' <> ''
    ) k
    where s.contact_id = contacto
    group by k.tipo, k.clave
  ) x
$$;

-- Una fila de la base: el contacto (el número, según quién mira), sus conversaciones y lo que consultó. De un contacto
-- borrado a pedido no se muestra lo que consultó (los eventos quedan, sin nada que los una a la persona).
create or replace function bots.fila_base_contacto(c bots.contacts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'contacto', bots.json_contacto(c),
    'conversaciones', (select count(*) from bots.sessions s where s.contact_id = c.id),
    'primera', (select min(s.started_at) from bots.sessions s where s.contact_id = c.id),
    'ultima', (select max(s.updated_at) from bots.sessions s where s.contact_id = c.id),
    'consultas', case when c.deleted_at is null then bots.consultas_contacto(c.id) else '[]'::jsonb end)
$$;

-- Los contactos de la campaña que cumplen el filtro: bot, canal, texto (nombre, nombre de perfil, datos y, si ver_numero,
-- el número) y consulta ({"tipo": "tema", "clave": "agua"}). Sin los borrados a pedido.
create or replace function bots.filtrar_contactos(campana uuid, filtro jsonb, ver_numero boolean) returns setof bots.contacts
language plpgsql stable set search_path = '' as $$
declare
  bot uuid;
  canal text := nullif(filtro ->> 'canal', '');
  q text := left(trim(coalesce(filtro ->> 'buscar', '')), 80);
  patron text;
  digitos text;
  consulta jsonb;
begin
  if coalesce(filtro ->> 'botId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    bot := (filtro ->> 'botId')::uuid;
  elsif coalesce(filtro ->> 'botId', '') <> '' then
    return;
  end if;
  patron := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digitos := regexp_replace(q, '\D', '', 'g');
  if filtro -> 'consulta' ->> 'tipo' in ('tema', 'intencion', 'opcion') and coalesce(filtro -> 'consulta' ->> 'clave', '') <> '' then
    consulta := jsonb_build_array(jsonb_build_object('tipo', filtro -> 'consulta' ->> 'tipo', 'clave', filtro -> 'consulta' ->> 'clave'));
  end if;
  return query
    select c.* from bots.contacts c
    where c.campaign_id = campana and c.deleted_at is null
      and (bot is null or c.bot_id = bot)
      and (canal is null or c.channel_kind = canal)
      and (q = '' or c.name ilike patron or c.profile_name ilike patron
           or exists (select 1 from jsonb_each_text(c.data) d where d.value ilike patron)
           or (ver_numero and length(digitos) >= 4 and c.phone like '%' || digitos || '%'))
      and (consulta is null or bots.consultas_contacto(c.id) @> consulta);
end $$;

-- ── Lo que ve el equipo ─────────────────────────────────────────────────────────────────────────

-- La base de contactos de a una página, los más recientes primero (leer_conversaciones).
create or replace function bots.base_contactos(campana uuid, filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  limite integer := least(greatest(coalesce(nullif(filtro ->> 'limite', '')::integer, 50), 1), 200);
  desde integer := greatest(coalesce(nullif(filtro ->> 'desde', '')::integer, 0), 0);
  ver_numero boolean;
  total integer;
  pagina jsonb;
begin
  perform bots.exigir(campana, 'leer_conversaciones');
  ver_numero := bots.puede(campana, 'responder_conversaciones');
  select count(*) into total from bots.filtrar_contactos(campana, filtro, ver_numero);
  select coalesce(jsonb_agg(bots.fila_base_contacto(p.c) order by p.ultima desc nulls last, (p.c).id), '[]'::jsonb) into pagina
  from (
    select f as c, (select max(s.updated_at) from bots.sessions s where s.contact_id = f.id) as ultima
    from bots.filtrar_contactos(campana, filtro, ver_numero) f
    order by ultima desc nulls last, f.id
    limit limite offset desde
  ) p;
  return jsonb_build_object('total', total, 'filas', pagina);
end $$;

-- Un contacto con sus conversaciones (leer_conversaciones). null si no existe o la persona no lo puede ver.
create or replace function bots.ficha_contacto(contacto uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c bots.contacts%rowtype;
begin
  select * into c from bots.contacts x where x.id = contacto;
  if not found or not bots.puede(c.campaign_id, 'leer_conversaciones') then
    return null;
  end if;
  return bots.fila_base_contacto(c) || jsonb_build_object('lista', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'estado', s.state, 'canal', s.channel_kind, 'iniciadaEn', s.started_at, 'actualizadaEn', s.updated_at, 'mensajes', s.seq,
      'asignadaA', s.assigned_to) order by s.started_at desc)
    from bots.sessions s where s.contact_id = c.id), '[]'::jsonb));
end $$;

-- Toda la base que cumple el filtro, para descargarla (gestionar_datos_contactos: el administrador). Queda registrado
-- quién, cuándo, el filtro sin el texto buscado y cuántos; en la actividad, sin datos.
create or replace function bots.exportar_base_contactos(campana uuid, filtro jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  filas jsonb;
  n integer;
  bot uuid;
  consulta text;
begin
  perform bots.exigir(campana, 'gestionar_datos_contactos');
  select coalesce(jsonb_agg(bots.fila_base_contacto(p.c) order by p.ultima desc nulls last, (p.c).id), '[]'::jsonb), count(*) into filas, n
  from (
    select f as c, (select max(s.updated_at) from bots.sessions s where s.contact_id = f.id) as ultima
    from bots.filtrar_contactos(campana, filtro, true) f
    limit 50000
  ) p;
  if coalesce(filtro ->> 'botId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select b.id into bot from bots.bots b where b.id = (filtro ->> 'botId')::uuid and b.campaign_id = campana;
  end if;
  if filtro -> 'consulta' ->> 'tipo' in ('tema', 'intencion', 'opcion') then
    consulta := left((filtro -> 'consulta' ->> 'tipo') || ':' || coalesce(filtro -> 'consulta' ->> 'clave', ''), 80);
  end if;
  insert into bots.contact_exports (campaign_id, bot_id, channel_kind, consultation, with_search, row_count, handled_by)
  values (campana, bot, case when filtro ->> 'canal' in ('web', 'landing', 'whatsapp') then filtro ->> 'canal' end, consulta,
          coalesce(trim(filtro ->> 'buscar'), '') <> '', n, auth.uid());
  perform bots.anotar((select cs.organization_id from bots.campaign_settings cs where cs.id = campana), 'bots.base_contactos', 'exportar',
                      jsonb_build_object('bot', bot, 'cantidad', n));
  return filas;
end $$;

create or replace function bots.exportaciones_base(campana uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform bots.exigir(campana, 'gestionar_datos_contactos');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'campanaId', x.campaign_id, 'botId', x.bot_id, 'canal', x.channel_kind, 'consulta', x.consultation, 'conBusqueda', x.with_search,
      'cantidad', x.row_count, 'hechoPor', x.handled_by, 'hechoEn', x.handled_at) order by x.handled_at desc)
    from (select * from bots.contact_exports e where e.campaign_id = campana order by e.handled_at desc limit 100) x), '[]'::jsonb);
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.contact_exports enable row level security;
create policy "descargas de la base: las ve quien gestiona los datos de contactos" on bots.contact_exports for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('gestionar_datos_contactos')));
grant select on bots.contact_exports to authenticated;
grant all on bots.contact_exports to service_role;
revoke update, delete, truncate on bots.contact_exports from service_role;

revoke execute on function bots.consultas_contacto(uuid), bots.fila_base_contacto(bots.contacts), bots.filtrar_contactos(uuid, jsonb, boolean) from public;
revoke execute on function bots.base_contactos(uuid, jsonb), bots.ficha_contacto(uuid), bots.exportar_base_contactos(uuid, jsonb),
  bots.exportaciones_base(uuid) from public;
grant execute on function bots.base_contactos(uuid, jsonb), bots.ficha_contacto(uuid), bots.exportar_base_contactos(uuid, jsonb),
  bots.exportaciones_base(uuid) to authenticated;

commit;
