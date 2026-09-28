import { NextResponse, type NextRequest } from 'next/server';
import { modoDatos, soloLectura } from '@campaignsuite/platform/entorno';

/**
 * Proxy de Next (antes "middleware"), antes de cada pedido:
 *  - Con la base real (CAMPAIGNSUITE_DATOS=supabase): renueva la sesión de Supabase Auth y escribe las cookies
 *    nuevas (los componentes del servidor no pueden escribirlas). Ver @campaignsuite/platform/supabase-servidor.
 *  - En la demo online de solo lectura (soloLectura) rechaza todo pedido que no sea de lectura: las acciones del
 *    servidor llegan por POST. La única excepción es elegir persona en /ingresar, que solo guarda una cookie. Es la
 *    segunda de tres capas (ver entorno.ts).
 */
export async function proxy(request: NextRequest) {
  if (modoDatos() === 'supabase') {
    let respuesta = NextResponse.next({ request });
    const { renovarSesion } = await import('@campaignsuite/platform/supabase-servidor');
    try {
      await renovarSesion(
        () => request.cookies.getAll(),
        (lista) => {
          for (const { name, value } of lista) request.cookies.set(name, value);
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of lista) respuesta.cookies.set(name, value, options);
        },
      );
    } catch (e) {
      console.warn(`[proxy] No se pudo renovar la sesión: ${(e as Error).message}`);
    }
    return respuesta;
  }
  if (!soloLectura()) return NextResponse.next();
  const metodo = request.method.toUpperCase();
  if (metodo === 'GET' || metodo === 'HEAD') return NextResponse.next();
  if (metodo === 'POST' && request.nextUrl.pathname === '/ingresar') return NextResponse.next();
  return new NextResponse('Demo online de solo lectura: no se guarda ningún cambio.', {
    status: 403,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const config = {
  // Todo menos los archivos estáticos que arma Next.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
