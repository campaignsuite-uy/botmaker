-- BotMaker · 0006 · Canal web (plan técnico, etapa 5: tareas 5.03 a 5.06).
--
--  - bots.channels: el canal web de cada bot (prendido o apagado, y cómo se aceptan las condiciones). Sin fila, prendido
--    con aviso. WhatsApp (etapa 7) va en la misma tabla.
--  - bots.terms: las condiciones de cada bot, con sus versiones. Solo se agregan.
--  - bots.contacts, bots.sessions y bots.messages: quien le escribe al bot (identificado por un HMAC del id del canal,
--    nunca por el id), cada conversación con el estado del motor, y cada mensaje con la decisión del bot. El texto de
--    los mensajes es lo único con datos de personas y se borra a los días de guardado del bot (bots_0007).
--  - bots.events: la analítica, sin textos de personas. Solo se agregan.
--  - bots.rate_limits: los conteos de mensajes por IP, contacto y bot (claves con HMAC), por ventanas fijas.
--
-- La app pública no tiene sesión de persona: usa la clave de servicio y solo las funciones bots.publico_*, que no
-- abren nada que no sea de un bot publicado. El equipo lee con sus reglas por fila (leer_conversaciones) y cambia el
-- canal, las condiciones y la pausa con funciones que exigen su acción.

begin;

-- ── Canal y condiciones ─────────────────────────────────────────────────────────────────────────

create table bots.channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  kind            text not null check (kind in ('web', 'whatsapp')),
  status          text not null default 'activo' check (status in ('activo', 'apagado', 'desconectado')),
  config          jsonb not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (bot_id, kind),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.channels is 'Los canales de cada bot. web: widget y página propia. Sin fila, el canal web está prendido con aviso de condiciones.';
comment on column bots.channels.config is 'web: {"modo_condiciones": "aviso" | "acepto"}. Nunca secretos: las claves de WhatsApp van a Vault (etapa 7).';

create trigger channels_organizacion before insert or update of campaign_id, organization_id on bots.channels
  for each row execute function core.completar_organizacion_campana();
create trigger channels_actualizado before update on bots.channels
  for each row execute function core.tocar_actualizado();

create table bots.terms (
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  number          integer not null check (number >= 1),
  body            text not null check (length(trim(body)) between 1 and 20000),
  published_by    uuid references core.profiles (id) on delete set null,
  published_at    timestamptz not null default now(),
  primary key (bot_id, number),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.terms is 'Las condiciones de cada bot, con sus versiones. Cada contacto guarda cuál aceptó. Solo se agregan.';

create trigger terms_organizacion before insert on bots.terms
  for each row execute function core.completar_organizacion_campana();
create trigger terms_solo_agregar before update on bots.terms
  for each row execute function bots.solo_agregar();

-- ── Contactos, conversaciones y mensajes ────────────────────────────────────────────────────────

create table bots.contacts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  campaign_id       uuid not null,
  bot_id            uuid not null,
  channel_kind      text not null check (channel_kind in ('web', 'landing', 'whatsapp')),
  external_id_hash  text not null check (external_id_hash ~ '^[0-9a-f]{64}$'),
  name              text check (name is null or length(name) <= 120),
  data              jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 4000),
  terms_number      integer check (terms_number is null or terms_number >= 1),
  terms_accepted_at timestamptz,
  verified_at       timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (bot_id, external_id_hash),
  unique (id, campaign_id),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.contacts is 'Quien le escribe al bot. external_id_hash: HMAC-SHA256 del id del canal con BOTS_HASH_SECRET (el mismo navegador o teléfono da siempre el mismo valor y no se revierte sin la clave).';

create trigger contacts_organizacion before insert or update of campaign_id, organization_id on bots.contacts
  for each row execute function core.completar_organizacion_campana();

