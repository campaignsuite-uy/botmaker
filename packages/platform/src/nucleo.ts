/**
 * El núcleo de la plataforma (personas, organizaciones, membresías, productos, campañas, integrantes, accesos e
 * invitaciones) y lo que se cambia en él: la organización, su Dueño y su Administrador (2.3); cada campaña, quien la
 * administra (2.23); cada producto de la campaña, su Administrador (2.24).
 * Dos implementaciones con las mismas reglas:
 *
 *  - Memoria (CAMPAIGNSUITE_DATOS=demo): memoria.ts, una copia de NUCLEO_DEMO que vive mientras el servidor está
 *    prendido. Las invitaciones quedan pendientes (en la demo nadie entra con Google).
 *  - Supabase (acá): el esquema core visto con la sesión de la persona. Las reglas las vuelve a exigir la base (reglas
 *    por fila y funciones de 0006_acceso.sql, 0008_campana_en_organizacion.sql y 0009_roles_por_nivel.sql); las funciones de acá no confían en
 *    el navegador.
 *
 * Solo servidor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatosNucleo } from './accesos';
import {
  CORREO, ErrorNucleo, ROLES_CAMPANA, sumarAsignaciones, type AsignacionInvitacion, type OperacionesCampana, type OperacionesOrganizacion,
  type ResultadoInvitacionCampana,
} from './memoria';
import { iniciales, registrarNombres } from './nombres';
import { ErrorBase, exigirSinError } from './supabase-servidor';
import type { CampanaPlataforma, EtapaCampana, Invitacion, Organizacion, Persona, RolCampana, RolOrganizacion } from './tipos';

export {
  CORREO, ErrorNucleo, ROLES_CAMPANA, nucleoMemoria, operacionesCampanaMemoria, operacionesMemoria, reiniciarNucleoMemoria, sumarAsignaciones,
  type AsignacionInvitacion, type CambiosCampana, type NuevaCampanaPlataforma, type OperacionesCampana, type OperacionesOrganizacion,
  type ResultadoInvitacionCampana,
} from './memoria';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Supabase
// ═══════════════════════════════════════════════════════════════════════════════════════════════

interface FilaOrg { id: string; slug: string; name: string; kind: Organizacion['tipo']; country_iso: string; is_demo: boolean; demo_status: 'cargando' | 'lista' | null; demo_source: string | null }
interface FilaMiembro { organization_id: string; profile_id: string; role: RolOrganizacion; status: 'invitado' | 'activo' | 'suspendido' }
interface FilaPerfil { id: string; full_name: string; email: string }
/** Una asignación de una invitación en la base: una por campaña (0009); acepta la de 0008 (una por producto). */
interface FilaAsignacion {
  campana: string;
  rolCampana?: RolCampana;
  productos?: { producto: string; rol: string | null; panelista: boolean }[];
  producto?: string;
  rol?: string;
  panelista?: boolean;
}
interface FilaInvitacion { id: string; organization_id: string; email: string; role: RolOrganizacion; assignments: FilaAsignacion[]; invited_by: string | null; created_at: string }
interface FilaIntegrante { organization_id: string; campaign_id: string; profile_id: string; role: RolCampana }
export interface FilaCampanaCore {
  id: string; organization_id: string; slug: string; name: string; status: 'activa' | 'archivada'; country_iso: string; country_name: string;
  city: string; region: string; timezone: string; latitude: number | string; longitude: number | string; language: string;
  election_date: string | null; stage: EtapaCampana;
}
interface FilaProductoCampana { campaign_id: string; product_id: string; status: 'activo' | 'suspendido' }
interface FilaAcceso { organization_id: string; campaign_id: string; product_id: string; profile_id: string; role: string }

/** Columnas de core.campaigns que se leen (también las usa el repositorio del módulo). */
export const COLUMNAS_CAMPANA_CORE = 'id, organization_id, slug, name, status, country_iso, country_name, city, region, timezone, latitude, longitude, language, election_date, stage';

export const aOrganizacion = (f: FilaOrg): Organizacion => ({
  id: f.id, slug: f.slug, nombre: f.name, tipo: f.kind, paisIso: f.country_iso, demo: f.is_demo, estadoDemo: f.demo_status, origenDemo: f.demo_source,
});

export const aPersona = (f: FilaPerfil): Persona => ({
  id: f.id, nombre: f.full_name || f.email, email: f.email, iniciales: iniciales(f.full_name, f.email),
});

