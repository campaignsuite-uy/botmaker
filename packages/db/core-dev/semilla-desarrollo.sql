-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- semilla-desarrollo.sql — SOLO DESARROLLO. Una organización, una campaña con BotMaker habilitado y el equipo de
-- prueba, sobre el proyecto de Supabase de desarrollo (después de 0000, 0001 y las migraciones bots_*).
-- La organización es de pruebas de CampaignSuite («CampaignSuite · Pruebas») y la campaña, «Panamá · Pruebas»: nada
-- se llama como un cliente. Hasta el 30/9/2026 se llamaban como el primer cliente; para renombrarlas en una base que ya
-- las tiene, renombrar-organizacion-de-pruebas.sql.
--
-- Antes de correrla:
--  1. Ingresá una vez a la app con Google con cada cuenta que vayas a usar (así Supabase crea su usuario y el
--     disparador core.crear_perfil, su perfil).
--  2. Completá los correos de abajo. Solo el del Dueño es obligatorio; los demás, si los dejás vacíos, se saltean.
--  3. Corréla en el SQL Editor de Supabase. Se puede correr de nuevo: no duplica nada.
--
-- `pnpm db:sql --dueno tu@correo …` arma esta misma semilla con los correos ya puestos (packages/db/salida/).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  correo_dueno   text := '{{DUENO}}';    -- Dueño de la organización: Administrador de BotMaker en cascada
  correo_editor  text := '{{EDITOR}}';   -- Integrante de la campaña con rol editor
  correo_agente  text := '{{AGENTE}}';   -- Integrante de la campaña con rol agente
  correo_lector  text := '{{LECTOR}}';   -- Integrante de la campaña con rol lector
  dueno uuid;
  org uuid;
  campana uuid;
  persona uuid;
  par record;
begin
  select id into dueno from core.profiles where lower(email) = lower(correo_dueno);
  if dueno is null then
    raise exception 'No está el perfil de %: ingresá primero a la app con Google con ese correo.', correo_dueno;
  end if;

  -- La organización (el cliente) y su Dueño.
  insert into core.organizations (slug, name, kind, country_iso) values ('pruebas', 'CampaignSuite · Pruebas', 'agencia', 'PA')
  on conflict (slug) do nothing;
  select id into org from core.organizations where slug = 'pruebas';
  insert into core.organization_members (organization_id, profile_id, role) values (org, dueno, 'dueno')
  on conflict (organization_id, profile_id) do nothing;

  -- BotMaker contratado por la organización.
  insert into core.organization_products (organization_id, product_id, status) values (org, 'botmaker', 'activo')
  on conflict (organization_id, product_id) do update set status = 'activo';

  -- La campaña (el espacio de trabajo de BotMaker), con el producto habilitado y preparado.
  insert into core.campaigns (organization_id, slug, name, country_iso, country_name, city, region, timezone,
                              latitude, longitude, language, election_date, stage, created_by)
  values (org, 'pa-pruebas', 'Panamá · Pruebas', 'PA', 'Panamá', 'Ciudad de Panamá', 'Panamá', 'America/Panama',
          8.9824, -79.5199, 'es', '2029-05-06', 'precampana', dueno)
  on conflict (organization_id, slug) do nothing;
  select id into campana from core.campaigns where organization_id = org and slug = 'pa-pruebas';
  insert into core.campaign_products (organization_id, campaign_id, product_id, status, enabled_by)
  values (org, campana, 'botmaker', 'activo', dueno)
  on conflict (campaign_id, product_id) do update set status = 'activo';
  perform bots.preparar_campana(campana, '{}'::jsonb);

  -- El equipo: miembro de la organización, integrante de la campaña y su rol en BotMaker.
  for par in select * from (values (correo_editor, 'editor'), (correo_agente, 'agente'), (correo_lector, 'lector')) as t(correo, rol) loop
    if coalesce(par.correo, '') = '' or par.correo like '{{%' then
      continue;
    end if;
    select id into persona from core.profiles where lower(email) = lower(par.correo);
    if persona is null then
      raise notice 'Se saltea %: todavía no ingresó a la app.', par.correo;
      continue;
    end if;
    insert into core.organization_members (organization_id, profile_id, role) values (org, persona, 'miembro')
    on conflict (organization_id, profile_id) do nothing;
    insert into core.campaign_members (organization_id, campaign_id, profile_id, role, added_by)
    values (org, campana, persona, 'integrante', dueno)
    on conflict (campaign_id, profile_id) do nothing;
    insert into core.campaign_access (organization_id, campaign_id, product_id, profile_id, role, granted_by)
    values (org, campana, 'botmaker', persona, par.rol, dueno)
    on conflict (campaign_id, product_id, profile_id) do update set role = excluded.role;
  end loop;

  raise notice 'Listo: organización pruebas (CampaignSuite · Pruebas), campaña pa-pruebas con BotMaker.';
end $$;

-- Comprobación: el rol de cada persona en BotMaker (el Dueño tiene que dar administrador).
select p.email, core.rol_en_campana(c.id, 'botmaker', p.id) as rol_en_botmaker
from core.campaigns c
join core.organization_members m on m.organization_id = c.organization_id
join core.profiles p on p.id = m.profile_id
where c.slug = 'pa-pruebas'
order by p.email;

commit;
