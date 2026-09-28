-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0001_invitaciones.sql — SOLO DESARROLLO. Las invitaciones de CampaignSuite (core.invitations), que el núcleo mínimo
-- deja afuera, en la medida que las usa la plataforma copiada: el núcleo las lee (nucleo.ts → nucleoSupabase) y el
-- ingreso acepta las pendientes (core.aceptar_invitaciones). Sacado de referencia-core-completo.sql (ef6a364), sin la
-- función panelista de AI Positioning. Invitar se hace en CampaignSuite; acá, a mano con SQL si hace falta.
-- Al integrar, este archivo se descarta: CampaignSuite ya tiene todo esto.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

begin;

CREATE TABLE core.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL,
    assignments jsonb DEFAULT '[]'::jsonb NOT NULL,
    invited_by uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
    cancelled_at timestamp with time zone,
    CONSTRAINT invitations_assignments_check CHECK ((jsonb_typeof(assignments) = 'array'::text)),
    CONSTRAINT invitations_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text))),
    CONSTRAINT invitations_role_check CHECK ((role = ANY (ARRAY['dueno'::text, 'admin'::text, 'miembro'::text])))
);
COMMENT ON TABLE core.invitations IS 'Invitación a una organización por correo de Google, con su rol y sus asignaciones de campaña (extracto de desarrollo).';
CREATE INDEX invitations_email ON core.invitations USING btree (email) WHERE ((accepted_at IS NULL) AND (cancelled_at IS NULL));
CREATE UNIQUE INDEX invitations_pendiente ON core.invitations USING btree (organization_id, email) WHERE ((accepted_at IS NULL) AND (cancelled_at IS NULL));

CREATE FUNCTION core.normalizar_asignaciones(asignaciones jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
declare
  a jsonb;
  p jsonb;
  campana text;
  e jsonb;
  nuevos jsonb;
  salida jsonb := '{}';
begin
  if asignaciones is null or jsonb_typeof(asignaciones) <> 'array' then
    return '[]';
  end if;
  for a in select * from jsonb_array_elements(asignaciones) loop
    campana := a ->> 'campana';
    if campana is null then
      continue;
    end if;
    e := coalesce(salida -> campana, jsonb_build_object('campana', campana, 'rolCampana', 'integrante', 'productos', '[]'::jsonb));
    if a ? 'rolCampana' and nullif(a ->> 'rolCampana', '') is not null then
      e := jsonb_set(e, '{rolCampana}', a -> 'rolCampana');
    end if;
    nuevos := case
      when a ? 'productos' then coalesce(a -> 'productos', '[]'::jsonb)
      when a ? 'rol' then jsonb_build_array(jsonb_build_object(
        'producto', coalesce(a ->> 'producto', 'ai_positioning'), 'rol', a -> 'rol', 'panelista', coalesce((a ->> 'panelista')::boolean, false)))
      else '[]'::jsonb
    end;
    for p in select * from jsonb_array_elements(nuevos) loop
      e := jsonb_set(e, '{productos}',
        (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(e -> 'productos') x where x ->> 'producto' is distinct from p ->> 'producto')
        || jsonb_build_array(jsonb_build_object('producto', p ->> 'producto', 'rol', p -> 'rol', 'panelista', coalesce((p ->> 'panelista')::boolean, false))));
    end loop;
    salida := jsonb_set(salida, array[campana], e);
  end loop;
  return (select coalesce(jsonb_agg(v order by k), '[]'::jsonb) from jsonb_each(salida) as t(k, v));
end $$;

CREATE FUNCTION core.aceptar_invitaciones() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  yo uuid := auth.uid();
  mail text;
  inv record;
  a jsonb;
  p jsonb;
  campana uuid;
  producto text;
  ro text;
  rc text;
  n integer := 0;
begin
  if yo is null then
    return 0;
  end if;
  -- Solo con el correo confirmado (con Google siempre lo está): una invitación es para quien tiene ese correo.
  select lower(pf.email) into mail from core.profiles pf join auth.users u on u.id = pf.id and u.email_confirmed_at is not null where pf.id = yo;
  if mail is null or mail = '' then
    return 0;
  end if;
  perform set_config('campaignsuite.aceptando', 'si', true);
  for inv in
    select * from core.invitations i where i.email = mail and i.accepted_at is null and i.cancelled_at is null order by i.created_at
  loop
    insert into core.organization_members (organization_id, profile_id, role, status, invited_by)
    values (inv.organization_id, yo, inv.role, 'activo', inv.invited_by)
    on conflict (organization_id, profile_id) do update
      set status = 'activo',
          role = case when core.organization_members.role = 'dueno' then 'dueno' else excluded.role end;
    select m.role into ro from core.organization_members m where m.organization_id = inv.organization_id and m.profile_id = yo;
    for a in select * from jsonb_array_elements(core.normalizar_asignaciones(inv.assignments)) loop
      campana := (a ->> 'campana')::uuid;
      if not exists (select 1 from core.campaigns c where c.id = campana and c.organization_id = inv.organization_id) then
        continue;
      end if;
      if ro in ('dueno', 'admin') then
        rc := 'administrador';
      else
        insert into core.campaign_members (organization_id, campaign_id, profile_id, role, added_by)
        values (inv.organization_id, campana, yo, coalesce(a ->> 'rolCampana', 'integrante'), inv.invited_by)
        on conflict (campaign_id, profile_id) do update
          set role = case when core.campaign_members.role = 'administrador' then 'administrador' else excluded.role end;
        select cm.role into rc from core.campaign_members cm where cm.campaign_id = campana and cm.profile_id = yo;
      end if;
      for p in select * from jsonb_array_elements(coalesce(a -> 'productos', '[]')) loop
        producto := p ->> 'producto';
        if not exists (select 1 from core.campaign_products cp where cp.campaign_id = campana and cp.product_id = producto) then
          continue;
        end if;
        if rc = 'integrante' and nullif(p ->> 'rol', '') is not null then
          insert into core.campaign_access (organization_id, campaign_id, product_id, profile_id, role, granted_by)
          values (inv.organization_id, campana, producto, yo, p ->> 'rol', inv.invited_by)
          on conflict (campaign_id, product_id, profile_id) do update set role = excluded.role;
        end if;
      end loop;
    end loop;
    update core.invitations set accepted_at = now(), accepted_by = yo where id = inv.id;
    n := n + 1;
  end loop;
  perform set_config('campaignsuite.aceptando', '', true);
  return n;
end $$;

ALTER TABLE core.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invitaciones de una campaña: quien arma su equipo" ON core.invitations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM jsonb_array_elements(invitations.assignments) a(value)
  WHERE core.administra_en_campana(((a.value ->> 'campana'::text))::uuid))));
CREATE POLICY "invitaciones: las ven Dueño y Administrador de la organización" ON core.invitations FOR SELECT TO authenticated USING (((core.rol_en_organizacion(organization_id) = ANY (ARRAY['dueno'::text, 'admin'::text])) OR core.es_admin_producto()));

grant select on core.invitations to authenticated;
grant all on core.invitations to service_role;
grant execute on function core.normalizar_asignaciones(jsonb) to authenticated, service_role;
grant execute on function core.aceptar_invitaciones() to authenticated, service_role;

commit;