/** Una fila de core.campaigns (sin sus productos: van aparte). */
export const aCampana = (f: FilaCampanaCore, productos: CampanaPlataforma['productos'] = []): CampanaPlataforma => ({
  id: f.id,
  organizacionId: f.organization_id,
  slug: f.slug,
  nombre: f.name,
  estado: f.status,
  ubicacion: {
    paisIso: f.country_iso, pais: f.country_name, ciudad: f.city, region: f.region, zonaHoraria: f.timezone,
    latitud: Number(f.latitude), longitud: Number(f.longitude), idioma: f.language,
  },
  etapa: f.stage,
  fechaEleccion: f.election_date ? String(f.election_date).slice(0, 10) : null,
  productos,
});

const aAsignaciones = (filas: FilaAsignacion[]): AsignacionInvitacion[] => sumarAsignaciones([], (filas ?? []).map((a) => ({
  campanaId: a.campana,
  rolCampana: a.rolCampana ?? 'integrante',
  productos: a.productos
    ? a.productos.map((p) => ({ productoId: p.producto, rol: p.rol ?? null, panelista: !!p.panelista }))
    : a.rol ? [{ productoId: a.producto ?? 'ai_positioning', rol: a.rol, panelista: !!a.panelista }] : [],
})));

const aInvitacion = (f: FilaInvitacion): Invitacion => ({
  id: f.id, organizacionId: f.organization_id, email: f.email, rol: f.role,
  asignaciones: aAsignaciones(f.assignments),
  invitadaPor: f.invited_by, fecha: f.created_at,
});

/** Núcleo de la persona de la sesión, leído con sus reglas por fila. */
export async function nucleoSupabase(cliente: SupabaseClient, personaId: string): Promise<DatosNucleo> {
  const core = cliente.schema('core');
  const [admin, misMiembros] = await Promise.all([
    core.rpc('es_admin_producto'),
    core.from('organization_members').select('organization_id, profile_id, role, status').eq('profile_id', personaId),
  ]);
  const adminProducto = exigirSinError(admin, 'ver si sos Administrador de CampaignSuite') === true;
  const mias = exigirSinError(misMiembros, 'leer tus organizaciones') as FilaMiembro[];
  // Las organizaciones donde es miembro (activo o no) y, si es Administrador de CampaignSuite, todas las demos.
  let consulta = core.from('organizations').select('id, slug, name, kind, country_iso, is_demo, demo_status, demo_source');
  const idsMias = [...new Set(mias.map((m) => m.organization_id))];
  consulta = adminProducto
    ? idsMias.length ? consulta.or(`is_demo.eq.true,id.in.(${idsMias.join(',')})`) : consulta.eq('is_demo', true)
    : consulta.in('id', idsMias.length ? idsMias : ['00000000-0000-0000-0000-000000000000']);
  const orgs = (exigirSinError(await consulta.order('name'), 'leer las organizaciones') as FilaOrg[]).map(aOrganizacion);
  const ids = orgs.map((o) => o.id);
  const sinIds = !ids.length;
  const vacio = { data: [], error: null };
  const [miembrosR, contratadosR, campanasR, productosR, integrantesR, accesosR, invitacionesR] = sinIds ? [vacio, vacio, vacio, vacio, vacio, vacio, vacio] : await Promise.all([
    core.from('organization_members').select('organization_id, profile_id, role, status').in('organization_id', ids),
    core.from('organization_products').select('organization_id, product_id, status').in('organization_id', ids),
    core.from('campaigns').select(COLUMNAS_CAMPANA_CORE).in('organization_id', ids).order('name'),
    core.from('campaign_products').select('campaign_id, product_id, status').in('organization_id', ids),
    core.from('campaign_members').select('organization_id, campaign_id, profile_id, role').in('organization_id', ids),
    core.from('campaign_access').select('organization_id, campaign_id, product_id, profile_id, role').in('organization_id', ids),
    core.from('invitations').select('id, organization_id, email, role, assignments, invited_by, created_at').in('organization_id', ids).is('accepted_at', null).is('cancelled_at', null).order('created_at'),
  ]);
  const miembros = (exigirSinError(miembrosR, 'leer los miembros') as FilaMiembro[]).filter((m) => m.status !== 'invitado');
  const idsPersonas = [...new Set([personaId, ...miembros.map((m) => m.profile_id)])];
  const perfiles = exigirSinError(await core.from('profiles').select('id, full_name, email').in('id', idsPersonas), 'leer las personas') as FilaPerfil[];
  const personas = perfiles.map(aPersona);
  registrarNombres(personas);
  const productos = exigirSinError(productosR, 'leer los productos de las campañas') as FilaProductoCampana[];
  return {
    personas,
    organizaciones: orgs,
    miembros: miembros.map((m) => ({ organizacionId: m.organization_id, personaId: m.profile_id, rol: m.role, estado: m.status === 'activo' ? 'activo' : 'suspendido' })),
    contratados: (exigirSinError(contratadosR, 'leer los productos') as { organization_id: string; product_id: string; status: 'activo' | 'suspendido' }[])
      .map((c) => ({ organizacionId: c.organization_id, productoId: c.product_id, estado: c.status })),
    campanas: (exigirSinError(campanasR, 'leer las campañas') as FilaCampanaCore[])
      .map((f) => aCampana(f, productos.filter((p) => p.campaign_id === f.id).map((p) => ({ productoId: p.product_id, estado: p.status })))),
    integrantes: (exigirSinError(integrantesR, 'leer los equipos de las campañas') as FilaIntegrante[])
      .map((i) => ({ organizacionId: i.organization_id, campanaId: i.campaign_id, personaId: i.profile_id, rol: i.role })),
    accesos: (exigirSinError(accesosR, 'leer los accesos') as FilaAcceso[])
      .map((a) => ({ organizacionId: a.organization_id, campanaId: a.campaign_id, productoId: a.product_id, personaId: a.profile_id, rol: a.role })),
    invitaciones: (exigirSinError(invitacionesR, 'leer las invitaciones') as FilaInvitacion[]).map(aInvitacion),
    adminProducto,
  };
}

