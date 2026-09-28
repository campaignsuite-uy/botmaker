-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- core-minimo-para-desarrollo.sql — El núcleo de CampaignSuite (esquema `core`), reducido, para desarrollar
-- Hornero/BotMaker por separado con las MISMAS tablas, columnas, ids y funciones de roles que la plataforma.
--
-- Qué es: un extracto del esquema `core` de CampaignSuite tal como queda después de las migraciones 0001 a 0010
-- (commit ef6a364, 27/9/2026), sacado con pg_dump y recortado. Trae las 11 tablas del núcleo (sin invitaciones),
-- sus reglas por fila y las funciones de roles (core.rol_en_campana, core.rol_campana_de, core.mis_campanas…).
-- Qué NO es: una migración de CampaignSuite. El día de la integración este archivo se descarta: Hornero pasa a
-- apuntar al `core` real del proyecto de CampaignSuite, sin cambiar nada de su propio esquema.
--
-- Afuera, a propósito: las invitaciones, la consola (organizaciones de clientes y demos), crear o habilitar productos
-- en una campaña y la carga de demos, porque tocan el esquema de AI Positioning (aipos). En desarrollo, las filas del
-- núcleo se cargan a mano (ver semilla-desarrollo.sql).
--
-- Dónde se aplica: un proyecto de Supabase de desarrollo (necesita el esquema auth de Supabase: auth.users y
-- auth.uid()). En Project Settings → Data API, sumar `core` (y el esquema de Hornero) a "Exposed schemas".
-- Probado el 27/9/2026 sobre Postgres 16 con un esquema auth de prueba (ver 00-LEEME.md).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

set check_function_bodies = false;

create schema if not exists core;
comment on schema core is 'Núcleo de CampaignSuite: personas, organizaciones, productos, campañas, equipos y accesos (extracto para desarrollo).';
grant usage on schema core to authenticated, service_role;

