import { NextResponse } from 'next/server';
import { cerrarSesion } from '@campaignsuite/platform/sesion';

/** Cerrar sesión desde cualquier pantalla (2.1): borra la sesión de prueba o la de Supabase Auth. */
export async function GET(request: Request) {
  await cerrarSesion();
  return NextResponse.redirect(new URL('/ingresar', request.url));
}