create table bots.sessions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  campaign_id      uuid not null,
  bot_id           uuid not null,
  contact_id       uuid not null,
  channel_kind     text not null check (channel_kind in ('web', 'landing', 'whatsapp')),
  version_id       uuid,
  state            text not null default 'bot' check (state in ('bot', 'derivada', 'en_atencion', 'cerrada')),
  engine_state     jsonb not null default '{}' check (jsonb_typeof(engine_state) = 'object' and octet_length(engine_state::text) <= 60000),
  current_box      text check (current_box is null or length(current_box) <= 40),
  assigned_to      uuid references core.profiles (id) on delete set null,
  handoff_at       timestamptz,
  handoff_reason   text check (handoff_reason is null or length(handoff_reason) <= 200),
  handoff_box      text check (handoff_box is null or length(handoff_box) <= 40),
  last_contact_at  timestamptz,
  last_team_at     timestamptz,
  verified         boolean not null default false,
  seq              integer not null default 0 check (seq >= 0),
  started_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, campaign_id),
  foreign key (contact_id, campaign_id) references bots.contacts (id, campaign_id) on delete cascade,
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (version_id, campaign_id) references bots.versions (id, campaign_id) on delete set null (version_id),
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.sessions is 'Cada conversación de un contacto con un bot: estado (bot, derivada, en_atencion, cerrada), el estado del motor y quién la atiende. seq = cantidad de mensajes (dos turnos a la vez no se pisan).';
create index sessions_campana on bots.sessions (campaign_id, updated_at desc);
create index sessions_contacto on bots.sessions (contact_id, started_at desc);
create index sessions_abiertas on bots.sessions (campaign_id, handoff_at) where state in ('derivada', 'en_atencion');

create trigger sessions_organizacion before insert or update of campaign_id, organization_id on bots.sessions
  for each row execute function core.completar_organizacion_campana();