CREATE FUNCTION core.accede_a_producto(producto text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return core.es_admin_producto() or exists (
    select 1
    from core.organization_members m
    join core.organization_products op
      on op.organization_id = m.organization_id and op.product_id = producto and op.status = 'activo'
    join core.organizations o on o.id = m.organization_id
    where m.profile_id = auth.uid() and m.status = 'activo' and (m.role in ('dueno', 'admin') or o.is_demo)
  ) or exists (
    select 1
    from core.campaign_members cm
    where cm.profile_id = auth.uid() and core.rol_en_campana(cm.campaign_id, producto, auth.uid()) is not null
  );
end $$;

CREATE FUNCTION core.administra_campana(campana uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return core.administra_campana_de(campana, auth.uid());
end $$;

CREATE FUNCTION core.administra_campana_de(campana uuid, persona uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return coalesce(core.rol_campana_de(campana, persona) = 'administrador', false);
end $$;

CREATE FUNCTION core.administra_en_campana(campana uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return core.administra_campana(campana) or exists (
    select 1 from core.campaign_products cp
    where cp.campaign_id = campana and core.rol_en_campana(campana, cp.product_id, auth.uid()) = 'administrador'
  );
end $$;

CREATE FUNCTION core.asignar_acceso(campana uuid, producto text, persona uuid, rol text, por uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  org uuid;
  demo boolean;
  rc text;
  quien uuid := coalesce(auth.uid(), por);
begin
  select c.organization_id, o.is_demo into org, demo
  from core.campaigns c join core.organizations o on o.id = c.organization_id where c.id = campana;
  if org is null then
    raise exception 'No existe la campaña.' using errcode = 'P0002';
  end if;
  if demo then
    raise exception 'Las personas de una demo las maneja el Administrador de CampaignSuite desde la consola.' using errcode = '42501';
  end if;
  if not exists (select 1 from core.campaign_products cp where cp.campaign_id = campana and cp.product_id = producto) then
    raise exception 'Ese producto no está habilitado en la campaña.' using errcode = '23514';
  end if;
  if auth.uid() is not null and core.rol_en_campana(campana, producto, auth.uid()) is distinct from 'administrador' then
    raise exception 'Solo el Administrador de ese producto en la campaña arma su equipo.' using errcode = '42501';
  end if;
  rc := core.rol_campana_de(campana, persona);
  if rc is null then
    raise exception 'La persona no es integrante de la campaña.' using errcode = '23514';
  end if;
  if rc = 'administrador' then
    raise exception 'Quien administra la campaña es Administrador en todos sus productos.' using errcode = '23514';
  end if;
  if rol is null then
    delete from core.campaign_access a where a.campaign_id = campana and a.product_id = producto and a.profile_id = persona;
    return;
  end if;
  if not exists (select 1 from core.products p where p.id = producto and rol = any (p.valid_roles)) then
    raise exception 'Rol desconocido: %', rol using errcode = '22023';
  end if;
  insert into core.campaign_access (organization_id, campaign_id, product_id, profile_id, role, granted_by)
  values (org, campana, producto, persona, rol, quien)
  on conflict (campaign_id, product_id, profile_id) do update set role = excluded.role, granted_by = excluded.granted_by;
end $$;

CREATE FUNCTION core.completar_organizacion_campana() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  new.organization_id := (select c.organization_id from core.campaigns c where c.id = new.campaign_id);
  return new;
end $$;

CREATE FUNCTION core.copiar_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update core.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;

CREATE FUNCTION core.crear_perfil() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into core.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

CREATE FUNCTION core.es_admin_producto() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return core.es_admin_producto_de(auth.uid());
end $$;

CREATE FUNCTION core.es_admin_producto_de(persona uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if persona is null then
    return false;
  end if;
  -- Solo con el correo confirmado (con Google siempre lo está): nadie se hace pasar por otro con un alta sin confirmar.
  return exists (
    select 1 from core.profiles p
    join core.platform_admins a on a.email = lower(p.email)
    join auth.users u on u.id = p.id and u.email_confirmed_at is not null
    where p.id = persona and p.email <> ''
  );
end $$;

CREATE FUNCTION core.es_miembro(org uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return exists (
    select 1 from core.organization_members m
    where m.organization_id = org and m.profile_id = auth.uid() and m.status = 'activo'
  );
end $$;

CREATE FUNCTION core.exigir_admin_producto() RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is not null and not core.es_admin_producto() then
    raise exception 'Solo el Administrador del producto usa la consola.' using errcode = '42501';
  end if;
end $$;

CREATE FUNCTION core.mis_campanas() RETURNS SETOF uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  yo uuid := auth.uid();
  admin boolean := core.es_admin_producto();
begin
  return query
    select c.id
    from core.campaigns c
    where core.rol_campana_de(c.id, yo) is not null
      or (admin and exists (select 1 from core.organizations o where o.id = c.organization_id and o.is_demo));
end $$;

CREATE FUNCTION core.mis_organizaciones() RETURNS SETOF uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  return query
    select m.organization_id
    from core.organization_members m
    where m.profile_id = auth.uid() and m.status = 'activo';
end $$;

CREATE FUNCTION core.personas_visibles() RETURNS SETOF uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if core.es_admin_producto() then
    return query select p.id from core.profiles p;
    return;
  end if;
  return query
    select auth.uid()
    union
    select otro.profile_id
    from core.organization_members yo
    join core.organization_members otro on otro.organization_id = yo.organization_id
    where yo.profile_id = auth.uid() and yo.status = 'activo';
end $$;

CREATE FUNCTION core.proteger_ultimo_dueno() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not exists (select 1 from core.organizations o where o.id = old.organization_id) then
    return null; -- se está borrando la organización
  end if;
  if old.role = 'dueno' and old.status = 'activo'
     and not exists (
       select 1 from core.organization_members m
       where m.organization_id = old.organization_id and m.role = 'dueno' and m.status = 'activo'
     ) then
    raise exception 'La organización tiene que tener al menos un dueño activo.' using errcode = '23514';
  end if;
  return null;
end $$;

CREATE FUNCTION core.reglas_miembro_demo() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  org uuid := coalesce(new.organization_id, old.organization_id);
begin
  -- core.aceptar_invitaciones marca la transacción (la persona acepta el acceso que le dio la consola).
  if auth.uid() is not null
     and coalesce(current_setting('campaignsuite.aceptando', true), '') <> 'si'
     and exists (select 1 from core.organizations o where o.id = org and o.is_demo)
     and not core.es_admin_producto() then
    raise exception 'Las personas de una demo las maneja el Administrador del producto desde la consola.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

CREATE FUNCTION core.rol_campana_de(campana uuid, persona uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  org uuid;
  demo boolean;
  estado_demo text;
  ro text;
begin
  if campana is null or persona is null then
    return null;
  end if;
  select c.organization_id, o.is_demo, o.demo_status into org, demo, estado_demo
  from core.campaigns c join core.organizations o on o.id = c.organization_id
  where c.id = campana;
  if org is null then
    return null;
  end if;
  if demo then
    if estado_demo is distinct from 'lista' then
      return null;
    end if;
    if core.es_admin_producto_de(persona) or exists (
      select 1 from core.organization_members m where m.organization_id = org and m.profile_id = persona and m.status = 'activo'
    ) then
      return 'observador';
    end if;
    return null;
  end if;
  select m.role into ro from core.organization_members m
  where m.organization_id = org and m.profile_id = persona and m.status = 'activo';
  if ro is null then
    return null;
  end if;
  if ro in ('dueno', 'admin') then
    return 'administrador';
  end if;
  return (select cm.role from core.campaign_members cm where cm.campaign_id = campana and cm.profile_id = persona);
end $$;

CREATE FUNCTION core.rol_en_campana(campana uuid, producto text, persona uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  org uuid;
  rc text;
begin
  if campana is null or producto is null or persona is null then
    return null;
  end if;
  select c.organization_id into org from core.campaigns c where c.id = campana;
  if org is null then
    return null;
  end if;
  if not exists (
    select 1 from core.organization_products op
    where op.organization_id = org and op.product_id = producto and op.status = 'activo'
  ) or not exists (
    select 1 from core.campaign_products cp
    where cp.campaign_id = campana and cp.product_id = producto and cp.status = 'activo'
  ) then
    return null;
  end if;
  rc := core.rol_campana_de(campana, persona);
  if rc is null then
    return null;
  end if;
  if rc in ('administrador', 'observador') then
    return rc;
  end if;
  return (select a.role from core.campaign_access a where a.campaign_id = campana and a.product_id = producto and a.profile_id = persona);
end $$;

CREATE FUNCTION core.rol_en_organizacion(org uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  r text;
begin
  select m.role into r
  from core.organization_members m
  where m.organization_id = org and m.profile_id = auth.uid() and m.status = 'activo';
  return r;
end $$;

CREATE FUNCTION core.solo_agregar() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'El registro de actividad solo admite agregar filas.' using errcode = '42501';
end $$;

CREATE FUNCTION core.tocar_actualizado() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;

CREATE FUNCTION core.validar_rol_producto() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not exists (
    select 1 from core.products p where p.id = new.product_id and new.role = any (p.valid_roles)
  ) then
    raise exception 'El rol "%" no es válido para el producto "%".', new.role, new.product_id using errcode = '23514';
  end if;
  return new;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE core.audit_log (
    id bigint NOT NULL,
    profile_id uuid,
    organization_id uuid,
    product_id text,
    action text NOT NULL,
    object text DEFAULT ''::text NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE core.campaign_access (
    organization_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    product_id text NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE core.campaign_members (
    organization_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_members_role_check CHECK ((role = ANY (ARRAY['administrador'::text, 'integrante'::text])))
);

CREATE TABLE core.campaign_products (
    organization_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    product_id text NOT NULL,
    status text DEFAULT 'activo'::text NOT NULL,
    enabled_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_products_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'suspendido'::text])))
);

CREATE TABLE core.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'activa'::text NOT NULL,
    country_iso text NOT NULL,
    country_name text NOT NULL,
    city text NOT NULL,
    region text NOT NULL,
    timezone text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    language text NOT NULL,
    election_date date,
    stage text DEFAULT 'campana'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_country_iso_check CHECK ((country_iso ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT campaigns_language_check CHECK ((length(language) >= 2)),
    CONSTRAINT campaigns_latitude_check CHECK (((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))),
    CONSTRAINT campaigns_longitude_check CHECK (((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision))),
    CONSTRAINT campaigns_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120))),
    CONSTRAINT campaigns_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT campaigns_slug_libre CHECK ((slug <> ALL (ARRAY['nueva'::text, 'organizacion'::text, 'configuracion'::text, 'campanas'::text, 'equipo'::text, 'productos'::text, 'ai-positioning'::text, 'inicio'::text]))),
    CONSTRAINT campaigns_stage_check CHECK ((stage = ANY (ARRAY['gestion_permanente'::text, 'precampana'::text, 'campana'::text, 'en_cargo'::text]))),
    CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['activa'::text, 'archivada'::text])))
);

CREATE TABLE core.organization_members (
    organization_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'activo'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['dueno'::text, 'admin'::text, 'miembro'::text]))),
    CONSTRAINT organization_members_status_check CHECK ((status = ANY (ARRAY['invitado'::text, 'activo'::text, 'suspendido'::text])))
);

