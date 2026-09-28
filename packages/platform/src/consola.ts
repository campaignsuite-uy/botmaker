/**
 * Consola del producto (entrega 2, 2.16): lo que ve y hace el Administrador de CampaignSuite. SOLO SERVIDOR y solo con
 * la base real (CAMPAIGNSUITE_DATOS=supabase).
 *
 * Todo se lee y se hace con la sesión de la persona: las reglas por fila le muestran todas las organizaciones (a un
 * Administrador de CampaignSuite) y las funciones de la base (0006_acceso.sql) vuelven a exigir que lo sea. Llenar una
 * demo, que usa la clave de servicio, lo hace el módulo (datos/supabase/demo-nube.ts) después de que la base la creó.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { aSlug } from './entorno';
import { CORREO, ErrorNucleo, aOrganizacion, aPersona } from './nucleo';
import { ErrorBase, exigirSinError } from './supabase-servidor';
import type { Organizacion, Persona } from './tipos';

/** Direcciones que no puede usar una organización: son rutas de la app (también lo exige la base). */
export const SLUGS_RESERVADOS = ['consola', 'ingresar', 'salir', 'auth', 'descargas', 'fichas', 'imprimir', 'api', 'inicio'];
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface OrganizacionConsola extends Organizacion {
  creada: string;
  /** Cliente: su Dueño (o la invitación pendiente). Demo: quiénes tienen acceso y las invitaciones pendientes. */
  personas: { id: string | null; nombre: string; email: string; rol: string; pendiente: boolean; invitacionId: string | null }[];
  campanas: number;
  avance: { hechas: number; total: number; error: string | null } | null;
}

export interface DatosConsola {
  organizaciones: OrganizacionConsola[];
  admins: { email: string; nombre: string | null; desde: string; delServidor: boolean }[];
}

interface FilaOrgConsola {
  id: string; slug: string; name: string; kind: Organizacion['tipo']; country_iso: string; is_demo: boolean; demo_status: 'cargando' | 'lista' | null;
  demo_source: string | null; created_at: string; demo_progress: { hechas?: number; total?: number; error?: string | null } | null;
}

export async function datosConsola(cliente: SupabaseClient, adminsDelServidor: string[]): Promise<DatosConsola> {
  const core = cliente.schema('core');
  const [orgsR, miembrosR, invR, adminsR, campR] = await Promise.all([
    core.from('organizations').select('id, slug, name, kind, country_iso, is_demo, demo_status, demo_source, created_at, demo_progress').order('is_demo').order('name'),
    core.from('organization_members').select('organization_id, profile_id, role, status'),
    core.from('invitations').select('id, organization_id, email, role, created_at').is('accepted_at', null).is('cancelled_at', null),
    core.from('platform_admins').select('email, created_at').order('created_at'),
    core.from('campaigns').select('id, organization_id'),
  ]);
  const orgs = exigirSinError(orgsR, 'leer las organizaciones') as FilaOrgConsola[];
  const miembros = exigirSinError(miembrosR, 'leer los miembros') as { organization_id: string; profile_id: string; role: string; status: string }[];
  const invitaciones = exigirSinError(invR, 'leer las invitaciones') as { id: string; organization_id: string; email: string; role: string; created_at: string }[];
  const admins = exigirSinError(adminsR, 'leer los Administradores de CampaignSuite') as { email: string; created_at: string }[];
  // Las campañas que ve: las de las demos (las de los clientes no, salvo que sea miembro).
  const campanas = (campR.error ? [] : campR.data ?? []) as { id: string; organization_id: string }[];
  const idsPerfiles = [...new Set(miembros.map((m) => m.profile_id))];
  const perfiles = idsPerfiles.length
    ? (exigirSinError(await core.from('profiles').select('id, full_name, email').in('id', idsPerfiles), 'leer las personas') as { id: string; full_name: string; email: string }[]).map(aPersona)
    : [];
  const persona = (id: string): Persona | undefined => perfiles.find((p) => p.id === id);
  const porEmail = new Map(perfiles.map((p) => [p.email.toLowerCase(), p]));
  const ROL: Record<string, string> = { dueno: 'Dueño', admin: 'Administrador de la organización', miembro: 'Miembro' };
  return {
    organizaciones: orgs.map((f) => {
      const o = aOrganizacion(f);
      const deOrg = miembros.filter((m) => m.organization_id === f.id && m.status === 'activo' && (f.is_demo || m.role === 'dueno'));
      const pendientes = invitaciones.filter((i) => i.organization_id === f.id && (f.is_demo || i.role === 'dueno'));
      const p = f.demo_progress;
      return {
        ...o,
        creada: f.created_at,
        personas: [
          ...deOrg.map((m) => ({ id: m.profile_id, nombre: persona(m.profile_id)?.nombre ?? m.profile_id, email: persona(m.profile_id)?.email ?? '', rol: f.is_demo ? 'Acceso a la demo' : ROL[m.role] ?? m.role, pendiente: false, invitacionId: null })),
          ...pendientes.map((i) => ({ id: null, nombre: i.email, email: i.email, rol: f.is_demo ? 'Acceso a la demo' : ROL[i.role] ?? i.role, pendiente: true, invitacionId: i.id })),
        ],
        campanas: campanas.filter((c) => c.organization_id === f.id).length,
        avance: f.is_demo && p ? { hechas: p.hechas ?? 0, total: p.total ?? 0, error: p.error ?? null } : null,
      };
    }),
    admins: admins.map((a) => ({ email: a.email, nombre: porEmail.get(a.email)?.nombre ?? null, desde: a.created_at, delServidor: adminsDelServidor.includes(a.email) })),
  };
}

