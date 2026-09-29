-- BotMaker · 0003 · Versiones del bot y cambios del borrador (plan técnico, etapa 2, tarea 2.05).
--
--  - bots.versions: cada versión del bot con su definición completa (flujos, contenidos, intenciones, temas, variables;
--    dominio/definicion.ts). A lo sumo un borrador por bot: es la única versión que se cambia. Los otros estados
--    (pedida, aprobada, publicada, devuelta, archivada) los usa la publicación (etapa 5).
--  - bots.version_changes: cada cambio del borrador, en orden (seq), con las operaciones que lo hicieron y su inversa
--    (dominio/operaciones.ts). Es el historial y de ahí salen deshacer y rehacer. Solo se agrega.
--  - guardar_cambio exige que el borrador siga en el seq que vio quien lo cambia: si otra persona lo cambió en el medio,
--    corta con "El borrador cambió" (40001) y el servidor vuelve a aplicar la operación sobre lo último.
--  - crear_bot acepta la definición inicial (la plantilla) y crea la versión 1 en borrador en la misma transacción.
--
-- La base controla quién, en qué estado y en qué orden; que la definición sea válida lo controla el servidor con zod
-- (validarDefinicion) antes de guardar y otra vez al leer. La base exige solo la forma mínima (objeto con formato 1).

begin;

-- ── Versiones ───────────────────────────────────────────────────────────────────────────────────

create table bots.versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  number          integer not null check (number >= 1),
  status          text not null default 'borrador'
                  check (status in ('borrador', 'pedida', 'aprobada', 'publicada', 'devuelta', 'archivada')),
  definition      jsonb not null
                  check (jsonb_typeof(definition) = 'object' and coalesce(definition -> 'formato' = '1'::jsonb, false)
                         and octet_length(definition::text) <= 2000000),
  based_on_id     uuid,
  seq             integer not null default 0 check (seq >= 0),
  created_by      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (bot_id, number),
  unique (id, campaign_id),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade,
  foreign key (based_on_id, campaign_id) references bots.versions (id, campaign_id) on delete set null (based_on_id)
);
comment on table bots.versions is 'Cada versión del bot con su definición completa. A lo sumo un borrador por bot, que es lo único que se cambia.';
comment on column bots.versions.number is 'Número de versión dentro del bot (v1, v2…): es el que se muestra y el de las direcciones "v12 · 3.4 › B".';
comment on column bots.versions.seq is 'Cantidad de cambios guardados. guardar_cambio exige el que vio quien cambia: así dos personas no se pisan.';
comment on column bots.versions.based_on_id is 'La versión de la que se copió el borrador (null si salió de la plantilla).';
create unique index versions_un_borrador on bots.versions (bot_id) where status = 'borrador';
create index versions_bot on bots.versions (bot_id, number desc);

create trigger versions_organizacion before insert or update of campaign_id, organization_id on bots.versions
  for each row execute function core.completar_organizacion_campana();
create trigger versions_actualizado before update on bots.versions
  for each row execute function core.tocar_actualizado();

-- ── Cambios del borrador ────────────────────────────────────────────────────────────────────────

