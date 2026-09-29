-- BotMaker · 0008 · WhatsApp (plan técnico, etapa 7: tareas 7.02 a 7.04, 7.06 y 7.07).
--
--  - bots.channels (kind 'whatsapp'): la clave de 360dialog va a Vault (vault_secret_id es solo la referencia) y del
--    secreto del aviso se guarda solo su SHA-256. La salud del canal (último mensaje, último error) y el número visible.
--  - bots.channel_inbox: la cola de lo que avisa 360dialog. La clave primaria descarta los reintentos (360dialog reintenta
--    hasta 7 días); al procesar se borra lo que traía de la persona y queda la clave.
--  - bots.outbound: la cola de lo que sale por WhatsApp, un registro por parte de cada mensaje, con su estado (por
--    enviar, enviado, entregado, leído, no se envió), los intentos y el próximo intento (espera creciente).
--  - bots.channel_stats: contadores por canal y día (recibidos, repetidos, enviados, entregados, leídos, fallidos y la
--    demora del aviso).
--  - bots.templates: el espejo de las plantillas de la cuenta de 360dialog (las que se crean en BotMaker y las otras),
--    con su estado en Meta. Las aprobadas son las que la bandeja ofrece con la ventana de 24 horas cerrada.
--  - bots.sessions.window_expires_at: hasta cuándo se le puede escribir a la persona sin plantilla.
--  - bots.contacts.phone y profile_name: el número y el nombre de perfil de WhatsApp (decisión del 29/9: se guardan para
--    la base de contactos; el número lo ve quien atiende conversaciones). Ya no se vacían al vencer el guardado del bot:
--    el texto de los mensajes sí.
--
-- La app pública (clave de servicio) usa solo las funciones bots.publico_* y bots.servicio_clave_whatsapp.

begin;

-- ── Canal, conversación y contacto ──────────────────────────────────────────────────────────────

alter table bots.channels
  add column vault_secret_id uuid,
  add column webhook_secret_hash text check (webhook_secret_hash is null or webhook_secret_hash ~ '^[0-9a-f]{64}$'),
  add column display_number text check (display_number is null or length(display_number) <= 30),
  add column webhook_url text check (webhook_url is null or length(webhook_url) <= 300),
  add column connected_at timestamptz,
  add column last_inbound_at timestamptz,
  add column last_error text check (last_error is null or length(last_error) <= 300),
  add column last_error_at timestamptz,
  add column templates_checked_at timestamptz,
  add unique (id, campaign_id);
comment on column bots.channels.vault_secret_id is 'WhatsApp: la referencia a la clave de 360dialog en Vault. La clave nunca está en una tabla.';
comment on column bots.channels.webhook_secret_hash is 'WhatsApp: SHA-256 del secreto que 360dialog manda en el encabezado x-botmaker-secreto.';

alter table bots.sessions add column window_expires_at timestamptz;
comment on column bots.sessions.window_expires_at is 'WhatsApp: 24 horas desde el último mensaje de la persona. Después, solo plantillas.';

alter table bots.contacts
  add column phone text check (phone is null or phone ~ '^[0-9]{7,15}$'),
  add column profile_name text check (profile_name is null or length(profile_name) <= 120);
comment on column bots.contacts.phone is 'WhatsApp: el número de la persona (solo dígitos). Lo devuelve json_contacto a quien atiende conversaciones.';

-- ── Colas y salud ───────────────────────────────────────────────────────────────────────────────

