import { NextResponse } from 'next/server';
import { modoDatos } from '@campaignsuite/platform';
import { completarIngreso } from '@campaignsuite/platform/sesion';

/**
 * Vuelta del ingreso con Google (2.1): Supabase Auth manda acá con ?code=. Se cambia el código por la sesión
 * (cookies), se suma al Administrador de CampaignSuite que fija el servidor y se aceptan las invitaciones
 * pendientes de ese correo. Después, al inicio. Si algo falla, a /ingresar con el error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (modoDatos() !== 'supabase') return NextResponse.redirect(new URL('/ingresar', url));
  const codigo = url.searchParams.get('code');
  const errorGoogle = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  // La pantalla de ingreso muestra solo mensajes propios (un texto armado en la dirección no se muestra).
  if (!codigo) {
    if (errorGoogle) console.warn(`[ingreso] Google/Supabase devolvió un error: ${errorGoogle.slice(0, 300)}`);
    return NextResponse.redirect(new URL(`/ingresar?error=${errorGoogle ? 'google' : 'sin_codigo'}`, url));
  }
  const r = await completarIngreso(codigo);
  if (!r.ok) {
    console.warn(`[ingreso] No se pudo completar el ingreso: ${r.error.slice(0, 300)}`);
    return NextResponse.redirect(new URL('/ingresar?error=sesion', url));
  }
  return NextResponse.redirect(new URL('/', url));
}
