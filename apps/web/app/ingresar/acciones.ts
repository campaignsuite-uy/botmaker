'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { iniciarSesionDemo, urlIngresoGoogle } from '@campaignsuite/platform/sesion';

/** Demo: entrar como una persona de prueba. */
export async function entrarComo(formData: FormData) {
  const persona = String(formData.get('persona') ?? '');
  await iniciarSesionDemo(persona);
  redirect('/');
}

/** Origen de la app para la vuelta de Google: CAMPAIGNSUITE_URL o el del pedido. */
async function origen(): Promise<string> {
  const fijo = process.env.CAMPAIGNSUITE_URL;
  if (fijo) return fijo.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** Ingreso con Google: Supabase Auth arma la dirección de Google y guarda en una cookie el código de verificación. */
export async function entrarConGoogle() {
  const url = await urlIngresoGoogle(await origen());
  redirect(url);
}
