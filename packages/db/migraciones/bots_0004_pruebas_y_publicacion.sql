-- BotMaker · 0004 · Corridas de prueba y publicación (plan técnico, etapa 4: tareas 4.04 a 4.06).
--
--  - bots.test_runs y bots.test_results: cada corrida de los casos de prueba de una versión con una combinación de
--    motores, y el resultado de cada caso. Por ahora las corre la app en tandas (el navegador pide la siguiente); si
--    más adelante se pasa a Trigger.dev, las tablas no cambian.
--  - Publicación con un segundo par de ojos: el editor pide (la versión queda "pedida" y no se cambia), el
--    administrador aprueba (pasa a "publicada" y la anterior a "archivada") o devuelve con un comentario. Para pedir,
--    la versión necesita una corrida terminada sobre su último cambio, y no puede bajar 2 puntos o más de acierto
--    contra la publicada. Cada paso queda en bots.publication_events y en la actividad de la organización.

begin;

-- ── Corridas ────────────────────────────────────────────────────────────────────────────────────

create table bots.test_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  version_id      uuid not null,
  version_seq     integer not null check (version_seq >= 0),
  engines         jsonb not null check (jsonb_typeof(engines) = 'object'),
  engines_label   text not null check (length(engines_label) between 1 and 200),
  status          text not null default 'en_curso' check (status in ('en_curso', 'terminada', 'cancelada')),
  total           integer not null check (total between 0 and 3000),
  done            integer not null default 0 check (done >= 0),
  summary         jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  cost_usd        numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_by      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (id, campaign_id),
  foreign key (version_id, campaign_id) references bots.versions (id, campaign_id) on delete cascade,
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.test_runs is 'Cada corrida de los casos de prueba de una versión (en su cambio version_seq) con una combinación de motores.';
create index test_runs_version on bots.test_runs (version_id, created_at desc);
create index test_runs_bot on bots.test_runs (bot_id, created_at desc);

create trigger test_runs_organizacion before insert or update of campaign_id, organization_id on bots.test_runs
  for each row execute function core.completar_organizacion_campana();