/** Traduce los errores de la base a los códigos de las pantallas (Organización y Configuración de la campaña). */
function traducir(e: unknown): never {
  if (e instanceof ErrorBase) {
    const m = e.message;
    if (/demo/.test(m) && e.codigo === '42501') throw new ErrorNucleo('demo', m);
    if (e.codigo === '42501') throw new ErrorNucleo(/Dueño|dueño/.test(m) && !/invitan|cancelan|crean|habilitan/.test(m) ? 'dueno' : 'sin_permiso', m);
    if (/ya es miembro/.test(m)) throw new ErrorNucleo('ya_es_miembro', m);
    if (/correo no es válido/.test(m)) throw new ErrorNucleo('correo', m);
    if (/al menos un dueño/.test(m)) throw new ErrorNucleo('ultimo_dueno', m);
    if (/campaña no es de esta organización|No existe la campaña/.test(m)) throw new ErrorNucleo('campana', m);
    if (/invitación pendiente/.test(m)) throw new ErrorNucleo('invitacion', m);
    if (/no es miembro activo/.test(m)) throw new ErrorNucleo('persona', m);
    if (/no es integrante de la campaña/.test(m)) throw new ErrorNucleo('no_integrante', m);
    if (/son Administrador en todas las campañas|administran todas las campañas/.test(m)) throw new ErrorNucleo('admin_org', m);
    if (/Administrador en todos sus productos/.test(m)) throw new ErrorNucleo('admin_campana', m);
    if (/Rol de campaña no válido/.test(m)) throw new ErrorNucleo('rol_campana', m);
    if (/no incluye la campaña/.test(m)) throw new ErrorNucleo('invitacion', m);
    if (/no está habilitado en la campaña/.test(m)) throw new ErrorNucleo('producto', m);
    if (/Rol desconocido|panelista es de AI Positioning/.test(m)) throw new ErrorNucleo('rol', m);
    if (/desactivada en la organización/.test(m)) throw new ErrorNucleo('persona_suspendida', m);
    if (/panelista se suma a un rol/.test(m)) throw new ErrorNucleo('panelista_sin_rol', m);
    if (/candidato propio/.test(m)) throw new ErrorNucleo('propio', m);
    if (/campaigns_organization_id_slug_key|duplicate key.*slug/.test(m) || (e.codigo === '23505' && /slug/.test(m))) throw new ErrorNucleo('slug_usado', m);
    if (/campaigns_slug_libre/.test(m)) throw new ErrorNucleo('slug', m);
    throw new ErrorNucleo('no_se_pudo', m);
  }
  throw e;
}

async function correr<T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, que: string): Promise<T> {
  try {
    return exigirSinError(await p, que) as T;
  } catch (e) {
    traducir(e);
  }
}