create table bots.version_changes (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  campaign_id     uuid not null,
  version_id      uuid not null,
  seq             integer not null check (seq >= 1),
  origin          text not null check (origin in ('editor', 'yaml', 'copiloto', 'deshacer', 'rehacer')),
  operations      jsonb not null check (jsonb_typeof(operations) = 'array'),
  inverse         jsonb not null check (jsonb_typeof(inverse) = 'object'),
  summary         text not null check (length(summary) between 1 and 500),
  target_seq      integer,
  profile_id      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (version_id, seq),
  check ((origin in ('deshacer', 'rehacer')) = (target_seq is not null)),
  check (target_seq is null or (target_seq >= 1 and target_seq < seq)),
  check (octet_length(operations::text) + octet_length(inverse::text) <= 4000000),
  foreign key (version_id, campaign_id) references bots.versions (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.version_changes is 'Cada cambio del borrador: operaciones, inversa y resumen. Deshacer y rehacer son cambios más (target_seq = el cambio que deshacen o rehacen). Solo se agrega.';

create trigger version_changes_organizacion before insert on bots.version_changes
  for each row execute function core.completar_organizacion_campana();
create trigger version_changes_solo_agregar before update on bots.version_changes
  for each row execute function bots.solo_agregar();

-- ── Funciones ───────────────────────────────────────────────────────────────────────────────────

-- Igual que en 0002 y, si datos trae `definicion`, crea también la versión 1 en borrador (la plantilla del bot).
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
    select b.id into existente from bots.bots b where b.request_key = clave and b.campaign_id = campana;
    if existente is null then
      raise exception 'La clave del formulario es de otra campaña.' using errcode = '23505';
    end if;
    return existente;
  end if;
  insert into bots.bot_engines (campaign_id, bot_id, function, primary_engine_id, fallback_engine_id, timeout_ms, double_read, updated_by)
  select campana, nuevo, d.function, d.primary_engine_id, d.fallback_engine_id, d.timeout_ms, d.double_read, auth.uid()
  from bots.engine_defaults d;
  if jsonb_typeof(datos -> 'definicion') = 'object' then
    insert into bots.versions (campaign_id, bot_id, number, status, definition, created_by)
    values (campana, nuevo, 1, 'borrador', datos -> 'definicion', auth.uid());
  end if;
  perform bots.anotar(org, 'bots.crear', trim(datos ->> 'nombre'), jsonb_build_object('bot', nuevo));
  return nuevo;
end $$;

-- El borrador del bot. Si ya hay uno, lo devuelve. Si no, lo crea con `definicion` o, si viene null, copiando la
-- versión publicada (o la última). Editor y administrador.
create or replace function bots.crear_borrador(bot uuid, definicion jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  existente uuid;
  base_id uuid;
  base_definicion jsonb;
  numero integer;
  nuevo uuid;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'editar_borrador');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  -- Dos pedidos a la vez: el segundo espera y encuentra el borrador del primero.
  perform 1 from bots.bots x where x.id = bot for update;
  select v.id into existente from bots.versions v where v.bot_id = bot and v.status = 'borrador';
  if existente is not null then
    return existente;
  end if;
  if definicion is null then
    select v.id, v.definition into base_id, base_definicion from bots.versions v where v.id = b.published_version_id;
    if base_id is null then
      select v.id, v.definition into base_id, base_definicion from bots.versions v where v.bot_id = bot order by v.number desc limit 1;
    end if;
    if base_id is null then
      raise exception 'El bot no tiene una versión de la que partir.' using errcode = 'P0002';
    end if;
  end if;
  select coalesce(max(v.number), 0) + 1 into numero from bots.versions v where v.bot_id = bot;
  insert into bots.versions (campaign_id, bot_id, number, status, definition, based_on_id, created_by)
  values (b.campaign_id, bot, numero, 'borrador', coalesce(definicion, base_definicion), base_id, auth.uid())
  returning id into nuevo;
  perform bots.anotar(b.organization_id, 'bots.borrador_creado', b.name, jsonb_build_object('bot', bot, 'version', numero));
  return nuevo;
end $$;

-- Guarda un cambio del borrador: la definición que quedó y el cambio para el historial. Corta si el borrador ya no está
-- en `seq_esperada` (otra persona lo cambió). Devuelve el seq nuevo. Editor y administrador.
-- origen: editor | yaml | copiloto | deshacer | rehacer; objetivo: el cambio que deshace o rehace (solo esos dos).
create or replace function bots.guardar_cambio(version uuid, seq_esperada integer, origen text, operaciones jsonb,
                                               inversa jsonb, resumen text, objetivo integer, definicion jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v bots.versions%rowtype;
  estado_bot text;
  nuevo integer;
begin
  select * into v from bots.versions x where x.id = version;
  perform bots.exigir(v.campaign_id, 'editar_borrador');
  select b.status into estado_bot from bots.bots b where b.id = v.bot_id;
  if estado_bot = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  if v.status <> 'borrador' then
    raise exception 'Esta versión ya no es un borrador.' using errcode = '23514';
  end if;
  if definicion is null then
    raise exception 'Falta la definición del bot.' using errcode = '23502';
  end if;
  update bots.versions x set definition = definicion, seq = x.seq + 1
  where x.id = version and x.seq = seq_esperada and x.status = 'borrador'
  returning x.seq into nuevo;
  if nuevo is null then
    raise exception 'El borrador cambió mientras lo editabas.' using errcode = '40001';
  end if;
  insert into bots.version_changes (campaign_id, version_id, seq, origin, operations, inverse, summary, target_seq, profile_id)
  values (v.campaign_id, version, nuevo, origen, operaciones, inversa, left(trim(resumen), 500), objetivo, auth.uid());
  return nuevo;
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.versions enable row level security;
alter table bots.version_changes enable row level security;

create policy "versiones: las ve quien entra al producto" on bots.versions for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "cambios del borrador: los ve quien entra al producto" on bots.version_changes for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));

grant select on bots.versions, bots.version_changes to authenticated;
grant all on bots.versions, bots.version_changes to service_role;
grant usage, select on all sequences in schema bots to service_role;
revoke update, delete, truncate on bots.version_changes from service_role;
revoke execute on function bots.crear_borrador(uuid, jsonb) from public;
revoke execute on function bots.guardar_cambio(uuid, integer, text, jsonb, jsonb, text, integer, jsonb) from public;
grant execute on function bots.crear_borrador(uuid, jsonb) to authenticated;
grant execute on function bots.guardar_cambio(uuid, integer, text, jsonb, jsonb, text, integer, jsonb) to authenticated;

commit;
