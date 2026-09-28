/**
 * Clientes de Supabase del servidor (solo servidor; nunca importarlo desde un componente de cliente).
 *
 *  - clienteSesion(): el de la persona del pedido en curso, con su sesión de Supabase Auth en las cookies
 *    (@supabase/ssr). Lee y escribe con las reglas por fila de la base.
 *  - clienteServicio(): con la clave de servicio (saltea las reglas por fila). Lo usan solo el ingreso (sumar a
 *    los Administradores de CampaignSuite que fija el servidor) y la carga de las demos, después de que la base
 *    confirma el permiso.
 *
 * Variables: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (o NEXT_PUBLIC_SUPABASE_ANON_KEY; la
 * clave pública, "publishable") y SUPABASE_SERVICE_ROLE_KEY (la clave de servicio, "secret"). Ver docs/despliegue.md.
 */
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export function urlSupabase(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Falta SUPABASE_URL (ver docs/despliegue.md).');
  return url;
}

function clavePublica(): string {
  const k = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!k) throw new Error('Falta SUPABASE_ANON_KEY, la clave pública de Supabase (ver docs/despliegue.md).');
  return k;
}

/** Cliente con la sesión de la persona (cookies del pedido). En un componente del servidor no se pueden escribir
 * cookies: el proxy (apps/web/proxy.ts) renueva la sesión antes, así que ahí se ignora. */
export async function clienteSesion(): Promise<SupabaseClient> {
  const almacen = await cookies();
  return createServerClient(urlSupabase(), clavePublica(), {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) almacen.set(name, value, options);
        } catch {
          // Componente del servidor: la sesión la renueva el proxy.
        }
      },
    },
  });
}

let servicio: SupabaseClient | null = null;

/** Cliente con la clave de servicio. SOLO SERVIDOR. */
export function clienteServicio(): SupabaseClient {
  if (servicio) return servicio;
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (ver docs/despliegue.md).');
  servicio = createClient(urlSupabase(), k, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return servicio;
}

/**
 * Renueva la sesión en el proxy (antes de cada pedido): lee las cookies del pedido y escribe las nuevas en la
 * respuesta. Devuelve si hay una persona con sesión.
 */
export async function renovarSesion(
  leer: () => { name: string; value: string }[],
  escribir: (lista: { name: string; value: string; options?: Record<string, unknown> }[]) => void,
): Promise<boolean> {
  const cliente = createServerClient(urlSupabase(), clavePublica(), {
    cookies: { getAll: leer, setAll: (lista) => escribir(lista as { name: string; value: string; options?: Record<string, unknown> }[]) },
  });
  const { data } = await cliente.auth.getClaims();
  return !!data?.claims?.sub;
}

/** Errores de la base que la app muestra como mensajes: el texto de la excepción, sin el código. */
export class ErrorBase extends Error {
  constructor(public readonly codigo: string, mensaje: string) {
    super(mensaje);
  }
}

export function exigirSinError<T>(r: { data: T; error: { message: string; code?: string } | null }, que: string): T {
  if (r.error) throw new ErrorBase(r.error.code ?? '', r.error.message || `No se pudo ${que}.`);
  return r.data;
}