export function operacionesSupabase(cliente: SupabaseClient, personaId: string): OperacionesOrganizacion {
  const core = cliente.schema('core');
  return {
    async invitar(org, email, rol, asignaciones) {
      const mail = email.trim().toLowerCase();
      if (!CORREO.test(mail)) throw new ErrorNucleo('correo');
      await correr(core.rpc('invitar', {
        org, correo: mail, rol, asignaciones: asignaciones.map(haciaAsignacion),
      }), 'invitar a la persona');
    },
    async cancelarInvitacion(id) {
      await correr(core.rpc('cancelar_invitacion', { invitacion: id }), 'cancelar la invitación');
    },
    async cambiarRol(org, persona, rol) {
      const r = await correr(core.from('organization_members').update({ role: rol }).eq('organization_id', org).eq('profile_id', persona).select('profile_id'), 'cambiar el rol');
      if (!(r as unknown[] | undefined)?.length) throw new ErrorNucleo('sin_permiso');
    },
    async cambiarEstado(org, persona, estado) {
      if (persona === personaId) throw new ErrorNucleo('vos');
      const r = await correr(core.from('organization_members').update({ status: estado }).eq('organization_id', org).eq('profile_id', persona).select('profile_id'), 'cambiar el estado');
      if (!(r as unknown[] | undefined)?.length) throw new ErrorNucleo('sin_permiso');
    },
  };
}

const haciaAsignacion = (a: AsignacionInvitacion) => ({
  campana: a.campanaId, rolCampana: a.rolCampana, productos: a.productos.map((p) => ({ producto: p.productoId, rol: p.rol, panelista: p.panelista })),
});

/** Lo que cambia quien administra una campaña (y la creación de campañas), con la sesión de la persona. */
export function operacionesCampanaSupabase(cliente: SupabaseClient): OperacionesCampana {
  const core = cliente.schema('core');
  return {
    async crearCampana(org, d) {
      const id = await correr(core.rpc('crear_campana', {
        org,
        datos: {
          slug: d.slug, nombre: d.nombre, ubicacion: d.ubicacion, etapa: d.etapa, fechaEleccion: d.fechaEleccion ?? '',
          productos: d.productos, ...d.porProducto,
        },
      }), 'crear la campaña');
      return String(id);
    },
    async guardarCampana(campanaId, cambios, porProducto) {
      await correr(core.rpc('guardar_campana', {
        campana: campanaId,
        datos: {
          ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
          ...(cambios.ubicacion ? { ubicacion: cambios.ubicacion } : {}),
          ...(cambios.etapa ? { etapa: cambios.etapa } : {}),
          ...(cambios.fechaEleccion !== undefined ? { fechaEleccion: cambios.fechaEleccion ?? '' } : {}),
          ...(cambios.estado ? { estado: cambios.estado } : {}),
          ...(porProducto ?? {}),
        },
      }), 'guardar los datos de la campaña');
    },
    async habilitarProducto(campanaId, productoId, activo, datos) {
      await correr(core.rpc('habilitar_producto', { campana: campanaId, producto: productoId, activo, datos: datos ?? null }), 'habilitar el producto');
    },
    async asignarRolCampana(campanaId, persona, rol) {
      await correr(core.rpc('asignar_rol_campana', { campana: campanaId, persona, rol }), 'cambiar el equipo de la campaña');
    },
    async asignarAcceso(campanaId, productoId, persona, rol) {
      await correr(core.rpc('asignar_acceso', { campana: campanaId, producto: productoId, persona, rol }), 'dar el acceso');
    },
    async invitarACampana(campanaId, email, rol): Promise<ResultadoInvitacionCampana> {
      const mail = email.trim().toLowerCase();
      if (!CORREO.test(mail)) throw new ErrorNucleo('correo');
      if (!ROLES_CAMPANA.includes(rol)) throw new ErrorNucleo('rol_campana');
      const r = await correr(core.rpc('invitar_a_campana', { campana: campanaId, correo: mail, rol }), 'invitar a la campaña') as
        { estado: 'agregada'; persona: string } | { estado: 'invitada'; invitacion: string };
      return r.estado === 'agregada' ? { estado: 'agregada', personaId: r.persona } : { estado: 'invitada', invitacionId: r.invitacion };
    },
    async asignarEnInvitacion(invitacionId, campanaId, productoId, rol, panelista) {
      await correr(core.rpc('asignar_en_invitacion', { invitacion: invitacionId, campana: campanaId, producto: productoId, rol, panelista }), 'cambiar la invitación');
    },
    async quitarDeInvitacion(invitacionId, campanaId) {
      await correr(core.rpc('quitar_de_invitacion', { invitacion: invitacionId, campana: campanaId }), 'cambiar la invitación');
    },
  };
}