CREATE TABLE core.organization_products (
    organization_id uuid NOT NULL,
    product_id text NOT NULL,
    status text DEFAULT 'activo'::text NOT NULL,
    plan text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_products_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'suspendido'::text])))
);

CREATE TABLE core.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    country_iso text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    demo_status text,
    demo_source text,
    demo_progress jsonb,
    created_by uuid,
    CONSTRAINT organizations_country_iso_check CHECK ((country_iso ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT organizations_demo_estado CHECK (((is_demo AND (demo_status IS NOT NULL)) OR ((NOT is_demo) AND (demo_status IS NULL)))),
    CONSTRAINT organizations_demo_status_check CHECK ((demo_status = ANY (ARRAY['cargando'::text, 'lista'::text]))),
    CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['agencia'::text, 'partido'::text, 'campana'::text]))),
    CONSTRAINT organizations_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT organizations_slug_libre CHECK ((slug <> ALL (ARRAY['consola'::text, 'ingresar'::text, 'salir'::text, 'auth'::text, 'descargas'::text, 'fichas'::text, 'imprimir'::text, 'api'::text, 'inicio'::text])))
);

CREATE TABLE core.platform_admins (
    email text NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_admins_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)))
);

CREATE TABLE core.products (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    layer text DEFAULT ''::text NOT NULL,
    valid_roles text[] NOT NULL,
    route text,
    sort_order integer DEFAULT 0 NOT NULL,
    CONSTRAINT products_id_check CHECK ((id ~ '^[a-z][a-z0-9_]*$'::text)),
    CONSTRAINT products_valid_roles_check CHECK ((cardinality(valid_roles) > 0))
);

