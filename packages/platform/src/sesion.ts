/**
 * Sesión de la plataforma (solo servidor). Dos modos, según CAMPAIGNSUITE_DATOS (entorno.ts → modoDatos):
 *
 *  - demo: ingreso de prueba. Una cookie con el id de la persona elegida en /ingresar; el núcleo es la demo en
 *    memoria (nucleo.ts → nucleoMemoria).
 *  - supabase: ingreso con Google por Supabase Auth (2.1). La sesión vive en las cookies de @supabase/ssr; la
 *    persona es su perfil de core.profiles (id = auth.users.id) y el núcleo se lee con sus reglas por fila. Al
 *    ingresar se aceptan sus invitaciones pendientes y, si su correo está en CAMPAIGNSUITE_ADMINS_PRODUCTO, queda
 *    como Administrador de CampaignSuite (2.16).
 *
 * El resto de la app no cambia entre modos (docs/decisiones.md D-004 y D-077).
 */
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { DatosNucleo } from './accesos';
import { modoDatos } from './entorno';
import { NUCLEO_DEMO } from './demo';
import { iniciales } from './nombres';
import { nucleoMemoria, operacionesCampanaMemoria, operacionesMemoria, type OperacionesCampana, type OperacionesOrganizacion } from './memoria';
import { nucleoSupabase, operacionesCampanaSupabase, operacionesSupabase } from './nucleo';
import { clienteServicio, clienteSesion } from './supabase-servidor';
import type { Persona } from './tipos';

export const COOKIE_SESION = 'campaignsuite_persona';

/** Persona de la sesión, o null si no ingresó. */
export const personaActual = cache(async (): Promise<Persona | null> => {
  if (modoDatos() === 'demo') {
    const id = (await cookies()).get(COOKIE_SESION)?.value;
    return nucleoMemoria().personas.find((p) => p.id === id) ?? null;
  }
  const cliente = await clienteSesion();
  const { data } = await cliente.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: perfil } = await cliente.schema('core').from('profiles').select('id, full_name, email').eq('id', claims.sub).maybeSingle();
  const email = (perfil?.email as string | undefined) ?? (typeof claims.email === 'string' ? claims.email : '');
  const nombre = (perfil?.full_name as string | undefined) || email;
  return { id: claims.sub, nombre, email, iniciales: iniciales(nombre === email ? '' : nombre, email) };
});

/** Núcleo que ve la persona de la sesión (vacío si no ingresó). */
export const nucleoActual = cache(async (): Promise<DatosNucleo> => {
  if (modoDatos() === 'demo') return nucleoMemoria();
  const persona = await personaActual();
  if (!persona) return { personas: [], organizaciones: [], miembros: [], contratados: [], campanas: [], integrantes: [], accesos: [], invitaciones: [], adminProducto: false };
  return nucleoSupabase(await clienteSesion(), persona.id);
});

/** Lo que el Dueño y el Administrador de la organización cambian en Organización, como la persona de la sesión. */
export async function operacionesOrganizacion(personaId: string): Promise<OperacionesOrganizacion> {
  return modoDatos() === 'demo' ? operacionesMemoria(personaId) : operacionesSupabase(await clienteSesion(), personaId);
}

/** Lo que cambia quien administra una campaña (y crear campañas), como la persona de la sesión (2.23). */
export async function operacionesCampana(personaId: string): Promise<OperacionesCampana> {
  return modoDatos() === 'demo' ? operacionesCampanaMemoria(personaId) : operacionesCampanaSupabase(await clienteSesion());
}

/**
 * Token de acceso de Supabase de la sesión (para que el repositorio del módulo lea y escriba con las reglas por
 * fila de la persona). null en la demo o sin sesión. La base verifica la firma.
 */
export async function tokenSupabase(): Promise<string | null> {
  if (modoDatos() === 'demo') return null;
  const cliente = await clienteSesion();
  const { data } = await cliente.auth.getSession();
  return data.session?.access_token ?? null;
}

// ── Demo: ingreso de prueba ─────────────────────────────────────────────────────────────────────

export async function iniciarSesionDemo(personaId: string): Promise<void> {
  if (modoDatos() !== 'demo') throw new Error('El ingreso de prueba es solo para la demo.');
  if (!NUCLEO_DEMO.personas.some((p) => p.id === personaId)) throw new Error('Persona desconocida');
  (await cookies()).set(COOKIE_SESION, personaId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
}

// ── Supabase: ingreso con Google ────────────────────────────────────────────────────────────────

/** Dirección de Google para ingresar; al volver, Supabase manda a `${origen}/auth/callback`. */
export async function urlIngresoGoogle(origen: string): Promise<string> {
  const cliente = await clienteSesion();
  const { data, error } = await cliente.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origen}/auth/callback`, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data.url) throw new Error(`No se pudo empezar el ingreso con Google: ${error?.message ?? 'sin dirección'}`);
  return data.url;
}

/** Correos de los Administradores de CampaignSuite que fija el servidor (CAMPAIGNSUITE_ADMINS_PRODUCTO, separados por coma). */
export function adminsDelServidor(): string[] {
  return (process.env.CAMPAIGNSUITE_ADMINS_PRODUCTO ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/**
 * Vuelta de Google (/auth/callback): cambia el código por la sesión (cookies), suma al Administrador de CampaignSuite
 * que fija el servidor y acepta las invitaciones pendientes de ese correo.
 */
export async function completarIngreso(codigo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const cliente = await clienteSesion();
  const { data, error } = await cliente.auth.exchangeCodeForSession(codigo);
  if (error || !data.session) return { ok: false, error: error?.message ?? 'sin sesión' };
  const email = (data.session.user.email ?? '').toLowerCase();
  if (email && adminsDelServidor().includes(email)) {
    const r = await clienteServicio().schema('core').from('platform_admins').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
    if (r.error) console.warn(`[ingreso] No se pudo sumar a ${email} como Administrador de CampaignSuite: ${r.error.message}`);
  }
  await aceptarInvitaciones();
  return { ok: true };
}

/** Acepta las invitaciones pendientes del correo de la sesión (al ingresar y al volver al inicio). Devuelve cuántas. */
export async function aceptarInvitaciones(): Promise<number> {
  if (modoDatos() === 'demo') return 0;
  const cliente = await clienteSesion();
  const { data, error } = await cliente.schema('core').rpc('aceptar_invitaciones');
  if (error) {
    console.warn(`[ingreso] No se pudieron aceptar las invitaciones: ${error.message}`);
    return 0;
  }
  return Number(data ?? 0);
}

export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies();
  almacen.delete(COOKIE_SESION);
  if (modoDatos() === 'supabase') {
    const cliente = await clienteSesion();
    await cliente.auth.signOut();
  }
}
