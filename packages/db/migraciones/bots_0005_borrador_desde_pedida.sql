-- BotMaker, etapa 4: el borrador nuevo parte del pedido de publicación pendiente, si hay uno.
-- Antes partía de la versión publicada (o de la última): con un pedido pendiente, lo que se siguiera armando perdía lo
-- que ya se había pedido publicar. Misma firma y mismos permisos que en bots_0003_versiones.sql.
begin;

-- El borrador del bot. Si ya hay uno, lo devuelve. Si no, lo crea con `definicion` o, si viene null, copiando la
-- versión pedida para publicar, o si no la publicada, o si no la última. Editor y administrador.
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
    -- Si hay un pedido de publicación pendiente, el borrador nuevo parte de lo pedido: si no, lo que se siga armando
    -- mientras el administrador revisa perdería lo que ya se pidió publicar.
    select v.id, v.definition into base_id, base_definicion from bots.versions v
    where v.bot_id = bot and v.status = 'pedida' order by v.number desc limit 1;
    if base_id is null then
      select v.id, v.definition into base_id, base_definicion from bots.versions v where v.id = b.published_version_id;
    end if;
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

commit;
