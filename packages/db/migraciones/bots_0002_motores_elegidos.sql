-- BotMaker · 0002 · Motores elegidos con la prueba del 28/9/2026 (informe "Resultado de la prueba de motores").
--
--  - Interpretar pasa a doble lectura: el principal y el respaldo leen el mismo mensaje a la vez; si coinciden, sigue;
--    si no, el bot pregunta con dos botones. La confianza que declara cada motor no sirve para eso (la prueba mostró
--    que Gemini y gpt-oss dicen 0,95 o más aunque se equivoquen).
--  - Por defecto: interpretar con Gemini 3.1 Flash-Lite y gpt-oss-120b (2,5 s); responder con Gemini 3.1 Flash-Lite y
--    Claude Haiku 4.5 de respaldo (5 s: con 4 s se cortaba el 4 % de las respuestas). El copiloto no se probó.
--  - Mistral Small 4 y Ministral 3 8B se apagan: inventaron datos al responder y OpenRouter los limitaba seguido.
--    Los bots que ya existen conservan sus motores; la capa de motores saltea un motor apagado.
--
-- Espejo de MOTORES_POR_DEFECTO y FICHAS_MOTORES (dominio/motores.ts): pnpm db:probar compara las dos.

begin;

alter table bots.engine_defaults
  add column double_read boolean not null default false,
  add constraint engine_defaults_doble_lectura check (not double_read or (function = 'interpretar' and fallback_engine_id is not null));
comment on column bots.engine_defaults.double_read is 'Solo interpretar: el respaldo lee el mismo mensaje a la vez que el principal y, si no coinciden, el bot pregunta.';

alter table bots.bot_engines
  add column double_read boolean not null default false,
  add constraint bot_engines_doble_lectura check (not double_read or (function = 'interpretar' and fallback_engine_id is not null));
comment on column bots.bot_engines.double_read is 'Solo interpretar: el respaldo lee el mismo mensaje a la vez que el principal y, si no coinciden, el bot pregunta.';

update bots.engines set active = false, updated_at = now(),
  conditions = conditions || ' Apagado desde la prueba del 28/9/2026: inventó datos al responder y OpenRouter lo limitaba seguido.'
where id in ('mistral-small-4', 'ministral-8b');

update bots.engine_defaults set primary_engine_id = 'gemini-3.1-flash-lite', fallback_engine_id = 'gpt-oss-120b',
  timeout_ms = 2500, double_read = true, updated_at = now()
where function = 'interpretar';
update bots.engine_defaults set primary_engine_id = 'gemini-3.1-flash-lite', fallback_engine_id = 'claude-haiku-4.5',
  timeout_ms = 5000, double_read = false, updated_at = now()
where function = 'responder';

-- Crear un bot copia también la doble lectura. Igual que en 0001, con la columna nueva.
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
  perform bots.anotar(org, 'bots.crear', trim(datos ->> 'nombre'), jsonb_build_object('bot', nuevo));
  return nuevo;
end $$;

-- Motores por función y topes (administrador). motores: { interpretar: { principal, respaldo, dobleLectura? }, … };
-- dobleLectura solo en interpretar y con respaldo; si no viene, queda como estaba (y se apaga si se quita el respaldo).
create or replace function bots.guardar_motores(bot uuid, motores jsonb, topes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b bots.bots%rowtype;
  f text;
  m jsonb;
  principal text;
  respaldo text;
  doble boolean;
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
    if m ? 'dobleLectura' then
      doble := coalesce((m ->> 'dobleLectura')::boolean, false);
    else
      select x.double_read into doble from bots.bot_engines x where x.bot_id = bot and x.function = f;
      doble := coalesce(doble, false) and respaldo is not null;
    end if;
    if doble and f <> 'interpretar' then
      raise exception 'La doble lectura es solo para interpretar.' using errcode = '23514';
    end if;
    if doble and respaldo is null then
      raise exception 'La doble lectura necesita un motor de respaldo.' using errcode = '23514';
    end if;
    update bots.bot_engines set primary_engine_id = principal, fallback_engine_id = respaldo, double_read = doble,
      updated_by = auth.uid(), updated_at = now()
    where bot_id = bot and function = f;
    hecho := hecho || jsonb_build_object(f, jsonb_build_object('principal', principal, 'respaldo', respaldo, 'dobleLectura', doble));
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

commit;