// ── Operaciones (las vuelve a exigir la base) ───────────────────────────────────────────────────

function traducir(e: unknown): never {
  if (e instanceof ErrorBase) {
    const m = e.message;
    if (e.codigo === '42501') throw new ErrorNucleo('sin_permiso', m);
    if (e.codigo === '23505' && /slug|organizations_slug/.test(m)) throw new ErrorNucleo('slug_usado', m);
    if (/organizations_slug_libre/.test(m)) throw new ErrorNucleo('slug_reservado', m);
    if (/ya tiene acceso|ya es miembro/.test(m)) throw new ErrorNucleo('ya_tiene_acceso', m);
    if (/correo no es válido/.test(m)) throw new ErrorNucleo('correo', m);
    if (/al menos un Administrador/.test(m)) throw new ErrorNucleo('ultimo_admin', m);
    throw new ErrorNucleo('no_se_pudo', m);
  }
  throw e;
}

async function correr<T>(p: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, que: string): Promise<T> {
  try {
    return exigirSinError(await p, que);
  } catch (e) {
    traducir(e);
  }
}

export function validarSlug(slug: string): string {
  const s = aSlug(slug);
  if (!SLUG.test(s) || s.length > 60) throw new ErrorNucleo('slug');
  if (SLUGS_RESERVADOS.includes(s)) throw new ErrorNucleo('slug_reservado');
  return s;
}

function validarCorreo(email: string): string {
  const m = email.trim().toLowerCase();
  if (!CORREO.test(m) || m.length > 200) throw new ErrorNucleo('correo');
  return m;
}

export async function crearOrganizacionCliente(cliente: SupabaseClient, d: { nombre: string; slug: string; tipo: Organizacion['tipo']; pais: string; emailDueno: string }): Promise<string> {
  if (!d.nombre.trim() || d.nombre.length > 120) throw new ErrorNucleo('nombre');
  if (!['agencia', 'partido', 'campana'].includes(d.tipo)) throw new ErrorNucleo('tipo');
  if (!/^[A-Za-z]{2}$/.test(d.pais)) throw new ErrorNucleo('pais');
  return String(await correr(cliente.schema('core').rpc('crear_organizacion', {
    nombre: d.nombre.trim(), slug: validarSlug(d.slug || d.nombre), tipo: d.tipo, pais: d.pais.toUpperCase(), correo_dueno: validarCorreo(d.emailDueno),
  }), 'crear la organización'));
}

/** Crea la organización demo vacía ("cargando"). La llena el módulo (demo-nube.ts). */
export async function crearOrganizacionDemo(cliente: SupabaseClient, d: { nombre: string; slug: string; origen: string }): Promise<string> {
  if (!d.nombre.trim() || d.nombre.length > 120) throw new ErrorNucleo('nombre');
  return String(await correr(cliente.schema('core').rpc('crear_demo', { nombre: d.nombre.trim(), slug: validarSlug(d.slug || d.nombre), origen: d.origen }), 'crear la demo'));
}

export async function darAccesoDemo(cliente: SupabaseClient, organizacionId: string, email: string): Promise<void> {
  await correr(cliente.schema('core').rpc('dar_acceso_demo', { org: organizacionId, correo: validarCorreo(email) }), 'dar acceso a la demo');
}

export async function quitarAccesoDemo(cliente: SupabaseClient, organizacionId: string, personaId: string): Promise<void> {
  await correr(cliente.schema('core').rpc('quitar_acceso_demo', { org: organizacionId, persona: personaId }), 'quitar el acceso');
}

export async function cancelarInvitacionConsola(cliente: SupabaseClient, invitacionId: string): Promise<void> {
  await correr(cliente.schema('core').rpc('cancelar_invitacion', { invitacion: invitacionId }), 'cancelar la invitación');
}

export async function agregarAdminProducto(cliente: SupabaseClient, email: string): Promise<void> {
  await correr(cliente.schema('core').rpc('agregar_admin_producto', { correo: validarCorreo(email) }), 'sumar al Administrador de CampaignSuite');
}

export async function quitarAdminProducto(cliente: SupabaseClient, email: string): Promise<void> {
  await correr(cliente.schema('core').rpc('quitar_admin_producto', { correo: validarCorreo(email) }), 'quitar al Administrador de CampaignSuite');
}