CREATE TABLE core.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE core.audit_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME core.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

COMMENT ON TABLE core.audit_log IS 'Registro de actividad común a toda la plataforma. Lo escribe solo el backend (clave de servicio); lo leen dueño y admin de la organización. Solo inserción.';

COMMENT ON TABLE core.campaign_access IS 'Rol de un integrante de la campaña en uno de sus productos (products.valid_roles). Quien administra la campaña (o la organización) no necesita fila: es Administrador en todos sus productos (core.rol_en_campana).';

COMMENT ON TABLE core.campaign_members IS 'Quién está en una campaña y con qué rol en la campaña: administrador (cambia sus datos y arma su equipo; es Administrador en todos sus productos) o integrante (entra y ve los productos donde tiene rol). El Dueño y el Administrador de la organización no necesitan fila: administran todas las campañas (core.rol_campana_de).';

COMMENT ON TABLE core.campaign_products IS 'Producto habilitado en una campaña. Suspendido: nadie entra a ese producto en la campaña (sus datos quedan). Lo cambian el Dueño y el Administrador de la organización (core.habilitar_producto).';

COMMENT ON TABLE core.campaigns IS 'Campaña de una organización (CampanaPlataforma). Cada producto se habilita en ella (core.campaign_products) y guarda lo suyo en su esquema, apuntando acá. Se crea con core.crear_campana().';

COMMENT ON COLUMN core.campaigns.stage IS 'Etapa: gestión permanente, precampaña, campaña o en el cargo. En AI Positioning cambia qué se carga en las fichas.';

COMMENT ON TABLE core.organization_members IS 'Membresía de una persona en una organización (tipo MiembroOrganizacion). Solo cuenta si status = activo.';

COMMENT ON TABLE core.organization_products IS 'Producto contratado por una organización. Si status = suspendido, nadie de la organización entra al producto. Lo escribe el backend (facturación / alta de clientes).';

COMMENT ON TABLE core.organizations IS 'El cliente (tipo Organizacion). El alta la hace el equipo de CampaignSuite con la clave de servicio.';