create table bots.channel_inbox (
  channel_id      uuid not null,
  key             text not null check (length(key) between 3 and 300),
  organization_id uuid not null,
  campaign_id     uuid not null,
  kind            text not null check (kind in ('mensaje', 'estado')),
  payload         jsonb check (payload is null or (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 12000)),
  received_at     timestamptz not null default now(),
  taken_at        timestamptz,
  processed_at    timestamptz,
  attempts        integer not null default 0 check (attempts >= 0),
  primary key (channel_id, key),
  foreign key (channel_id, campaign_id) references bots.channels (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.channel_inbox is 'Lo que avisa 360dialog, para procesarlo aparte. La clave descarta los reintentos; payload se vacía al procesar.';
create index channel_inbox_pendientes on bots.channel_inbox (channel_id, received_at) where processed_at is null;

create table bots.outbound (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  campaign_id     uuid not null,
  channel_id      uuid not null,
  session_id      uuid not null,
  n               integer not null,
  part            smallint not null default 0 check (part between 0 and 20),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 12000),
  status          text not null default 'pendiente' check (status in ('pendiente', 'enviando', 'enviado', 'entregado', 'leido', 'fallido')),
  provider_id     text unique check (provider_id is null or length(provider_id) <= 256),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error      text check (last_error is null or length(last_error) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (session_id, n, part),
  foreign key (session_id, n) references bots.messages (session_id, n) on delete cascade,
  foreign key (channel_id, campaign_id) references bots.channels (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.outbound is 'Lo que sale por WhatsApp: una fila por parte de cada mensaje, con su estado y sus reintentos.';
create index outbound_pendientes on bots.outbound (next_attempt_at) where status in ('pendiente', 'enviando');
create index outbound_canal on bots.outbound (channel_id, created_at desc);

create table bots.channel_stats (
  channel_id       uuid not null,
  day              date not null,
  organization_id  uuid not null,
  campaign_id      uuid not null,
  received         integer not null default 0,
  duplicates       integer not null default 0,
  sent             integer not null default 0,
  delivered        integer not null default 0,
  read             integer not null default 0,
  failed           integer not null default 0,
  webhooks         integer not null default 0,
  webhook_ms_total bigint not null default 0,
  webhook_ms_max   integer not null default 0,
  primary key (channel_id, day),
  foreign key (channel_id, campaign_id) references bots.channels (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.channel_stats is 'La salud de cada canal de WhatsApp por día (UTC).';

create table bots.templates (
  channel_id      uuid not null,
  name            text not null check (length(name) between 1 and 512 and name ~ '^[a-z0-9_]+$'),
  language        text not null check (length(language) between 2 and 10),
  organization_id uuid not null,
  campaign_id     uuid not null,
  provider_id     text check (provider_id is null or length(provider_id) <= 100),
  category        text not null default '' check (length(category) <= 30),
  status          text not null check (status in ('en_revision', 'aprobada', 'rechazada', 'pausada', 'deshabilitada', 'otro')),
  reason          text check (reason is null or length(reason) <= 300),
  body            text not null default '' check (length(body) <= 1100),
  format          text not null default 'posicional' check (format in ('posicional', 'nombre')),
  variables       jsonb not null default '[]' check (jsonb_typeof(variables) = 'array'),
  usable          boolean not null default false,
  notice          text check (notice is null or length(notice) <= 300),
  created_by      uuid references core.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  checked_at      timestamptz,
  primary key (channel_id, name, language),
  foreign key (channel_id, campaign_id) references bots.channels (id, campaign_id) on delete cascade,
  foreign key (campaign_id, organization_id) references bots.campaign_settings (id, organization_id) on delete cascade
);
comment on table bots.templates is 'Espejo de las plantillas de la cuenta de 360dialog del canal, con su estado en Meta. created_by: si se creó en BotMaker.';

-- ── Forma de las filas (se reemplazan: suman lo de WhatsApp) ────────────────────────────────────

-- El número de la persona solo para quien atiende conversaciones (o sin sesión: la app pública).
create or replace function bots.json_contacto(c bots.contacts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'botId', c.bot_id, 'campanaId', c.campaign_id, 'canal', c.channel_kind, 'hash', c.external_id_hash, 'nombre', c.name, 'datos', c.data,
    'condicionesVersion', c.terms_number, 'condicionesAceptadasEn', c.terms_accepted_at, 'verificadoEn', c.verified_at, 'creadoEn', c.created_at, 'borradoEn', c.deleted_at,
    'nombrePerfil', c.profile_name,
    'telefono', case when auth.uid() is null or bots.puede(c.campaign_id, 'responder_conversaciones') then c.phone end)
$$;

create or replace function bots.json_conversacion(s bots.sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'botId', s.bot_id, 'campanaId', s.campaign_id, 'contactoId', s.contact_id, 'canal', s.channel_kind, 'versionId', s.version_id, 'estado', s.state,
    'sesion', s.engine_state, 'cajaActual', s.current_box, 'asignadaA', s.assigned_to, 'derivadaEn', s.handoff_at, 'motivoDerivacion', s.handoff_reason,
    'cajaDerivacion', s.handoff_box, 'ultimoDelContacto', s.last_contact_at, 'ultimoDelEquipo', s.last_team_at, 'verificada', s.verified, 'seq', s.seq,
    'iniciadaEn', s.started_at, 'actualizadaEn', s.updated_at, 'ventanaHasta', s.window_expires_at)
$$;

-- El estado de envío de un mensaje: el de su parte más atrasada; fallido gana.
create or replace function bots.estado_envio(sesion uuid, numero integer) returns text
language sql stable set search_path = '' as $$
  select case
    when count(*) = 0 then null
    when bool_or(o.status = 'fallido') then 'fallido'
    else (array['pendiente', 'enviado', 'entregado', 'leido'])[min(case o.status when 'enviado' then 2 when 'entregado' then 3 when 'leido' then 4 else 1 end)]
  end
  from bots.outbound o where o.session_id = sesion and o.n = numero
$$;

create or replace function bots.json_mensaje(m bots.messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'conversacionId', m.session_id, 'n', m.n, 'autor', m.author, 'personaId', m.profile_id, 'tipo', m.kind, 'texto', m.text, 'datos', m.payload,
    'cajaId', m.box_id, 'decision', m.decision, 'versionId', m.version_id, 'idCanal', m.channel_message_id, 'muestra', m.sampled, 'creadoEn', m.created_at,
    'envio', bots.estado_envio(m.session_id, m.n))
$$;

-- ── Ayudas internas ─────────────────────────────────────────────────────────────────────────────

-- Suma a la salud del canal en el día (UTC).
create or replace function bots.sumar_salud(canal uuid, ahora timestamptz, recibidos integer, repetidos integer, enviados integer, entregados integer,
                                            leidos integer, fallidos integer, demora_ms integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch bots.channels%rowtype;
begin
  select * into ch from bots.channels x where x.id = canal;
  if ch.id is null then
    return;
  end if;
  insert into bots.channel_stats (channel_id, day, organization_id, campaign_id, received, duplicates, sent, delivered, read, failed, webhooks, webhook_ms_total, webhook_ms_max)
  values (canal, (ahora at time zone 'UTC')::date, ch.organization_id, ch.campaign_id, recibidos, repetidos, enviados, entregados, leidos, fallidos,
          case when demora_ms is null then 0 else 1 end, coalesce(demora_ms, 0), coalesce(demora_ms, 0))
  on conflict (channel_id, day) do update set
    received = bots.channel_stats.received + excluded.received, duplicates = bots.channel_stats.duplicates + excluded.duplicates,
    sent = bots.channel_stats.sent + excluded.sent, delivered = bots.channel_stats.delivered + excluded.delivered,
    read = bots.channel_stats.read + excluded.read, failed = bots.channel_stats.failed + excluded.failed,
    webhooks = bots.channel_stats.webhooks + excluded.webhooks, webhook_ms_total = bots.channel_stats.webhook_ms_total + excluded.webhook_ms_total,
    webhook_ms_max = greatest(bots.channel_stats.webhook_ms_max, excluded.webhook_ms_max);
end $$;

-- Encola las partes de un mensaje que sale por WhatsApp (o las deja como no enviadas, con el motivo).
create or replace function bots.encolar_envio(sesion uuid, numero integer, envios jsonb, ahora timestamptz, fallido text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  canal uuid;
  p jsonb;
  parte integer := 0;
begin
  select * into s from bots.sessions x where x.id = sesion;
  select ch.id into canal from bots.channels ch where ch.bot_id = s.bot_id and ch.kind = 'whatsapp';
  if canal is null or s.channel_kind <> 'whatsapp' or envios is null or jsonb_typeof(envios) <> 'array' then
    return;
  end if;
  for p in select * from jsonb_array_elements(envios) loop
    insert into bots.outbound (organization_id, campaign_id, channel_id, session_id, n, part, payload, status, last_error, next_attempt_at, created_at, updated_at)
    values (s.organization_id, s.campaign_id, canal, sesion, numero, parte, p, case when fallido is null then 'pendiente' else 'fallido' end, left(fallido, 300), ahora, ahora, ahora);
    parte := parte + 1;
  end loop;
end $$;

-- ── Funciones del equipo ────────────────────────────────────────────────────────────────────────

-- El canal de WhatsApp del bot con su salud de los últimos 7 días (ver). null si nunca se conectó.
create or replace function bots.canal_whatsapp(bot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  ch bots.channels%rowtype;
  desde date := (now() at time zone 'UTC')::date - 6;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'ver');
  select * into ch from bots.channels x where x.bot_id = bot and x.kind = 'whatsapp';
  if ch.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', ch.id, 'botId', ch.bot_id, 'estado', ch.status, 'numero', ch.display_number, 'webhookUrl', ch.webhook_url, 'conectadoEn', ch.connected_at,
    'ultimoRecibido', ch.last_inbound_at, 'ultimoError', ch.last_error, 'ultimoErrorEn', ch.last_error_at,
    'salud', (
      select jsonb_build_object(
        'dias', 7, 'recibidos', coalesce(sum(t.received), 0), 'repetidos', coalesce(sum(t.duplicates), 0), 'enviados', coalesce(sum(t.sent), 0),
        'entregados', coalesce(sum(t.delivered), 0), 'leidos', coalesce(sum(t.read), 0), 'fallidos', coalesce(sum(t.failed), 0),
        'demoraMaxMs', coalesce(max(t.webhook_ms_max), 0),
        'demoraMediaMs', case when coalesce(sum(t.webhooks), 0) = 0 then null else round(sum(t.webhook_ms_total)::numeric / sum(t.webhooks)) end,
        'pendientes', (select count(*) from bots.outbound o where o.channel_id = ch.id and o.status in ('pendiente', 'enviando')))
      from bots.channel_stats t where t.channel_id = ch.id and t.day >= desde),
    'respuestasMes', (
      select count(*) from bots.outbound o
      where o.channel_id = ch.id and o.provider_id is not null and o.payload ->> 'type' <> 'template'
        and date_trunc('month', o.created_at at time zone 'UTC') = date_trunc('month', now() at time zone 'UTC')));
end $$;

-- Conecta (o reconecta) el número (configurar_canales). La clave va a Vault; queda prendido y se cierra la alerta.
create or replace function bots.conectar_whatsapp(bot uuid, clave text, numero text, secreto_hash text, webhook_url text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  ch bots.channels%rowtype;
begin
  select * into b from bots.bots x where x.id = bot for update;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  if b.status = 'archivado' then
    raise exception 'El bot está archivado.' using errcode = '23514';
  end if;
  if length(trim(coalesce(clave, ''))) not between 16 and 256 or coalesce(secreto_hash, '') !~ '^[0-9a-f]{64}$' or length(coalesce(webhook_url, '')) not between 1 and 300 then
    raise exception 'Faltan datos para conectar el canal.' using errcode = '22023';
  end if;
  insert into bots.channels (campaign_id, bot_id, kind, status) values (b.campaign_id, bot, 'whatsapp', 'activo')
  on conflict (bot_id, kind) do nothing;
  select * into ch from bots.channels x where x.bot_id = bot and x.kind = 'whatsapp' for update;
  if ch.vault_secret_id is null then
    ch.vault_secret_id := vault.create_secret(trim(clave), 'botmaker-whatsapp-' || ch.id::text, 'Clave de 360dialog del canal de WhatsApp de un bot de BotMaker');
  else
    perform vault.update_secret(ch.vault_secret_id, trim(clave));
  end if;
  update bots.channels set
    status = 'activo', vault_secret_id = ch.vault_secret_id, webhook_secret_hash = secreto_hash, display_number = nullif(left(trim(coalesce(numero, '')), 30), ''),
    webhook_url = conectar_whatsapp.webhook_url, connected_at = now(), last_error = null, last_error_at = null, templates_checked_at = null
  where id = ch.id;
  update bots.alerts set closed_at = now() where kind = 'canal_desconectado' and ref = ch.id::text and closed_at is null;
  perform bots.anotar(b.organization_id, 'bots.conectar_whatsapp', b.name, jsonb_build_object('bot', bot));
  return ch.id;
end $$;

-- Prender o apagar el canal sin tocar la clave (configurar_canales).
create or replace function bots.prender_whatsapp(bot uuid, activo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  ch bots.channels%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  select * into ch from bots.channels x where x.bot_id = bot and x.kind = 'whatsapp' for update;
  if ch.id is null then
    raise exception 'El bot no tiene WhatsApp conectado.' using errcode = 'P0002';
  end if;
  if activo and ch.status = 'desconectado' then
    raise exception 'El canal está desconectado: hay que volver a conectarlo con una clave que funcione.' using errcode = '23514';
  end if;
  update bots.channels set status = case when activo then 'activo' else 'apagado' end where id = ch.id;
  perform bots.anotar(b.organization_id, 'bots.canal_whatsapp', b.name, jsonb_build_object('bot', bot, 'activo', activo));
end $$;

-- Responder como la campaña: en WhatsApp, solo con la ventana de 24 horas abierta; lo que sale se encola.
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
  if s.channel_kind = 'whatsapp' and (s.window_expires_at is null or s.window_expires_at <= now()) then
    raise exception 'La ventana de 24 horas está cerrada: solo se puede escribir con una plantilla.' using errcode = '23514';
  end if;
  n := s.seq + 1;
  insert into bots.messages (session_id, campaign_id, n, author, profile_id, kind, text) values (sesion, s.campaign_id, n, 'agente', auth.uid(), 'texto', trim(texto));
  update bots.sessions set seq = n, state = 'en_atencion', assigned_to = coalesce(assigned_to, auth.uid()), last_team_at = now(), updated_at = now() where id = sesion;
  if s.channel_kind = 'whatsapp' then
    perform bots.encolar_envio(sesion, n, jsonb_build_array(jsonb_build_object('type', 'text', 'text', jsonb_build_object('body', trim(texto)))), now());
  end if;
  return n;
end $$;

-- Escribir con una plantilla aprobada de la cuenta (responder_conversaciones). Si la atendía el bot, la toma el equipo.
-- plantilla: {"nombre", "idioma", "formato", "variables": [...], "valores": {...}, "texto"}
create or replace function bots.responder_con_plantilla(sesion uuid, plantilla jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  t bots.templates%rowtype;
  n integer;
  v text;
  parametros jsonb := '[]'::jsonb;
  texto text := trim(coalesce(plantilla ->> 'texto', ''));
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  if s.channel_kind <> 'whatsapp' then
    raise exception 'Las plantillas son solo para conversaciones de WhatsApp.' using errcode = '23514';
  end if;
  if s.state = 'cerrada' then
    raise exception 'La conversación está cerrada.' using errcode = '23514';
  end if;
  select tt.* into t from bots.templates tt join bots.channels ch on ch.id = tt.channel_id
  where ch.bot_id = s.bot_id and ch.kind = 'whatsapp' and tt.name = plantilla ->> 'nombre' and tt.language = plantilla ->> 'idioma';
  if t.name is null or not t.usable then
    raise exception 'Esa plantilla no está aprobada o no se puede mandar desde la bandeja.' using errcode = '23514';
  end if;
  for v in select jsonb_array_elements_text(t.variables) loop
    if length(trim(coalesce(plantilla -> 'valores' ->> v, ''))) = 0 then
      raise exception 'Completá todos los espacios de la plantilla.' using errcode = '22023';
    end if;
    parametros := parametros || jsonb_build_array(
      case when t.format = 'nombre'
        then jsonb_build_object('type', 'text', 'parameter_name', v, 'text', left(trim(plantilla -> 'valores' ->> v), 1000))
        else jsonb_build_object('type', 'text', 'text', left(trim(plantilla -> 'valores' ->> v), 1000)) end);
  end loop;
  if length(texto) not between 1 and 4096 then
    raise exception 'La respuesta tiene que tener texto (hasta 4.096 caracteres).' using errcode = '22023';
  end if;
  n := s.seq + 1;
  insert into bots.messages (session_id, campaign_id, n, author, profile_id, kind, text, payload)
  values (sesion, s.campaign_id, n, 'agente', auth.uid(), 'texto', texto, jsonb_build_object('plantilla', t.name));
  update bots.sessions set
    seq = n, state = 'en_atencion', assigned_to = coalesce(assigned_to, auth.uid()), last_team_at = now(), updated_at = now(),
    handoff_at = case when s.state = 'bot' then now() else handoff_at end,
    handoff_reason = case when s.state = 'bot' then 'La retomó el equipo con una plantilla' else handoff_reason end,
    engine_state = case when s.state = 'bot' then engine_state || '{"estado": "derivada", "espera": null}'::jsonb else engine_state end
  where id = sesion;
  perform bots.encolar_envio(sesion, n, jsonb_build_array(jsonb_build_object('type', 'template', 'template', jsonb_build_object(
    'name', t.name, 'language', jsonb_build_object('code', t.language),
    'components', case when jsonb_array_length(parametros) = 0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type', 'body', 'parameters', parametros)) end))), now());
  return n;
end $$;

-- Devolver al bot: lo que dice el bot al volver sale por WhatsApp si la ventana sigue abierta; si no, queda sin enviar.
create or replace function bots.devolver_conversacion(sesion uuid, turno jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s bots.sessions%rowtype;
  c bots.contacts%rowtype;
  n integer;
  primero boolean := true;
  m jsonb;
  e jsonb;
  abierta boolean;
begin
  select * into s from bots.sessions x where x.id = sesion for update;
  perform bots.exigir(s.campaign_id, 'responder_conversaciones');
  if s.state not in ('derivada', 'en_atencion') then
    raise exception 'La conversación no está derivada.' using errcode = '23514';
  end if;
  abierta := s.window_expires_at is not null and s.window_expires_at > now();
  n := s.seq;
  for m in select * from jsonb_array_elements(coalesce(turno -> 'mensajes', '[]'::jsonb)) loop
    n := n + 1;
    insert into bots.messages (session_id, campaign_id, n, author, kind, text, payload, box_id, decision, version_id)
    values (sesion, s.campaign_id, n, 'bot', 'texto', m ->> 'texto', nullif(m -> 'datos', 'null'::jsonb), m ->> 'cajaId',
            case when primero then nullif(turno -> 'decision', 'null'::jsonb) end, s.version_id);
    if s.channel_kind = 'whatsapp' then
      perform bots.encolar_envio(sesion, n, m -> 'envios', now(), case when abierta then null else 'La ventana de 24 horas estaba cerrada: no se mandó.' end);
    end if;
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

-- Las plantillas de la cuenta del canal de WhatsApp del bot (ver).
create or replace function bots.json_plantilla(t bots.templates) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'canalId', t.channel_id, 'id', t.provider_id, 'nombre', t.name, 'idioma', t.language, 'categoria', t.category, 'estado', t.status, 'motivo', t.reason,
    'texto', t.body, 'formato', t.format, 'variables', t.variables, 'usable', t.usable, 'aviso', t.notice, 'creadaPor', t.created_by, 'creadaEn', t.created_at,
    'revisadaEn', t.checked_at)
$$;

create or replace function bots.plantillas(bot uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'ver');
  return coalesce((
    select jsonb_agg(bots.json_plantilla(t) order by t.usable desc, t.name, t.language)
    from bots.templates t join bots.channels ch on ch.id = t.channel_id where ch.bot_id = bot and ch.kind = 'whatsapp'), '[]'::jsonb);
end $$;

-- Anota una plantilla recién creada en 360dialog (configurar_canales).
create or replace function bots.guardar_plantilla_creada(bot uuid, plantilla jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  ch bots.channels%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  select * into ch from bots.channels x where x.bot_id = bot and x.kind = 'whatsapp';
  if ch.id is null then
    raise exception 'El bot no tiene WhatsApp conectado.' using errcode = 'P0002';
  end if;
  insert into bots.templates (channel_id, name, language, organization_id, campaign_id, provider_id, category, status, reason, body, format, variables, usable, notice, created_by, checked_at)
  values (ch.id, plantilla ->> 'nombre', plantilla ->> 'idioma', ch.organization_id, ch.campaign_id, plantilla ->> 'id', coalesce(plantilla ->> 'categoria', ''),
          plantilla ->> 'estado', plantilla ->> 'motivo', coalesce(plantilla ->> 'texto', ''), coalesce(plantilla ->> 'formato', 'posicional'),
          coalesce(plantilla -> 'variables', '[]'::jsonb), coalesce((plantilla ->> 'usable')::boolean, false), plantilla ->> 'aviso', auth.uid(), now())
  on conflict (channel_id, name, language) do update set
    provider_id = excluded.provider_id, category = excluded.category, status = excluded.status, reason = excluded.reason, body = excluded.body,
    format = excluded.format, variables = excluded.variables, usable = excluded.usable, notice = excluded.notice, created_by = excluded.created_by, checked_at = now();
  perform bots.anotar(b.organization_id, 'bots.plantilla', plantilla ->> 'nombre', jsonb_build_object('bot', bot, 'accion', 'crear'));
end $$;

-- Saca una plantilla que se borró en 360dialog (configurar_canales).
create or replace function bots.quitar_plantilla(bot uuid, nombre text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
begin
  select * into b from bots.bots x where x.id = bot;
  perform bots.exigir(b.campaign_id, 'configurar_canales');
  delete from bots.templates t using bots.channels ch where ch.id = t.channel_id and ch.bot_id = bot and ch.kind = 'whatsapp' and t.name = nombre;
  perform bots.anotar(b.organization_id, 'bots.plantilla', nombre, jsonb_build_object('bot', bot, 'accion', 'borrar'));
end $$;

-- Borrar los datos de un contacto a su pedido: también el número y el nombre de perfil.
create or replace function bots.borrar_contacto(contacto uuid, nota text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c bots.contacts%rowtype;
begin
  select * into c from bots.contacts x where x.id = contacto for update;
  perform bots.exigir(c.campaign_id, 'gestionar_datos_contactos');
  update bots.contacts set name = null, data = '{}'::jsonb, phone = null, profile_name = null, deleted_at = now() where id = contacto;
  update bots.messages m set text = null, payload = null from bots.sessions s where s.id = m.session_id and s.contact_id = contacto;
  update bots.sessions set engine_state = engine_state || '{"variables": {}, "turnos": []}'::jsonb, state = 'cerrada', assigned_to = null where contact_id = contacto;
  insert into bots.data_requests (campaign_id, contact_id, kind, note, handled_by) values (c.campaign_id, c.id, 'borrar', left(coalesce(nota, ''), 500), auth.uid());
  perform bots.anotar(c.organization_id, 'bots.datos_contacto', 'borrar', jsonb_build_object('contacto', c.id));
end $$;

-- Buscar contactos: también por número y nombre de perfil.
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
        and (c.id::text = q or c.name ilike '%' || q || '%' or c.data::text ilike '%' || q || '%' or c.profile_name ilike '%' || q || '%'
             or c.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%' and length(regexp_replace(q, '\D', '', 'g')) >= 4
             or exists (select 1 from bots.messages m join bots.sessions s on s.id = m.session_id where s.contact_id = c.id and m.author = 'contacto' and m.text ilike '%' || q || '%'))
      limit 50
    ) c), '[]'::jsonb);
end $$;

-- La bandeja: el contacto trae su nombre de perfil de WhatsApp (se muestra si no dio su nombre) y se busca por él.
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
        'contacto', jsonb_build_object('id', c.id, 'nombre', c.name, 'nombrePerfil', c.profile_name, 'borradoEn', c.deleted_at),
        'ultimo', (select jsonb_build_object('autor', m.author, 'texto', m.text, 'creadoEn', m.created_at) from bots.messages m where m.session_id = s.id order by m.n desc limit 1),
        'mensajes', s.seq) as fila
      from bots.sessions s
      join bots.contacts c on c.id = s.contact_id
      where s.campaign_id = campana
        and (filtro ->> 'bot' is null or s.bot_id = (filtro ->> 'bot')::uuid)
        and (filtro ->> 'canal' is null or s.channel_kind = filtro ->> 'canal')
        and (filtro ->> 'asignada' is null or s.assigned_to = (filtro ->> 'asignada')::uuid)
        and (filtro ->> 'estado' is null or (filtro ->> 'estado' = 'abiertas' and s.state in ('derivada', 'en_atencion')) or s.state = filtro ->> 'estado')
        and (buscar is null or c.name ilike '%' || buscar || '%' or c.profile_name ilike '%' || buscar || '%' or c.data::text ilike '%' || buscar || '%')
      order by s.updated_at desc
      limit least(coalesce((filtro ->> 'limite')::integer, 100), 2000)
    ) x), '[]'::jsonb);
end $$;

-- ── Funciones de la app pública (solo la clave de servicio) ─────────────────────────────────────

-- Guarda un turno: además de lo de antes, en WhatsApp encola lo que sale y abre la ventana de 24 horas.
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
  entrante boolean := turno -> 'entrante' is not null and jsonb_typeof(turno -> 'entrante') = 'object';
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
  if entrante then
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
    if s.channel_kind = 'whatsapp' and jsonb_typeof(m -> 'envios') = 'array' then
      perform bots.encolar_envio(sesion, n, m -> 'envios', ahora);
    end if;
    if m ->> 'autor' = 'bot' then
      primero := false;
    end if;
  end loop;
  update bots.sessions set
    seq = n, engine_state = turno -> 'sesion', state = turno ->> 'estado', current_box = turno ->> 'cajaActual',
    version_id = coalesce((turno ->> 'versionId')::uuid, version_id), updated_at = ahora,
    last_contact_at = case when entrante then ahora else last_contact_at end,
    window_expires_at = case when entrante and turno ->> 'ventanaHasta' is not null then (turno ->> 'ventanaHasta')::timestamptz else window_expires_at end,
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

create or replace function bots.json_canal_publico(ch bots.channels) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', ch.id, 'botId', ch.bot_id, 'idPublico', (select b.public_id from bots.bots b where b.id = ch.bot_id),
                            'estado', ch.status, 'secretoHash', ch.webhook_secret_hash)
$$;

create or replace function bots.publico_canal_whatsapp(id_publico text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select bots.json_canal_publico(ch) from bots.channels ch join bots.bots b on b.id = ch.bot_id where b.public_id = id_publico and ch.kind = 'whatsapp'
$$;

create or replace function bots.publico_canal_whatsapp_por_id(canal uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select bots.json_canal_publico(ch) from bots.channels ch where ch.id = canal and ch.kind = 'whatsapp'
$$;

-- Guarda lo que avisó 360dialog (lo repetido se descarta) y suma a la salud del canal.
create or replace function bots.publico_recibir(canal uuid, entradas jsonb, ahora timestamptz, demora_ms integer, numero text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch bots.channels%rowtype;
  e jsonb;
  nuevas integer := 0;
  repetidas integer := 0;
  mensajes integer := 0;
begin
  select * into ch from bots.channels x where x.id = canal and x.kind = 'whatsapp';
  if ch.id is null then
    raise exception 'No existe el canal.' using errcode = 'P0002';
  end if;
  for e in select * from jsonb_array_elements(coalesce(entradas, '[]'::jsonb)) loop
    insert into bots.channel_inbox (channel_id, key, organization_id, campaign_id, kind, payload, received_at)
    values (canal, e ->> 'clave', ch.organization_id, ch.campaign_id, e ->> 'tipo', e, ahora)
    on conflict (channel_id, key) do nothing;
    if found then
      nuevas := nuevas + 1;
      if e ->> 'tipo' = 'mensaje' then
        mensajes := mensajes + 1;
      end if;
    else
      repetidas := repetidas + 1;
    end if;
  end loop;
  update bots.channels set
    last_inbound_at = case when mensajes > 0 then ahora else last_inbound_at end,
    display_number = coalesce(display_number, nullif(left(trim(coalesce(numero, '')), 30), ''))
  where id = canal;
  perform bots.sumar_salud(canal, ahora, mensajes, repetidas, 0, 0, 0, 0, greatest(0, coalesce(demora_ms, 0)));
  return jsonb_build_object('nuevas', nuevas, 'repetidas', repetidas);
end $$;

-- Toma lo pendiente de la cola del canal, en orden (si el proceso se corta, se vuelve a tomar a los 2 minutos).
create or replace function bots.publico_entradas_pendientes(canal uuid, limite integer, ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
begin
  with t as (
    select i.key from bots.channel_inbox i
    where i.channel_id = canal and i.processed_at is null and i.payload is not null and i.attempts < 5
      and (i.taken_at is null or i.taken_at < ahora - interval '2 minutes')
    order by i.received_at, i.payload ->> 'hora', i.key
    limit least(greatest(limite, 1), 100)
    for update skip locked
  ), u as (
    update bots.channel_inbox i set taken_at = ahora, attempts = i.attempts + 1
    from t where i.channel_id = canal and i.key = t.key
    returning i.payload, i.received_at
  )
  select coalesce(jsonb_agg(u.payload order by u.received_at, u.payload ->> 'hora', u.payload ->> 'clave'), '[]'::jsonb) into r from u;
  return r;
end $$;

create or replace function bots.publico_entrada_procesada(canal uuid, clave text) returns void
language sql security definer set search_path = '' as $$
  update bots.channel_inbox set processed_at = now(), payload = null where channel_id = canal and key = clave
$$;

create or replace function bots.publico_guardar_telefono(contacto uuid, telefono text, nombre_perfil text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(telefono, '') !~ '^[0-9]{7,15}$' then
    raise exception 'Número inválido.' using errcode = '22023';
  end if;
  update bots.contacts set phone = telefono, profile_name = nullif(left(trim(coalesce(nombre_perfil, '')), 120), '') where id = contacto and deleted_at is null;
end $$;

-- Toma los envíos pendientes (de un canal o de una conversación) y los marca como en curso.
create or replace function bots.publico_tomar_envios(canal uuid, sesion uuid, ahora timestamptz, limite integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
begin
  with t as (
    select o.id from bots.outbound o
    where (canal is null or o.channel_id = canal) and (sesion is null or o.session_id = sesion)
      and ((o.status = 'pendiente' and o.next_attempt_at <= ahora) or (o.status = 'enviando' and o.next_attempt_at < ahora - interval '2 minutes'))
    order by o.session_id, o.n, o.part
    limit least(greatest(limite, 1), 100)
    for update skip locked
  ), u as (
    update bots.outbound o set status = 'enviando', attempts = o.attempts + 1, next_attempt_at = ahora, updated_at = ahora
    from t where o.id = t.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'canalId', u.channel_id, 'conversacionId', u.session_id, 'n', u.n, 'parte', u.part, 'direccion', c.phone, 'mensaje', u.payload, 'intentos', u.attempts)
    order by u.session_id, u.n, u.part), '[]'::jsonb) into r
  from u join bots.sessions s on s.id = u.session_id join bots.contacts c on c.id = s.contact_id;
  return r;
end $$;

-- resultado: {"tipo": "enviado", "idProveedor"} | {"tipo": "reintentar", "error", "en"} | {"tipo": "fallido", "error"}
create or replace function bots.publico_resultado_envio(envio uuid, resultado jsonb, ahora timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o bots.outbound%rowtype;
begin
  select * into o from bots.outbound x where x.id = envio for update;
  if o.id is null then
    return;
  end if;
  if resultado ->> 'tipo' = 'enviado' then
    update bots.outbound set status = 'enviado', provider_id = left(resultado ->> 'idProveedor', 256), last_error = null, updated_at = ahora where id = envio;
    perform bots.sumar_salud(o.channel_id, ahora, 0, 0, 1, 0, 0, 0, null);
  elsif resultado ->> 'tipo' = 'reintentar' then
    update bots.outbound set status = 'pendiente', next_attempt_at = (resultado ->> 'en')::timestamptz, last_error = left(resultado ->> 'error', 300), updated_at = ahora where id = envio;
  else
    update bots.outbound set status = 'fallido', last_error = left(coalesce(resultado ->> 'error', 'No se pudo enviar.'), 300), updated_at = ahora where id = envio;
    perform bots.sumar_salud(o.channel_id, ahora, 0, 0, 0, 0, 0, 1, null);
  end if;
end $$;

-- Un estado que avisó Meta: solo avanza (enviado → entregado → leído); fallido gana. Deja el evento estado_mensaje.
create or replace function bots.publico_aplicar_estado(canal uuid, id_proveedor text, estado text, error text, ahora timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o bots.outbound%rowtype;
  s bots.sessions%rowtype;
  nuevo text;
  orden constant text[] := array['enviado', 'entregado', 'leido'];
begin
  select * into o from bots.outbound x where x.channel_id = canal and x.provider_id = id_proveedor for update;
  if o.id is null or o.status in ('pendiente', 'enviando', 'fallido') then
    return;
  end if;
  if estado = 'fallido' then
    nuevo := 'fallido';
  elsif array_position(orden, estado) > array_position(orden, o.status) then
    nuevo := estado;
  else
    return;
  end if;
  update bots.outbound set status = nuevo, last_error = case when nuevo = 'fallido' then left(coalesce(error, 'WhatsApp no lo pudo entregar.'), 300) else last_error end,
    updated_at = ahora where id = o.id;
  perform bots.sumar_salud(canal, ahora, 0, 0, 0, (nuevo = 'entregado')::integer, (nuevo = 'leido')::integer, (nuevo = 'fallido')::integer, null);
  select * into s from bots.sessions x where x.id = o.session_id;
  insert into bots.events (campaign_id, bot_id, version_id, channel_kind, session_id, contact_hash, name, data, occurred_at)
  values (s.campaign_id, s.bot_id, s.version_id, 'whatsapp', s.id, (select c.external_id_hash from bots.contacts c where c.id = s.contact_id), 'estado_mensaje',
          jsonb_build_object('estado', nuevo), ahora);
end $$;

-- La clave dejó de valer: el canal queda desconectado y se abre la alerta.
create or replace function bots.publico_canal_desconectado(canal uuid, error text, ahora timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch bots.channels%rowtype;
begin
  update bots.channels set status = 'desconectado', last_error = left(coalesce(error, ''), 300), last_error_at = ahora where id = canal returning * into ch;
  if ch.id is null then
    return;
  end if;
  insert into bots.alerts (campaign_id, bot_id, kind, ref, opened_at) values (ch.campaign_id, ch.bot_id, 'canal_desconectado', ch.id::text, ahora)
  on conflict do nothing;
end $$;

create or replace function bots.publico_canales_con_pendientes(ahora timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct x.canal), '[]'::jsonb) from (
    select i.channel_id as canal from bots.channel_inbox i
    where i.processed_at is null and i.payload is not null and i.attempts < 5 and (i.taken_at is null or i.taken_at < ahora - interval '2 minutes')
    union
    select o.channel_id from bots.outbound o
    where (o.status = 'pendiente' and o.next_attempt_at <= ahora) or (o.status = 'enviando' and o.next_attempt_at < ahora - interval '2 minutes')
  ) x
$$;

create or replace function bots.publico_canales_para_plantillas(ahora timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(ch.id), '[]'::jsonb) from bots.channels ch
  where ch.kind = 'whatsapp' and ch.status = 'activo'
    and (ch.templates_checked_at is null or ch.templates_checked_at < ahora - interval '30 minutes'
         or exists (select 1 from bots.templates t where t.channel_id = ch.id and t.status = 'en_revision'))
$$;

-- Reemplaza el espejo de las plantillas del canal con lo que devolvió 360dialog (conserva quién creó cada una).
create or replace function bots.publico_sincronizar_plantillas(canal uuid, plantillas jsonb, ahora timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ch bots.channels%rowtype;
  p jsonb;
begin
  select * into ch from bots.channels x where x.id = canal for update;
  if ch.id is null then
    return;
  end if;
  delete from bots.templates t
  where t.channel_id = canal
    and not exists (select 1 from jsonb_array_elements(coalesce(plantillas, '[]'::jsonb)) q where q ->> 'nombre' = t.name and q ->> 'idioma' = t.language);
  for p in select * from jsonb_array_elements(coalesce(plantillas, '[]'::jsonb)) loop
    insert into bots.templates (channel_id, name, language, organization_id, campaign_id, provider_id, category, status, reason, body, format, variables, usable, notice, created_at, checked_at)
    values (canal, p ->> 'nombre', p ->> 'idioma', ch.organization_id, ch.campaign_id, p ->> 'id', coalesce(p ->> 'categoria', ''), p ->> 'estado', p ->> 'motivo',
            left(coalesce(p ->> 'texto', ''), 1100), coalesce(p ->> 'formato', 'posicional'), coalesce(p -> 'variables', '[]'::jsonb),
            coalesce((p ->> 'usable')::boolean, false), left(p ->> 'aviso', 300), ahora, ahora)
    on conflict (channel_id, name, language) do update set
      provider_id = excluded.provider_id, category = excluded.category, status = excluded.status, reason = excluded.reason, body = excluded.body,
      format = excluded.format, variables = excluded.variables, usable = excluded.usable, notice = excluded.notice, checked_at = ahora;
  end loop;
  update bots.channels set templates_checked_at = ahora where id = canal;
end $$;

-- La clave de 360dialog del canal, leída de Vault. Solo la clave de servicio (el servidor que manda).
create or replace function bots.servicio_clave_whatsapp(canal uuid) returns text
language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret::text from bots.channels ch join vault.decrypted_secrets d on d.id = ch.vault_secret_id
  where ch.id = canal and ch.kind = 'whatsapp' and ch.status <> 'desconectado'
$$;

-- ── Tareas de fondo (se reemplazan) ─────────────────────────────────────────────────────────────

-- Además de lo de antes: la alerta de canal desconectado se cierra cuando el canal se reconecta.
create or replace function bots.tarea_revisar_alertas(ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  abiertas integer := 0;
  cerradas integer := 0;
  dia date := (ahora at time zone 'UTC')::date;
begin
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
  with cerr as (
    update bots.alerts a set closed_at = ahora
    where a.kind = 'canal_desconectado' and a.closed_at is null
      and not exists (select 1 from bots.channels ch where ch.id::text = a.ref and ch.status = 'desconectado')
    returning 1
  ) select cerradas + count(*) into cerradas from cerr;
  return jsonb_build_object('abiertas', abiertas, 'cerradas', cerradas);
end $$;

-- El texto de los mensajes se vacía a los días de guardado del bot. Los datos del contacto (nombre, número, datos que
-- dio) ya no: son la base de contactos de la campaña y se borran a pedido (decisión del 29/9). Limpia las colas.
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
  update bots.outbound o set payload = '{"type": "borrado"}'::jsonb
  from bots.sessions s join bots.bots b on b.id = s.bot_id
  where s.id = o.session_id and o.created_at < ahora - make_interval(days => b.retention_days) and o.payload ->> 'type' <> 'borrado';
  delete from bots.channel_inbox where received_at < ahora - interval '8 days';
  delete from bots.rate_limits where window_start < ahora - interval '2 days';
  return n;
end $$;

-- ── Reglas por fila y permisos ──────────────────────────────────────────────────────────────────

alter table bots.channel_inbox enable row level security;
alter table bots.outbound enable row level security;
alter table bots.channel_stats enable row level security;
alter table bots.templates enable row level security;

create policy "salud del canal: la ve quien entra al producto" on bots.channel_stats for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
create policy "plantillas: las ve quien entra al producto" on bots.templates for select to authenticated
  using (campaign_id in (select bots.campanas_donde_puede('ver')));
-- channel_inbox y outbound: sin reglas para personas (tienen lo que escribió la persona y su número).

-- El número de la persona no se lee directo de la tabla: sale por json_contacto, solo para quien atiende.
revoke select on bots.contacts from authenticated;
grant select (id, organization_id, campaign_id, bot_id, channel_kind, external_id_hash, name, data, terms_number, terms_accepted_at, verified_at,
              deleted_at, created_at, profile_name) on bots.contacts to authenticated;
-- La referencia a Vault y el hash del secreto tampoco.
revoke select on bots.channels from authenticated;
grant select (id, organization_id, campaign_id, bot_id, kind, status, config, created_at, updated_at, display_number, connected_at, last_inbound_at,
              last_error, last_error_at, templates_checked_at) on bots.channels to authenticated;

grant select on bots.channel_stats, bots.templates to authenticated;
grant all on bots.channel_inbox, bots.outbound, bots.channel_stats, bots.templates to service_role;

revoke execute on function bots.estado_envio(uuid, integer), bots.json_plantilla(bots.templates), bots.json_canal_publico(bots.channels),
  bots.sumar_salud(uuid, timestamptz, integer, integer, integer, integer, integer, integer, integer), bots.encolar_envio(uuid, integer, jsonb, timestamptz, text) from public;
grant execute on function bots.estado_envio(uuid, integer) to authenticated, service_role;

revoke execute on function bots.canal_whatsapp(uuid), bots.conectar_whatsapp(uuid, text, text, text, text), bots.prender_whatsapp(uuid, boolean),
  bots.responder_con_plantilla(uuid, jsonb), bots.plantillas(uuid), bots.guardar_plantilla_creada(uuid, jsonb), bots.quitar_plantilla(uuid, text) from public;
grant execute on function bots.canal_whatsapp(uuid), bots.conectar_whatsapp(uuid, text, text, text, text), bots.prender_whatsapp(uuid, boolean),
  bots.responder_con_plantilla(uuid, jsonb), bots.plantillas(uuid), bots.guardar_plantilla_creada(uuid, jsonb), bots.quitar_plantilla(uuid, text) to authenticated;

revoke execute on function bots.publico_canal_whatsapp(text), bots.publico_canal_whatsapp_por_id(uuid), bots.publico_recibir(uuid, jsonb, timestamptz, integer, text),
  bots.publico_entradas_pendientes(uuid, integer, timestamptz), bots.publico_entrada_procesada(uuid, text), bots.publico_guardar_telefono(uuid, text, text),
  bots.publico_tomar_envios(uuid, uuid, timestamptz, integer), bots.publico_resultado_envio(uuid, jsonb, timestamptz),
  bots.publico_aplicar_estado(uuid, text, text, text, timestamptz), bots.publico_canal_desconectado(uuid, text, timestamptz),
  bots.publico_canales_con_pendientes(timestamptz), bots.publico_canales_para_plantillas(timestamptz), bots.publico_sincronizar_plantillas(uuid, jsonb, timestamptz),
  bots.servicio_clave_whatsapp(uuid) from public;
grant execute on function bots.publico_canal_whatsapp(text), bots.publico_canal_whatsapp_por_id(uuid), bots.publico_recibir(uuid, jsonb, timestamptz, integer, text),
  bots.publico_entradas_pendientes(uuid, integer, timestamptz), bots.publico_entrada_procesada(uuid, text), bots.publico_guardar_telefono(uuid, text, text),
  bots.publico_tomar_envios(uuid, uuid, timestamptz, integer), bots.publico_resultado_envio(uuid, jsonb, timestamptz),
  bots.publico_aplicar_estado(uuid, text, text, text, timestamptz), bots.publico_canal_desconectado(uuid, text, timestamptz),
  bots.publico_canales_con_pendientes(timestamptz), bots.publico_canales_para_plantillas(timestamptz), bots.publico_sincronizar_plantillas(uuid, jsonb, timestamptz),
  bots.servicio_clave_whatsapp(uuid) to service_role;

commit;