create table bots.test_results (
  run_id          uuid not null,
  organization_id uuid not null,
  campaign_id     uuid not null,
  case_id         text not null check (case_id ~ '^[a-z0-9_-]{1,40}$'),
  kind            text not null check (kind in ('intencion', 'base')),
  ok              boolean,
  result          jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 20000),
  cost_usd        numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at      timestamptz not null default now(),
  primary key (run_id, case_id),
  foreign key (run_id, campaign_id) references bots.test_runs (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.test_results is 'El resultado de cada caso de una corrida (qué respondió, si acertó, costo). Sin datos de ciudadanos: son casos de prueba.';

create trigger test_results_organizacion before insert on bots.test_results
  for each row execute function core.completar_organizacion_campana();
create trigger test_results_solo_agregar before update on bots.test_results
  for each row execute function bots.solo_agregar();

-- ── Publicación ─────────────────────────────────────────────────────────────────────────────────

create table bots.publication_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  version_id      uuid not null,
  action          text not null check (action in ('pedido', 'aprobado', 'devuelto')),
  note            text not null default '' check (length(note) <= 2000),
  run_id          uuid,
  profile_id      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (version_id, campaign_id) references bots.versions (id, campaign_id) on delete cascade,
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.publication_events is 'Cada paso de la publicación: pedido, aprobado o devuelto, con quién, cuándo y el comentario. Solo se agrega.';
create index publication_events_bot on bots.publication_events (bot_id, created_at desc);

create trigger publication_events_organizacion before insert on bots.publication_events
  for each row execute function core.completar_organizacion_campana();
create trigger publication_events_solo_agregar before update on bots.publication_events
  for each row execute function bots.solo_agregar();

-- ── Funciones: corridas ─────────────────────────────────────────────────────────────────────────

-- Empieza una corrida de la versión con una combinación de motores (editor y administrador).
create or replace function bots.crear_corrida(version uuid, motores jsonb, etiqueta text, total integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v bots.versions%rowtype;
  estado_bot text;
  nueva uuid;
begin
  select * into v from bots.versions x where x.id = version;
  perform bots.exigir(v.campaign_id, 'correr_pruebas');
  select b.status into estado_bot from bots.bots b where b.id = v.bot_id;
  if estado_bot = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  insert into bots.test_runs (campaign_id, bot_id, version_id, version_seq, engines, engines_label, total, created_by)
  values (v.campaign_id, v.bot_id, version, v.seq, coalesce(motores, '{}'), left(trim(etiqueta), 200), total, auth.uid())
  returning id into nueva;
  return nueva;
end $$;

-- Agrega resultados a una corrida en curso: [{caso, tipo, ok, resultado, costo}]. Los repetidos se ignoran.
create or replace function bots.guardar_resultados(corrida uuid, resultados jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r bots.test_runs%rowtype;
  hechos integer;
  costo numeric;
begin
  select * into r from bots.test_runs x where x.id = corrida;
  perform bots.exigir(r.campaign_id, 'correr_pruebas');
  if r.status <> 'en_curso' then
    raise exception 'La corrida ya terminó.' using errcode = '23514';
  end if;
  if jsonb_typeof(resultados) <> 'array' or jsonb_array_length(resultados) > 200 then
    raise exception 'Resultados inválidos.' using errcode = '22023';
  end if;
  insert into bots.test_results (run_id, campaign_id, case_id, kind, ok, result, cost_usd)
  select corrida, r.campaign_id, x ->> 'caso', x ->> 'tipo', (x ->> 'ok')::boolean, coalesce(x -> 'resultado', '{}'), coalesce((x ->> 'costo')::numeric, 0)
  from jsonb_array_elements(resultados) x
  on conflict (run_id, case_id) do nothing;
  select count(*), coalesce(sum(t.cost_usd), 0) into hechos, costo from bots.test_results t where t.run_id = corrida;
  update bots.test_runs set done = hechos, cost_usd = costo where id = corrida;
  return hechos;
end $$;

-- Cierra una corrida con su resumen (terminada) o la cancela.
create or replace function bots.cerrar_corrida(corrida uuid, resumen jsonb, estado text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r bots.test_runs%rowtype;
begin
  select * into r from bots.test_runs x where x.id = corrida;
  perform bots.exigir(r.campaign_id, 'correr_pruebas');
  if r.status <> 'en_curso' then
    raise exception 'La corrida ya terminó.' using errcode = '23514';
  end if;
  if estado not in ('terminada', 'cancelada') then
    raise exception 'Estado inválido: %', estado using errcode = '22023';
  end if;
  update bots.test_runs set status = estado, summary = resumen, finished_at = now() where id = corrida;
end $$;

-- ── Funciones: publicación ──────────────────────────────────────────────────────────────────────

-- El acierto de la última corrida terminada de una versión en un cambio dado (null si no hay).
create or replace function bots.acierto_corrida(version uuid, seq integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select (r.summary ->> 'acierto')::numeric
  from bots.test_runs r
  where r.version_id = acierto_corrida.version and r.status = 'terminada' and (acierto_corrida.seq is null or r.version_seq = acierto_corrida.seq)
    and jsonb_typeof(r.summary -> 'acierto') = 'number'
  order by r.finished_at desc
  limit 1
$$;
revoke execute on function bots.acierto_corrida(uuid, integer) from public;

-- El editor pide publicar el borrador tal como lo vio (seq_esperada). Necesita una corrida terminada sobre ese cambio y
-- no bajar 2 puntos o más de acierto contra la versión publicada.
create or replace function bots.pedir_publicacion(version uuid, seq_esperada integer, nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v bots.versions%rowtype;
  b bots.bots%rowtype;
  corrida uuid;
  nuevo numeric;
  publicado numeric;
begin
  select * into v from bots.versions x where x.id = version;
  perform bots.exigir(v.campaign_id, 'pedir_publicacion');
  select * into b from bots.bots x where x.id = v.bot_id;
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  if v.status <> 'borrador' then
    raise exception 'Esta versión ya no es un borrador.' using errcode = '23514';
  end if;
  if v.seq <> seq_esperada then
    raise exception 'El borrador cambió mientras lo editabas.' using errcode = '40001';
  end if;
  select r.id into corrida from bots.test_runs r
  where r.version_id = version and r.version_seq = v.seq and r.status = 'terminada'
  order by r.finished_at desc limit 1;
  if corrida is null then
    raise exception 'Falta correr las pruebas sobre el último cambio del borrador.' using errcode = '23514';
  end if;
  nuevo := bots.acierto_corrida(version, v.seq);
  if b.published_version_id is not null then
    publicado := bots.acierto_corrida(b.published_version_id, null);
    if nuevo is not null and publicado is not null and publicado - nuevo >= 2 then
      raise exception 'La versión baja el acierto de % a %: no se puede pedir publicar.', publicado, nuevo using errcode = '23514';
    end if;
  end if;
  update bots.versions set status = 'pedida' where id = version;
  insert into bots.publication_events (campaign_id, bot_id, version_id, action, note, run_id, profile_id)
  values (v.campaign_id, v.bot_id, version, 'pedido', left(coalesce(nota, ''), 2000), corrida, auth.uid());
  perform bots.anotar(b.organization_id, 'bots.publicacion_pedida', b.name, jsonb_build_object('bot', b.id, 'version', v.number, 'acierto', nuevo));
end $$;

-- El administrador aprueba: la versión queda publicada y la anterior, archivada.
create or replace function bots.aprobar_publicacion(version uuid, nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v bots.versions%rowtype;
  b bots.bots%rowtype;
begin
  select * into v from bots.versions x where x.id = version;
  perform bots.exigir(v.campaign_id, 'publicar');
  select * into b from bots.bots x where x.id = v.bot_id for update;
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  if v.status <> 'pedida' then
    raise exception 'Esa versión no tiene un pedido de publicación.' using errcode = '23514';
  end if;
  update bots.versions set status = 'archivada' where bot_id = v.bot_id and status = 'publicada';
  update bots.versions set status = 'publicada' where id = version;
  update bots.bots set published_version_id = version, status = case when status = 'pausado' then status else 'publicado' end where id = v.bot_id;
  insert into bots.publication_events (campaign_id, bot_id, version_id, action, note, profile_id)
  values (v.campaign_id, v.bot_id, version, 'aprobado', left(coalesce(nota, ''), 2000), auth.uid());
  perform bots.anotar(b.organization_id, 'bots.publicacion_aprobada', b.name, jsonb_build_object('bot', b.id, 'version', v.number));
end $$;

-- El administrador devuelve con un comentario: vuelve a borrador (o queda "devuelta" si ya hay otro borrador).
create or replace function bots.devolver_publicacion(version uuid, nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v bots.versions%rowtype;
  b bots.bots%rowtype;
begin
  select * into v from bots.versions x where x.id = version;
  perform bots.exigir(v.campaign_id, 'publicar');
  select * into b from bots.bots x where x.id = v.bot_id for update;
  if v.status <> 'pedida' then
    raise exception 'Esa versión no tiene un pedido de publicación.' using errcode = '23514';
  end if;
  if length(trim(coalesce(nota, ''))) = 0 then
    raise exception 'Para devolver hace falta un comentario.' using errcode = '23514';
  end if;
  update bots.versions set status = case
      when exists (select 1 from bots.versions o where o.bot_id = v.bot_id and o.status = 'borrador') then 'devuelta'
      else 'borrador' end
  where id = version;
  insert into bots.publication_events (campaign_id, bot_id, version_id, action, note, profile_id)
  values (v.campaign_id, v.bot_id, version, 'devuelto', left(nota, 2000), auth.uid());
  perform bots.anotar(b.organization_id, 'bots.publicacion_devuelta', b.name, jsonb_build_object('bot', b.id, 'version', v.number));
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.test_runs enable row level security;
alter table bots.test_results enable row level security;
alter table bots.publication_events enable row level security;

create policy "corridas: las ve quien entra al producto" on bots.test_runs for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "resultados: los ve quien entra al producto" on bots.test_results for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "publicación: la ve quien entra al producto" on bots.publication_events for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));

grant select on bots.test_runs, bots.test_results, bots.publication_events to authenticated;
grant all on bots.test_runs, bots.test_results, bots.publication_events to service_role;
grant usage, select on all sequences in schema bots to service_role;
revoke update, delete, truncate on bots.test_results, bots.publication_events from service_role;
revoke execute on function bots.crear_corrida(uuid, jsonb, text, integer) from public;
revoke execute on function bots.guardar_resultados(uuid, jsonb) from public;
revoke execute on function bots.cerrar_corrida(uuid, jsonb, text) from public;
revoke execute on function bots.pedir_publicacion(uuid, integer, text) from public;
revoke execute on function bots.aprobar_publicacion(uuid, text) from public;
revoke execute on function bots.devolver_publicacion(uuid, text) from public;
grant execute on function bots.crear_corrida(uuid, jsonb, text, integer) to authenticated;
grant execute on function bots.guardar_resultados(uuid, jsonb) to authenticated;
grant execute on function bots.cerrar_corrida(uuid, jsonb, text) to authenticated;
grant execute on function bots.pedir_publicacion(uuid, integer, text) to authenticated;
grant execute on function bots.aprobar_publicacion(uuid, text) to authenticated;
grant execute on function bots.devolver_publicacion(uuid, text) to authenticated;

commit;
