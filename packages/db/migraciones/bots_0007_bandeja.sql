-- BotMaker · 0007 · Bandeja (plan técnico, etapa 6: tareas 6.01 a 6.05).
--
--  - Atender: tomar una conversación (el bot deja de contestar en ella), responder como la campaña, devolverla al bot y
--    cerrarla. responder_conversaciones (administrador y agente). La bandeja la leen quienes tienen leer_conversaciones.
--  - bots.alerts: derivada sin respuesta del equipo en 2 horas, tope de gasto del día alcanzado y canal desconectado.
--    Las abre y las cierra bots.tarea_revisar_alertas (un cron o pg_cron).
--  - bots.answer_reviews: la revisión por muestreo de las respuestas con base (editar_borrador).
--  - bots.data_requests: los pedidos sobre los datos de un contacto (exportar y borrar), con quién y cuándo; nunca el dato.
--  - bots.tarea_borrar_vencidos: vacía el texto de los mensajes pasados los días de guardado de cada bot.

begin;

create table bots.alerts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  kind            text not null check (kind in ('derivada_sin_respuesta', 'tope_alcanzado', 'canal_desconectado')),
  ref             text not null check (length(ref) between 1 and 80),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.alerts is 'Avisos del producto. ref: la conversación (derivada), el día (tope) o el canal. Una sola abierta por tipo, bot y ref.';
create unique index alerts_una_abierta on bots.alerts (kind, bot_id, ref) where closed_at is null;
create index alerts_campana on bots.alerts (campaign_id, opened_at desc);

create trigger alerts_organizacion before insert on bots.alerts
  for each row execute function core.completar_organizacion_campana();