create table bots.messages (
  session_id         uuid not null,
  organization_id    uuid not null,
  campaign_id        uuid not null,
  n                  integer not null check (n >= 1),
  author             text not null check (author in ('contacto', 'bot', 'agente', 'sistema')),
  profile_id         uuid references core.profiles (id) on delete set null,
  kind               text not null default 'texto' check (kind in ('texto', 'opcion', 'inicio')),
  text               text check (text is null or length(text) <= 5000),
  payload            jsonb check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8000)),
  box_id             text check (box_id is null or length(box_id) <= 40),
  decision           jsonb check (decision is null or (jsonb_typeof(decision) = 'object' and octet_length(decision::text) <= 8000)),
  version_id         uuid,
  channel_message_id text check (channel_message_id is null or channel_message_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  sampled            boolean not null default false,
  created_at         timestamptz not null default now(),
  primary key (session_id, n),
  unique (session_id, channel_message_id),
  foreign key (session_id, campaign_id) references bots.sessions (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.messages is 'Cada mensaje de una conversación con la decisión del bot. text y payload se vacían a los días de guardado del bot o a pedido; channel_message_id descarta los reintentos.';
create index messages_muestra on bots.messages (campaign_id, created_at desc) where sampled;

create trigger messages_organizacion before insert on bots.messages
  for each row execute function core.completar_organizacion_campana();

create table bots.events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  campaign_id     uuid not null,
  bot_id          uuid not null,
  version_id      uuid,
  channel_kind    text not null check (channel_kind in ('web', 'landing', 'whatsapp')),
  session_id      uuid,
  contact_hash    text check (contact_hash is null or contact_hash ~ '^[0-9a-f]{64}$'),
  name            text not null check (name in (
    'sesion_iniciada', 'caja_mostrada', 'opcion_elegida', 'texto_recibido', 'interpretado', 'respondido_con_base', 'valoracion', 'derivada',
    'estado_mensaje', 'llamada_motor', 'regla', 'aclaracion', 'sin_motor', 'boton_viejo', 'dato_guardado', 'dato_invalido', 'baja', 'tope_pasos',
    'tramite_electoral', 'dato_cortado', 'solo_menus', 'condiciones_aceptadas'
  )),
  box_id          text check (box_id is null or length(box_id) <= 40),
  data            jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2000),
  occurred_at     timestamptz not null default now(),
  foreign key (bot_id, campaign_id) references bots.bots (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.events is 'Analítica del bot, sin textos de personas (contact_hash en lugar del contacto). Solo se agrega.';
create index events_bot on bots.events (bot_id, occurred_at desc);

create trigger events_organizacion before insert on bots.events
  for each row execute function core.completar_organizacion_campana();
create trigger events_solo_agregar before update on bots.events
  for each row execute function bots.solo_agregar();

-- Conteos por ventana fija. Las claves llevan HMAC (ip:<hash>:m, ct:<hash>:d, bot:<id>:d): ningún dato de persona.
create table bots.rate_limits (
  key          text not null check (length(key) between 3 and 200),
  window_start timestamptz not null,
  count        integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);
comment on table bots.rate_limits is 'Conteos de mensajes del canal web por IP, contacto y bot. Solo los toca la app pública; se limpian con las tareas de fondo.';

-- ── Forma de las filas para la app (los mismos nombres que dominio/conversaciones.ts) ──────────

create or replace function bots.json_contacto(c bots.contacts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'botId', c.bot_id, 'campanaId', c.campaign_id, 'canal', c.channel_kind, 'hash', c.external_id_hash, 'nombre', c.name, 'datos', c.data,
    'condicionesVersion', c.terms_number, 'condicionesAceptadasEn', c.terms_accepted_at, 'verificadoEn', c.verified_at, 'creadoEn', c.created_at, 'borradoEn', c.deleted_at)
$$;

create or replace function bots.json_conversacion(s bots.sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'botId', s.bot_id, 'campanaId', s.campaign_id, 'contactoId', s.contact_id, 'canal', s.channel_kind, 'versionId', s.version_id, 'estado', s.state,
    'sesion', s.engine_state, 'cajaActual', s.current_box, 'asignadaA', s.assigned_to, 'derivadaEn', s.handoff_at, 'motivoDerivacion', s.handoff_reason,
    'cajaDerivacion', s.handoff_box, 'ultimoDelContacto', s.last_contact_at, 'ultimoDelEquipo', s.last_team_at, 'verificada', s.verified, 'seq', s.seq,
    'iniciadaEn', s.started_at, 'actualizadaEn', s.updated_at)
$$;

create or replace function bots.json_mensaje(m bots.messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'conversacionId', m.session_id, 'n', m.n, 'autor', m.author, 'personaId', m.profile_id, 'tipo', m.kind, 'texto', m.text, 'datos', m.payload,
    'cajaId', m.box_id, 'decision', m.decision, 'versionId', m.version_id, 'idCanal', m.channel_message_id, 'muestra', m.sampled, 'creadoEn', m.created_at)
$$;

-- ── Funciones del equipo: pausa, canal web y condiciones ────────────────────────────────────────

-- Pausar o reanudar el bot (publicar). En pausa no contesta en ningún canal: lo que llega va a la bandeja.
create or replace function bots.pausar(bot uuid, pausar boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot for update;
  perform bots.exigir(b.campaign_id, 'publicar');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  if pausar and b.status <> 'publicado' then
    raise exception 'Solo se pausa un bot publicado.' using errcode = '23514';
  end if;
  if not pausar and b.status <> 'pausado' then
    raise exception 'El bot no está en pausa.' using errcode = '23514';
  end if;
  update bots.bots set status = case when pausar then 'pausado' else 'publicado' end where id = bot;
  perform bots.anotar(b.organization_id, case when pausar then 'bots.pausar' else 'bots.reanudar' end, b.name, jsonb_build_object('bot', bot));
end $$;

-- El canal web del bot (configurar_canales).
create or replace function bots.guardar_canal_web(bot uuid, activo boolean, modo_condiciones text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  if modo_condiciones not in ('aviso', 'acepto') then
    raise exception 'Modo de condiciones inválido.' using errcode = '22023';
  end if;
  insert into bots.channels (campaign_id, bot_id, kind, status, config)
  values (b.campaign_id, bot, 'web', case when activo then 'activo' else 'apagado' end, jsonb_build_object('modo_condiciones', modo_condiciones))
  on conflict (bot_id, kind) do update set status = excluded.status, config = excluded.config;
  perform bots.anotar(b.organization_id, 'bots.canal_web', b.name, jsonb_build_object('bot', bot, 'activo', activo, 'condiciones', modo_condiciones));
end $$;

-- Publica una versión nueva de las condiciones (configurar_canales). Devuelve su número.
create or replace function bots.publicar_condiciones(bot uuid, texto text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  numero integer;
begin
  select * into b from bots.bots x where x.id = bot for update;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  select coalesce(max(t.number), 0) + 1 into numero from bots.terms t where t.bot_id = bot;
  insert into bots.terms (campaign_id, bot_id, number, body, published_by) values (b.campaign_id, bot, numero, trim(texto), auth.uid());
  perform bots.anotar(b.organization_id, 'bots.condiciones', b.name, jsonb_build_object('bot', bot, 'version', numero));
  return numero;
end $$;

-- ── Funciones de la app pública (solo la clave de servicio) ─────────────────────────────────────

-- El bot por su id público: la versión publicada, el canal y las condiciones. null si no existe.
create or replace function bots.publico_bot(id_publico text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  r jsonb;
begin
  select * into b from bots.bots x where x.public_id = id_publico;
  if b.id is null then
    return null;
  end if;
  select jsonb_build_object(
    'bot', jsonb_build_object(
      'id', b.id, 'campanaId', b.campaign_id, 'organizacionId', b.organization_id, 'nombre', b.name, 'idPublico', b.public_id, 'caso', b.use_case,
      'mercado', b.market, 'estado', b.status, 'versionPublicadaId', b.published_version_id, 'trato', b.treatment, 'avisoIa', b.ai_notice_text,
      'personalizacion', b.personalization, 'diasGuardado', b.retention_days, 'topeDiarioUsd', b.daily_cap_usd, 'topeMensualUsd', b.monthly_cap_usd,
      'creadoPor', b.created_by, 'creadoEn', b.created_at, 'actualizadoEn', b.updated_at, 'archivadoEn', b.archived_at),
    'campana', (select jsonb_build_object('nombre', c.name, 'zonaHoraria', c.timezone) from core.campaigns c where c.id = b.campaign_id),
    'organizacionDemo', coalesce((select o.is_demo from core.organizations o where o.id = b.organization_id), false),
    'version', (select jsonb_build_object('id', v.id, 'numero', v.number, 'definicion', v.definition) from bots.versions v where v.id = b.published_version_id),
    'publicadoDesde', (select min(e.created_at) from bots.publication_events e where e.bot_id = b.id and e.action = 'aprobado'),
    'canal', coalesce(
      (select jsonb_build_object('activo', ch.status = 'activo', 'modoCondiciones', coalesce(ch.config ->> 'modo_condiciones', 'aviso')) from bots.channels ch where ch.bot_id = b.id and ch.kind = 'web'),
      jsonb_build_object('activo', true, 'modoCondiciones', 'aviso')),
    'condiciones', (select jsonb_build_object('numero', t.number, 'texto', t.body) from bots.terms t where t.bot_id = b.id order by t.number desc limit 1)
  ) into r;
  return r;
end $$;

-- Suma uno a cada conteo (ventanas fijas) y devuelve cómo quedó cada uno.
create or replace function bots.publico_contar(claves text[], ventanas integer[], ahora timestamptz) returns integer[]
language plpgsql security definer set search_path = '' as $$
declare
  r integer[] := '{}';
  n integer;
  i integer;
  inicio timestamptz;
begin
  if coalesce(array_length(claves, 1), 0) <> coalesce(array_length(ventanas, 1), 0) or coalesce(array_length(claves, 1), 0) > 20 then
    raise exception 'Conteos inválidos.' using errcode = '22023';
  end if;
  for i in 1 .. coalesce(array_length(claves, 1), 0) loop
    inicio := to_timestamp(floor(extract(epoch from ahora) / ventanas[i]) * ventanas[i]);
    insert into bots.rate_limits (key, window_start, count) values (claves[i], inicio, 1)
    on conflict (key, window_start) do update set count = bots.rate_limits.count + 1
    returning count into n;
    r := r || n;
  end loop;
  return r;
end $$;

-- La conversación abierta más nueva del contacto con el bot, sin crear nada.
create or replace function bots.publico_buscar_conversacion(bot uuid, hash text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c bots.contacts%rowtype;
  s bots.sessions%rowtype;
begin
  select * into c from bots.contacts x where x.bot_id = bot and x.external_id_hash = hash;
  if c.id is null then
    return null;
  end if;
  select * into s from bots.sessions x where x.contact_id = c.id and x.state <> 'cerrada' order by x.started_at desc limit 1;
  if s.id is null then
    return null;
  end if;
  return jsonb_build_object('conversacion', bots.json_conversacion(s), 'contacto', bots.json_contacto(c));
end $$;

-- La conversación del contacto (o una nueva). La que atendía el bot y lleva 30 minutos sin mensajes se cierra y empieza
-- otra; una derivada o en atención sigue. La verificación anti-robots del contacto vale 24 horas.
create or replace function bots.publico_abrir_conversacion(bot uuid, hash text, canal text, verificado_ahora boolean, ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  c bots.contacts%rowtype;
  s bots.sessions%rowtype;
  verificada boolean;
  nueva boolean := false;
begin
  select * into b from bots.bots x where x.id = bot;
  if b.id is null or b.published_version_id is null or b.status not in ('publicado', 'pausado') then
    raise exception 'No existe el bot o la campaña.' using errcode = 'P0002';
  end if;
  insert into bots.contacts (campaign_id, bot_id, channel_kind, external_id_hash)
  values (b.campaign_id, bot, canal, hash)
  on conflict (bot_id, external_id_hash) do nothing;
  select * into c from bots.contacts x where x.bot_id = bot and x.external_id_hash = hash for update;
  if verificado_ahora then
    update bots.contacts set verified_at = ahora where id = c.id returning * into c;
  end if;
  verificada := c.verified_at is not null and c.verified_at >= ahora - interval '24 hours';
  select * into s from bots.sessions x where x.contact_id = c.id and x.state <> 'cerrada' order by x.started_at desc limit 1 for update;
  if s.id is not null and s.state = 'bot' and s.updated_at < ahora - interval '30 minutes' then
    update bots.sessions set state = 'cerrada' where id = s.id;
    s := null;
  end if;
  if s.id is null then
    insert into bots.sessions (campaign_id, bot_id, contact_id, channel_kind, version_id, engine_state, verified, started_at, updated_at)
    values (b.campaign_id, bot, c.id, canal, b.published_version_id,
            '{"espera": null, "variables": {}, "estado": "bot", "turnos": [], "iniciada": false}'::jsonb, verificada, ahora, ahora)
    returning * into s;
    nueva := true;
  elsif verificada and not s.verified then
    update bots.sessions set verified = true where id = s.id returning * into s;
  end if;
  return jsonb_build_object('conversacion', bots.json_conversacion(s), 'contacto', bots.json_contacto(c), 'nueva', nueva);
end $$;

create or replace function bots.publico_mensajes(sesion uuid, desde integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(bots.json_mensaje(m) order by m.n), '[]'::jsonb) from bots.messages m where m.session_id = sesion and m.n > desde
$$;

create or replace function bots.publico_mensaje_por_id(sesion uuid, id_canal text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select bots.json_mensaje(m) from bots.messages m where m.session_id = sesion and m.channel_message_id = id_canal
$$;

-- Guarda un turno entero en una transacción: el mensaje de la persona, lo que contestó el bot, el estado del motor, los
-- datos que dio y los eventos. Si la conversación ya no está en seq_esperada, corta (40001) y la app lo reintenta.
create or replace function bots.publico_guardar_turno(sesion uuid, seq_esperada integer, turno jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  c bots.contacts%rowtype;
  ahora timestamptz := coalesce((turno ->> 'ahora')::timestamptz, now());
  n integer;
  primero boolean := true;
  m jsonb;
  e jsonb;
  k text;
  v text;
  desde integer;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  if s.id is null then
    raise exception 'No existe la conversación.' using errcode = 'P0002';
  end if;
  if s.seq <> seq_esperada then
    raise exception 'La conversación cambió mientras se contestaba.' using errcode = '40001';
  end if;
  desde := s.seq;
  n := s.seq;
  if turno -> 'entrante' is not null and jsonb_typeof(turno -> 'entrante') = 'object' then
    n := n + 1;
    insert into bots.messages (session_id, campaign_id, n, author, kind, text, payload, version_id, channel_message_id, created_at)
    values (sesion, s.campaign_id, n, 'contacto', turno -> 'entrante' ->> 'tipo', turno -> 'entrante' ->> 'texto',
            nullif(turno -> 'entrante' -> 'datos', 'null'::jsonb), (turno ->> 'versionId')::uuid, turno -> 'entrante' ->> 'idCanal', ahora);
  end if;
  for m in select * from jsonb_array_elements(coalesce(turno -> 'salientes', '[]'::jsonb)) loop
    n := n + 1;
    insert into bots.messages (session_id, campaign_id, n, author, kind, text, payload, box_id, decision, version_id, sampled, created_at)
    values (sesion, s.campaign_id, n, m ->> 'autor', 'texto', m ->> 'texto', nullif(m -> 'datos', 'null'::jsonb), m ->> 'cajaId',
            case when primero and m ->> 'autor' = 'bot' then nullif(turno -> 'decision', 'null'::jsonb) end, (turno ->> 'versionId')::uuid,
            primero and m ->> 'autor' = 'bot' and coalesce((turno ->> 'muestra')::boolean, false), ahora);
    if m ->> 'autor' = 'bot' then
      primero := false;
    end if;
  end loop;
  update bots.sessions set
    seq = n, engine_state = turno -> 'sesion', state = turno ->> 'estado', current_box = turno ->> 'cajaActual',
    version_id = coalesce((turno ->> 'versionId')::uuid, version_id), updated_at = ahora,
    last_contact_at = case when turno -> 'entrante' is not null and jsonb_typeof(turno -> 'entrante') = 'object' then ahora else last_contact_at end,
    handoff_at = case when jsonb_typeof(turno -> 'derivacion') = 'object' then ahora else handoff_at end,
    handoff_reason = case when jsonb_typeof(turno -> 'derivacion') = 'object' then left(turno -> 'derivacion' ->> 'motivo', 200) else handoff_reason end,
    handoff_box = case when jsonb_typeof(turno -> 'derivacion') = 'object' then turno -> 'derivacion' ->> 'cajaId' else handoff_box end
  where id = sesion;
  select * into c from bots.contacts x where x.id = s.contact_id for update;
  for k, v in select * from jsonb_each_text(coalesce(turno -> 'datosContacto', '{}'::jsonb)) loop
    update bots.contacts set data = data || jsonb_build_object(k, left(v, 500)), name = case when k = 'contacto.nombre' then left(v, 120) else name end where id = c.id;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(turno -> 'eventos', '[]'::jsonb)) loop
    insert into bots.events (campaign_id, bot_id, version_id, channel_kind, session_id, contact_hash, name, box_id, data, occurred_at)
    values (s.campaign_id, s.bot_id, coalesce((turno ->> 'versionId')::uuid, s.version_id), s.channel_kind, sesion, c.external_id_hash,
            e ->> 'nombre', e ->> 'cajaId', coalesce(e -> 'datos', '{}'::jsonb), ahora);
  end loop;
  return bots.publico_mensajes(sesion, desde);
end $$;

create or replace function bots.publico_aceptar_condiciones(contacto uuid, numero integer, ahora timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update bots.contacts set terms_number = numero, terms_accepted_at = ahora where id = contacto;
  if not found then
    raise exception 'No existe el contacto.' using errcode = 'P0002';
  end if;
end $$;

-- ── Lecturas del equipo que no son una tabla ────────────────────────────────────────────────────

create or replace function bots.canal_web(bot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'ver');
  return coalesce(
    (select jsonb_build_object('activo', ch.status = 'activo', 'modoCondiciones', coalesce(ch.config ->> 'modo_condiciones', 'aviso')) from bots.channels ch where ch.bot_id = bot and ch.kind = 'web'),
    jsonb_build_object('activo', true, 'modoCondiciones', 'aviso'));
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.channels enable row level security;
alter table bots.terms enable row level security;
alter table bots.contacts enable row level security;
alter table bots.sessions enable row level security;
alter table bots.messages enable row level security;
alter table bots.events enable row level security;
alter table bots.rate_limits enable row level security;

create policy "canales: los ve quien entra al producto" on bots.channels for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "condiciones: las ve quien entra al producto" on bots.terms for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "contactos: los ve quien lee conversaciones" on bots.contacts for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('leer_conversaciones')));
create policy "conversaciones: las ve quien lee conversaciones" on bots.sessions for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('leer_conversaciones')));
create policy "mensajes: los ve quien lee conversaciones" on bots.messages for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('leer_conversaciones')));
create policy "eventos: los ve quien entra al producto" on bots.events for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
-- rate_limits: sin reglas para personas (solo la app pública, con la clave de servicio).

grant select on bots.channels, bots.terms, bots.contacts, bots.sessions, bots.messages, bots.events to authenticated;
grant all on bots.channels, bots.terms, bots.contacts, bots.sessions, bots.messages, bots.events, bots.rate_limits to service_role;
grant usage, select on all sequences in schema bots to service_role;
revoke update, delete, truncate on bots.terms, bots.events from service_role;

revoke execute on function bots.json_contacto(bots.contacts), bots.json_conversacion(bots.sessions), bots.json_mensaje(bots.messages) from public;
revoke execute on function bots.pausar(uuid, boolean), bots.guardar_canal_web(uuid, boolean, text), bots.publicar_condiciones(uuid, text), bots.canal_web(uuid) from public;
grant execute on function bots.pausar(uuid, boolean), bots.guardar_canal_web(uuid, boolean, text), bots.publicar_condiciones(uuid, text), bots.canal_web(uuid) to authenticated;
revoke execute on function bots.publico_bot(text), bots.publico_contar(text[], integer[], timestamptz), bots.publico_buscar_conversacion(uuid, text),
  bots.publico_abrir_conversacion(uuid, text, text, boolean, timestamptz), bots.publico_mensajes(uuid, integer), bots.publico_mensaje_por_id(uuid, text),
  bots.publico_guardar_turno(uuid, integer, jsonb), bots.publico_aceptar_condiciones(uuid, integer, timestamptz) from public;
grant execute on function bots.publico_bot(text), bots.publico_contar(text[], integer[], timestamptz), bots.publico_buscar_conversacion(uuid, text),
  bots.publico_abrir_conversacion(uuid, text, text, boolean, timestamptz), bots.publico_mensajes(uuid, integer), bots.publico_mensaje_por_id(uuid, text),
  bots.publico_guardar_turno(uuid, integer, jsonb), bots.publico_aceptar_condiciones(uuid, integer, timestamptz) to service_role;

commit;