COMMENT ON COLUMN core.organizations.slug IS 'Parte de la URL (/[organizacion]/...). No se edita desde la app para no romper enlaces.';

COMMENT ON COLUMN core.organizations.is_demo IS 'Organización demo: sin relación con ningún cliente, solo para mirar (rol observador). La crea el Administrador del producto desde la consola.';

COMMENT ON COLUMN core.organizations.demo_status IS 'Demo: cargando (se están copiando los datos, nadie entra) o lista.';

COMMENT ON COLUMN core.organizations.demo_source IS 'De dónde salió la demo: "versión <commit>" (los datos que arma el código desplegado) o "copia de <nombre> (<fecha>)".';

COMMENT ON COLUMN core.organizations.demo_progress IS 'Avance de la carga de la demo, paso a paso (lo escribe el servidor).';

COMMENT ON TABLE core.platform_admins IS 'Administradores del producto (rol de plataforma), por correo de Google. Crean organizaciones y demos, clonan demos y dan acceso a ellas. Se suman y se quitan desde la consola; el primero lo fija el servidor (CAMPAIGNSUITE_ADMINS_PRODUCTO).';

COMMENT ON TABLE core.products IS 'Catálogo de productos (espejo de platform/src/catalogo.ts). valid_roles = roles que define cada producto. route null = el producto todavía no existe en la plataforma.';

COMMENT ON TABLE core.profiles IS 'Una persona de CampaignSuite (tipo Persona). id = auth.users.id. Las iniciales se calculan en la app.';

ALTER TABLE ONLY core.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY core.campaign_access
    ADD CONSTRAINT campaign_access_pkey PRIMARY KEY (campaign_id, product_id, profile_id);

ALTER TABLE ONLY core.campaign_members
    ADD CONSTRAINT campaign_members_pkey PRIMARY KEY (campaign_id, profile_id);

ALTER TABLE ONLY core.campaign_products
    ADD CONSTRAINT campaign_products_pkey PRIMARY KEY (campaign_id, product_id);

ALTER TABLE ONLY core.campaigns
    ADD CONSTRAINT campaigns_id_organization_id_key UNIQUE (id, organization_id);

ALTER TABLE ONLY core.campaigns
    ADD CONSTRAINT campaigns_organization_id_slug_key UNIQUE (organization_id, slug);

ALTER TABLE ONLY core.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY core.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (organization_id, profile_id);

ALTER TABLE ONLY core.organization_products
    ADD CONSTRAINT organization_products_pkey PRIMARY KEY (organization_id, product_id);

ALTER TABLE ONLY core.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY core.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);

ALTER TABLE ONLY core.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (email);

ALTER TABLE ONLY core.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY core.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

CREATE INDEX audit_log_organizacion ON core.audit_log USING btree (organization_id, created_at DESC);

CREATE INDEX audit_log_persona ON core.audit_log USING btree (profile_id, created_at DESC);

CREATE INDEX campaign_access_persona ON core.campaign_access USING btree (profile_id);

CREATE INDEX campaign_members_persona ON core.campaign_members USING btree (profile_id);



CREATE INDEX organization_members_persona ON core.organization_members USING btree (profile_id);

CREATE INDEX profiles_email ON core.profiles USING btree (lower(email));

CREATE TRIGGER audit_log_solo_agregar BEFORE DELETE OR UPDATE ON core.audit_log FOR EACH ROW EXECUTE FUNCTION core.solo_agregar();

CREATE TRIGGER campaign_access_actualizado BEFORE UPDATE ON core.campaign_access FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER campaign_access_organizacion BEFORE INSERT OR UPDATE OF campaign_id, organization_id ON core.campaign_access FOR EACH ROW EXECUTE FUNCTION core.completar_organizacion_campana();

CREATE TRIGGER campaign_access_rol_valido BEFORE INSERT OR UPDATE OF role, product_id ON core.campaign_access FOR EACH ROW EXECUTE FUNCTION core.validar_rol_producto();

CREATE TRIGGER campaign_members_actualizado BEFORE UPDATE ON core.campaign_members FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER campaign_members_organizacion BEFORE INSERT OR UPDATE OF campaign_id, organization_id ON core.campaign_members FOR EACH ROW EXECUTE FUNCTION core.completar_organizacion_campana();