create table bots.answer_reviews (
  session_id      uuid not null,
  n               integer not null,
  organization_id uuid not null,
  campaign_id     uuid not null,
  verdict         text not null check (verdict in ('correcta', 'incorrecta')),
  converted       boolean not null default false,
  profile_id      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (session_id, n),
  foreign key (session_id, n) references bots.messages (session_id, n) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.answer_reviews is 'La revisión por muestreo de una respuesta con base: correcta o incorrecta, y si se convirtió en contenido fijo.';

create trigger answer_reviews_organizacion before insert on bots.answer_reviews
  for each row execute function core.completar_organizacion_campana();

create table bots.data_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  contact_id      uuid not null,
  kind            text not null check (kind in ('buscar', 'exportar', 'borrar')),
  note            text not null default '' check (length(note) <= 500),
  handled_by      uuid references core.profiles (id) on delete set null,
  handled_at      timestamptz not null default now(),
  foreign key (contact_id, campaign_id) references bots.contacts (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.data_requests is 'Pedidos de una persona sobre sus datos: qué se hizo, quién y cuándo. Nunca el dato. Solo se agrega.';
create index data_requests_campana on bots.data_requests (campaign_id, handled_at desc);

create trigger data_requests_organizacion before insert on bots.data_requests
  for each row execute function core.completar_organizacion_campana();
create trigger data_requests_solo_agregar before update on bots.data_requests
  for each row execute function bots.solo_agregar();

-- ── Leer la bandeja ─────────────────────────────────────────────────────────────────────────────

-- Las conversaciones de la campaña con su contacto y su último mensaje (leer_conversaciones).
-- filtro: {"bot": uuid, "estado": "derivada" | … | "abiertas", "canal": "web", "buscar": "texto", "asignada": uuid, "limite": 100}
create or replace function bots.bandeja_conversaciones(campana uuid, filtro jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  buscar text := nullif(trim(filtro ->> 'buscar'), '');
begin
  perform bots.exigir(campana, 'leer_conversaciones');
  return coalesce((
    select jsonb_agg(fila order by (fila -> 'conversacion' ->> 'actualizadaEn') desc)
    from (
      select jsonb_build_object(
        'conversacion', bots.json_conversacion(s),
        'contacto', jsonb_build_object('id', c.id, 'nombre', c.name, 'borradoEn', c.deleted_at),
        'ultimo', (select jsonb_build_object('autor', m.author, 'texto', m.text, 'creadoEn', m.created_at) from bots.messages m where m.session_id = s.id order by m.n desc limit 1),
        'mensajes', s.seq) as fila
      from bots.sessions s
      join bots.contacts c on c.id = s.contact_id
      where s.campaign_id = campana
        and (filtro ->> 'bot' is null or s.bot_id = (filtro ->> 'bot')::uuid)
        and (filtro ->> 'canal' is null or s.channel_kind = filtro ->> 'canal')
        and (filtro ->> 'asignada' is null or s.assigned_to = (filtro ->> 'asignada')::uuid)
        and (filtro ->> 'estado' is null or (filtro ->> 'estado' = 'abiertas' and s.state in ('derivada', 'en_atencion')) or s.state = filtro ->> 'estado')
        and (buscar is null or c.name ilike '%' || buscar || '%' or c.data::text ilike '%' || buscar || '%')
      order by s.updated_at desc
      limit least(coalesce((filtro ->> 'limite')::integer, 100), 2000)
    ) x), '[]'::jsonb);
end $$;

create or replace function bots.bandeja_conversacion(sesion uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
begin
  select * into s from bots.sessions x where x.id = sesion;
  if s.id is null then
    return null;
  end if;
  perform bots.exigir(s.campaign_id, 'leer_conversaciones');
  return jsonb_build_object(
    'conversacion', bots.json_conversacion(s),
    'contacto', (select bots.json_contacto(c) from bots.contacts c where c.id = s.contact_id),
    'mensajes', bots.publico_mensajes(sesion, 0));
end $$;

create or replace function bots.bandeja_muestra(campana uuid, pendientes boolean, limite integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform bots.exigir(campana, 'leer_conversaciones');
  return coalesce((
    select jsonb_agg(fila order by (fila ->> 'fecha') desc)
    from (
      select jsonb_build_object(
        'conversacionId', m.session_id, 'botId', s.bot_id, 'n', m.n,
        'pregunta', (select p.text from bots.messages p where p.session_id = m.session_id and p.n < m.n and p.author = 'contacto' order by p.n desc limit 1),
        'respuesta', m.text, 'secciones', coalesce(m.decision -> 'secciones', '[]'::jsonb), 'fecha', m.created_at,
        'veredicto', r.verdict, 'convertida', coalesce(r.converted, false), 'revisadaPor', r.profile_id) as fila
      from bots.messages m
      join bots.sessions s on s.id = m.session_id
      left join bots.answer_reviews r on r.session_id = m.session_id and r.n = m.n
      where m.campaign_id = campana and m.sampled and (not pendientes or r.verdict is null)
      order by m.created_at desc
      limit least(coalesce(limite, 100), 500)
    ) x), '[]'::jsonb);
end $$;

-- ── Atender ─────────────────────────────────────────────────────────────────────────────────────

create or replace function bots.tomar_conversacion(sesion uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  if s.state = 'cerrada' then
    raise exception 'La conversación está cerrada.' using errcode = '23514';
  end if;
  update bots.sessions set
    state = 'en_atencion', assigned_to = auth.uid(), updated_at = now(),
    handoff_at = case when s.state = 'bot' then now() else handoff_at end,
    handoff_reason = case when s.state = 'bot' then 'La tomó el equipo' else handoff_reason end,
    engine_state = case when s.state = 'bot' then engine_state || '{"estado": "derivada", "espera": null}'::jsonb else engine_state end
  where id = sesion;
end $$;

create or replace function bots.responder_conversacion(sesion uuid, texto text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  n integer;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  if s.state not in ('derivada', 'en_atencion') then
    raise exception 'Para responder, primero hay que tomar la conversación.' using errcode = '23514';
  end if;
  if length(trim(coalesce(texto, ''))) not between 1 and 4096 then
    raise exception 'La respuesta tiene que tener texto (hasta 4.096 caracteres).' using errcode = '22023';
  end if;
  n := s.seq + 1;
  insert into bots.messages (session_id, campaign_id, n, author, profile_id, kind, text) values (sesion, s.campaign_id, n, 'agente', auth.uid(), 'texto', trim(texto));
  update bots.sessions set seq = n, state = 'en_atencion', assigned_to = coalesce(assigned_to, auth.uid()), last_team_at = now(), updated_at = now() where id = sesion;
  return n;
end $$;

-- Devolver al bot: guarda lo que dijo el bot al volver (el turno de devolverAlBot, que corre en el servidor).
create or replace function bots.devolver_conversacion(sesion uuid, turno jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  c bots.contacts%rowtype;
  n integer;
  primero boolean := true;
  m jsonb;
  e jsonb;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  if s.state not in ('derivada', 'en_atencion') then
    raise exception 'La conversación no está derivada.' using errcode = '23514';
  end if;
  n := s.seq;
  for m in select * from jsonb_array_elements(coalesce(turno -> 'mensajes', '[]'::jsonb)) loop
    n := n + 1;
    insert into bots.messages (session_id, campaign_id, n, author, kind, text, payload, box_id, decision, version_id)
    values (sesion, s.campaign_id, n, 'bot', 'texto', m ->> 'texto', nullif(m -> 'datos', 'null'::jsonb), m ->> 'cajaId',
            case when primero then nullif(turno -> 'decision', 'null'::jsonb) end, s.version_id);
    primero := false;
  end loop;
  update bots.sessions set seq = n, state = 'bot', assigned_to = null, engine_state = coalesce(turno -> 'sesion', engine_state),
    current_box = turno ->> 'cajaActual', updated_at = now()
  where id = sesion;
  select * into c from bots.contacts x where x.id = s.contact_id;
  for e in select * from jsonb_array_elements(coalesce(turno -> 'eventos', '[]'::jsonb)) loop
    insert into bots.events (campaign_id, bot_id, version_id, channel_kind, session_id, contact_hash, name, box_id, data)
    values (s.campaign_id, s.bot_id, s.version_id, s.channel_kind, sesion, c.external_id_hash, e ->> 'nombre', e ->> 'cajaId', coalesce(e -> 'datos', '{}'::jsonb));
  end loop;
end $$;

create or replace function bots.cerrar_conversacion(sesion uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  update bots.sessions set state = 'cerrada', assigned_to = null, updated_at = now() where id = sesion;
end $$;

-- ── Revisión por muestreo ───────────────────────────────────────────────────────────────────────

create or replace function bots.revisar_respuesta(sesion uuid, numero integer, veredicto text, convertida boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m bots.messages%rowtype;
begin
  select * into m from bots.messages x where x.session_id = sesion and x.n = numero;
  perform bots.exigir(m.campaign_id, 'editar_borrador');
  if not m.sampled then
    raise exception 'Ese mensaje no está en la muestra.' using errcode = '23514';
  end if;
  insert into bots.answer_reviews (session_id, n, campaign_id, verdict, converted, profile_id)
  values (sesion, numero, m.campaign_id, veredicto, convertida, auth.uid())
  on conflict (session_id, n) do update set verdict = excluded.verdict, converted = excluded.converted, profile_id = excluded.profile_id, created_at = now();
end $$;

-- ── Datos de un contacto ────────────────────────────────────────────────────────────────────────

create or replace function bots.buscar_contactos(campana uuid, texto text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := trim(coalesce(texto, ''));
begin
  perform bots.exigir(campana, 'gestionar_datos_contactos');
  if length(q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'contacto', bots.json_contacto(c),
      'conversaciones', (select count(*) from bots.sessions s where s.contact_id = c.id),
      'ultima', (select max(s.updated_at) from bots.sessions s where s.contact_id = c.id)))
    from (
      select * from bots.contacts c
      where c.campaign_id = campana and c.deleted_at is null
        and (c.id::text = q or c.name ilike '%' || q || '%' or c.data::text ilike '%' || q || '%'
             or exists (select 1 from bots.messages m join bots.sessions s on s.id = m.session_id where s.contact_id = c.id and m.author = 'contacto' and m.text ilike '%' || q || '%'))
      limit 50
    ) c), '[]'::jsonb);
end $$;

create or replace function bots.exportar_contacto(contacto uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c bots.contacts%rowtype;
begin
  select * into c from bots.contacts x where x.id = contacto;
  perform bots.exigir(c.campaign_id, 'gestionar_datos_contactos');
  insert into bots.data_requests (campaign_id, contact_id, kind, handled_by) values (c.campaign_id, c.id, 'exportar', auth.uid());
  perform bots.anotar(c.organization_id, 'bots.datos_contacto', 'exportar', jsonb_build_object('contacto', c.id));
  return jsonb_build_object(
    'contacto', bots.json_contacto(c),
    'conversaciones', coalesce((
      select jsonb_agg(jsonb_build_object('conversacion', bots.json_conversacion(s) - 'sesion', 'mensajes', bots.publico_mensajes(s.id, 0)) order by s.started_at)
      from bots.sessions s where s.contact_id = c.id), '[]'::jsonb),
    'exportadoEn', now());
end $$;

create or replace function bots.borrar_contacto(contacto uuid, nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c bots.contacts%rowtype;
begin
  select * into c from bots.contacts x where x.id = contacto for update;
  perform bots.exigir(c.campaign_id, 'gestionar_datos_contactos');
  update bots.contacts set name = null, data = '{}'::jsonb, deleted_at = now() where id = contacto;
  update bots.messages m set text = null, payload = null from bots.sessions s where s.id = m.session_id and s.contact_id = contacto;
  update bots.sessions set engine_state = engine_state || '{"variables": {}, "turnos": []}'::jsonb, state = 'cerrada', assigned_to = null where contact_id = contacto;
  insert into bots.data_requests (campaign_id, contact_id, kind, note, handled_by) values (c.campaign_id, c.id, 'borrar', left(coalesce(nota, ''), 500), auth.uid());
  perform bots.anotar(c.organization_id, 'bots.datos_contacto', 'borrar', jsonb_build_object('contacto', c.id));
end $$;

-- ── Tareas de fondo (clave de servicio o pg_cron) ───────────────────────────────────────────────

create or replace function bots.tarea_revisar_alertas(ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  abiertas integer := 0;
  cerradas integer := 0;
  dia date := (ahora at time zone 'UTC')::date;
begin
  -- Derivadas sin respuesta del equipo desde hace 2 horas.
  with nuevas as (
    insert into bots.alerts (campaign_id, bot_id, kind, ref, opened_at)
    select s.campaign_id, s.bot_id, 'derivada_sin_respuesta', s.id::text, ahora
    from bots.sessions s
    where s.state in ('derivada', 'en_atencion') and s.handoff_at <= ahora - interval '2 hours'
      and (s.last_team_at is null or s.last_team_at < s.handoff_at)
    on conflict do nothing
    returning 1
  ) select count(*) into abiertas from nuevas;
  with cerr as (
    update bots.alerts a set closed_at = ahora
    where a.kind = 'derivada_sin_respuesta' and a.closed_at is null
      and not exists (
        select 1 from bots.sessions s where s.id::text = a.ref and s.state in ('derivada', 'en_atencion')
          and (s.last_team_at is null or s.last_team_at < s.handoff_at))
    returning 1
  ) select cerradas + count(*) into cerradas from cerr;
  -- Tope de gasto del día (uso en vivo) alcanzado.
  with nuevas as (
    insert into bots.alerts (campaign_id, bot_id, kind, ref, opened_at)
    select b.campaign_id, b.id, 'tope_alcanzado', dia::text, ahora
    from bots.bots b
    where b.status in ('publicado', 'pausado') and b.daily_cap_usd > 0
      and coalesce((select sum(d.cost_usd) from bots.spend_daily d where d.bot_id = b.id and d.day = dia and d.use = 'en_vivo'), 0) >= b.daily_cap_usd
    on conflict do nothing
    returning 1
  ) select abiertas + count(*) into abiertas from nuevas;
  with cerr as (
    update bots.alerts a set closed_at = ahora where a.kind = 'tope_alcanzado' and a.closed_at is null and a.ref <> dia::text returning 1
  ) select cerradas + count(*) into cerradas from cerr;
  return jsonb_build_object('abiertas', abiertas, 'cerradas', cerradas);
end $$;

-- Vacía el texto de los mensajes (y lo que el motor guardó de la conversación) pasados los días de guardado de cada
-- bot; borra los datos de los contactos sin conversaciones en ese plazo; limpia los conteos viejos.
create or replace function bots.tarea_borrar_vencidos(ahora timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update bots.messages m set text = null, payload = null
  from bots.sessions s join bots.bots b on b.id = s.bot_id
  where s.id = m.session_id and m.text is not null and m.created_at < ahora - make_interval(days => b.retention_days);
  get diagnostics n = row_count;
  update bots.sessions s set engine_state = s.engine_state || '{"variables": {}, "turnos": []}'::jsonb
  from bots.bots b where b.id = s.bot_id and s.updated_at < ahora - make_interval(days => b.retention_days)
    and (s.engine_state -> 'variables' <> '{}'::jsonb or s.engine_state -> 'turnos' <> '[]'::jsonb);
  update bots.contacts c set name = null, data = '{}'::jsonb
  from bots.bots b where b.id = c.bot_id and (c.name is not null or c.data <> '{}'::jsonb)
    and coalesce((select max(s.updated_at) from bots.sessions s where s.contact_id = c.id), c.created_at) < ahora - make_interval(days => b.retention_days);
  delete from bots.rate_limits where window_start < ahora - interval '2 days';
  return n;
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.alerts enable row level security;
alter table bots.answer_reviews enable row level security;
alter table bots.data_requests enable row level security;

create policy "alertas: las ve quien lee conversaciones" on bots.alerts for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('leer_conversaciones')));
create policy "revisiones: las ve quien lee conversaciones" on bots.answer_reviews for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('leer_conversaciones')));
create policy "pedidos de datos: los ve quien los atiende" on bots.data_requests for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('gestionar_datos_contactos')));

grant select on bots.alerts, bots.answer_reviews, bots.data_requests to authenticated;
grant all on bots.alerts, bots.answer_reviews, bots.data_requests to service_role;
revoke update, delete, truncate on bots.data_requests from service_role;

revoke execute on function bots.bandeja_conversaciones(uuid, jsonb), bots.bandeja_conversacion(uuid), bots.bandeja_muestra(uuid, boolean, integer),
  bots.tomar_conversacion(uuid), bots.responder_conversacion(uuid, text), bots.devolver_conversacion(uuid, jsonb), bots.cerrar_conversacion(uuid),
  bots.revisar_respuesta(uuid, integer, text, boolean), bots.buscar_contactos(uuid, text), bots.exportar_contacto(uuid), bots.borrar_contacto(uuid, text) from public;
grant execute on function bots.bandeja_conversaciones(uuid, jsonb), bots.bandeja_conversacion(uuid), bots.bandeja_muestra(uuid, boolean, integer),
  bots.tomar_conversacion(uuid), bots.responder_conversacion(uuid, text), bots.devolver_conversacion(uuid, jsonb), bots.cerrar_conversacion(uuid),
  bots.revisar_respuesta(uuid, integer, text, boolean), bots.buscar_contactos(uuid, text), bots.exportar_contacto(uuid), bots.borrar_contacto(uuid, text) to authenticated;
revoke execute on function bots.tarea_revisar_alertas(timestamptz), bots.tarea_borrar_vencidos(timestamptz) from public;
grant execute on function bots.tarea_revisar_alertas(timestamptz), bots.tarea_borrar_vencidos(timestamptz) to service_role;

commit;