CREATE TRIGGER campaign_products_actualizado BEFORE UPDATE ON core.campaign_products FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER campaign_products_organizacion BEFORE INSERT OR UPDATE OF campaign_id, organization_id ON core.campaign_products FOR EACH ROW EXECUTE FUNCTION core.completar_organizacion_campana();

CREATE TRIGGER campaigns_actualizado BEFORE UPDATE ON core.campaigns FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER organization_members_actualizado BEFORE UPDATE ON core.organization_members FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER organization_members_demo BEFORE INSERT OR DELETE OR UPDATE ON core.organization_members FOR EACH ROW EXECUTE FUNCTION core.reglas_miembro_demo();

CREATE TRIGGER organization_members_ultimo_dueno AFTER DELETE OR UPDATE ON core.organization_members FOR EACH ROW EXECUTE FUNCTION core.proteger_ultimo_dueno();

CREATE TRIGGER organization_products_actualizado BEFORE UPDATE ON core.organization_products FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER organizations_actualizado BEFORE UPDATE ON core.organizations FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

CREATE TRIGGER profiles_actualizado BEFORE UPDATE ON core.profiles FOR EACH ROW EXECUTE FUNCTION core.tocar_actualizado();

ALTER TABLE ONLY core.campaign_access
    ADD CONSTRAINT campaign_access_campaign_id_organization_id_fkey FOREIGN KEY (campaign_id, organization_id) REFERENCES core.campaigns(id, organization_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_access
    ADD CONSTRAINT campaign_access_campaign_id_product_id_fkey FOREIGN KEY (campaign_id, product_id) REFERENCES core.campaign_products(campaign_id, product_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_access
    ADD CONSTRAINT campaign_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.campaign_access
    ADD CONSTRAINT campaign_access_integrante FOREIGN KEY (campaign_id, profile_id) REFERENCES core.campaign_members(campaign_id, profile_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_members
    ADD CONSTRAINT campaign_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.campaign_members
    ADD CONSTRAINT campaign_members_campaign_id_organization_id_fkey FOREIGN KEY (campaign_id, organization_id) REFERENCES core.campaigns(id, organization_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_members
    ADD CONSTRAINT campaign_members_organization_id_profile_id_fkey FOREIGN KEY (organization_id, profile_id) REFERENCES core.organization_members(organization_id, profile_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_products
    ADD CONSTRAINT campaign_products_campaign_id_organization_id_fkey FOREIGN KEY (campaign_id, organization_id) REFERENCES core.campaigns(id, organization_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaign_products
    ADD CONSTRAINT campaign_products_enabled_by_fkey FOREIGN KEY (enabled_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.campaign_products
    ADD CONSTRAINT campaign_products_organization_id_product_id_fkey FOREIGN KEY (organization_id, product_id) REFERENCES core.organization_products(organization_id, product_id) ON DELETE CASCADE;

ALTER TABLE ONLY core.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.campaigns
    ADD CONSTRAINT campaigns_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES core.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY core.organization_members
    ADD CONSTRAINT organization_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES core.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY core.organization_members
    ADD CONSTRAINT organization_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES core.profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY core.organization_products
    ADD CONSTRAINT organization_products_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES core.organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY core.organization_products
    ADD CONSTRAINT organization_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES core.products(id);

ALTER TABLE ONLY core.organizations
    ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.platform_admins
    ADD CONSTRAINT platform_admins_added_by_fkey FOREIGN KEY (added_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY core.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE core.audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.campaign_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.campaign_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.campaign_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.campaigns ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.organization_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.organization_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.organizations ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.platform_admins ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.profiles ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


CREATE POLICY "accesos: los míos y los que administro" ON core.campaign_access FOR SELECT TO authenticated USING (((profile_id = auth.uid()) OR core.administra_campana(campaign_id) OR (core.rol_en_campana(campaign_id, product_id, auth.uid()) = 'administrador'::text)));

CREATE POLICY "actividad: dueño y admin leen la de su organización" ON core.audit_log FOR SELECT TO authenticated USING ((core.rol_en_organizacion(organization_id) = ANY (ARRAY['dueno'::text, 'admin'::text])));

CREATE POLICY "admins del producto: los ven los admins del producto" ON core.platform_admins FOR SELECT TO authenticated USING (core.es_admin_producto());

CREATE POLICY "campañas: veo las mías" ON core.campaigns FOR SELECT TO authenticated USING ((id IN ( SELECT core.mis_campanas() AS mis_campanas)));

CREATE POLICY "contratados: el admin del producto ve los de todas" ON core.organization_products FOR SELECT TO authenticated USING (core.es_admin_producto());

CREATE POLICY "contratados: veo los de mis organizaciones" ON core.organization_products FOR SELECT TO authenticated USING ((organization_id IN ( SELECT core.mis_organizaciones() AS mis_organizaciones)));

CREATE POLICY "integrantes: los ve quien entra a la campaña" ON core.campaign_members FOR SELECT TO authenticated USING ((campaign_id IN ( SELECT core.mis_campanas() AS mis_campanas)));

CREATE POLICY "miembros: dueño o admin agrega personas" ON core.organization_members FOR INSERT TO authenticated WITH CHECK (((core.rol_en_organizacion(organization_id) = 'dueno'::text) OR ((core.rol_en_organizacion(organization_id) = 'admin'::text) AND (role <> 'dueno'::text))));

CREATE POLICY "miembros: dueño o admin cambia roles y estados" ON core.organization_members FOR UPDATE TO authenticated USING (((core.rol_en_organizacion(organization_id) = 'dueno'::text) OR ((core.rol_en_organizacion(organization_id) = 'admin'::text) AND (role <> 'dueno'::text)))) WITH CHECK (((core.rol_en_organizacion(organization_id) = 'dueno'::text) OR ((core.rol_en_organizacion(organization_id) = 'admin'::text) AND (role <> 'dueno'::text))));

CREATE POLICY "miembros: dueño o admin quita personas" ON core.organization_members FOR DELETE TO authenticated USING (((core.rol_en_organizacion(organization_id) = 'dueno'::text) OR ((core.rol_en_organizacion(organization_id) = 'admin'::text) AND (role <> 'dueno'::text))));

CREATE POLICY "miembros: el admin del producto ve los de todas" ON core.organization_members FOR SELECT TO authenticated USING (core.es_admin_producto());

CREATE POLICY "miembros: veo los de mis organizaciones" ON core.organization_members FOR SELECT TO authenticated USING ((organization_id IN ( SELECT core.mis_organizaciones() AS mis_organizaciones)));

CREATE POLICY "organizaciones: el admin del producto las ve todas" ON core.organizations FOR SELECT TO authenticated USING (core.es_admin_producto());

CREATE POLICY "organizaciones: el dueño edita los datos" ON core.organizations FOR UPDATE TO authenticated USING ((core.rol_en_organizacion(id) = 'dueno'::text)) WITH CHECK ((core.rol_en_organizacion(id) = 'dueno'::text));

CREATE POLICY "organizaciones: veo las mías" ON core.organizations FOR SELECT TO authenticated USING ((id IN ( SELECT core.mis_organizaciones() AS mis_organizaciones)));

CREATE POLICY "perfiles: cada persona edita el suyo" ON core.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));

CREATE POLICY "perfiles: me veo y veo a mis compañeros de organización" ON core.profiles FOR SELECT TO authenticated USING ((id IN ( SELECT core.personas_visibles() AS personas_visibles)));

CREATE POLICY "productos de la campaña: los ve quien ve la campaña" ON core.campaign_products FOR SELECT TO authenticated USING ((campaign_id IN ( SELECT core.mis_campanas() AS mis_campanas)));

CREATE POLICY "productos: el catálogo lo ve cualquier persona con sesión" ON core.products FOR SELECT TO authenticated USING (true);

-- ── Alta automática del perfil al ingresar con Google (como en CampaignSuite: 0001_core.sql) ──────────────────

create trigger crear_perfil after insert on auth.users
  for each row execute function core.crear_perfil();

create trigger copiar_email after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function core.copiar_email();

-- ── Permisos de lectura (en CampaignSuite se dan tabla por tabla y columna por columna; acá, lectura con las reglas
-- por fila y todo para la clave de servicio, que es con la que se carga la semilla de desarrollo) ──────────────

grant select on all tables in schema core to authenticated;
grant all on all tables in schema core to service_role;
grant usage, select on all sequences in schema core to service_role;
grant execute on all functions in schema core to authenticated, service_role;

commit;
