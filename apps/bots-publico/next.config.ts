import type { NextConfig } from 'next';

/**
 * La app pública de BotMaker (plan técnico, etapa 5): la página de cada bot, el widget que se pega en el sitio de la
 * campaña y las rutas que conversan. Otro proyecto de Vercel, aparte de la app del equipo: no comparte sesión con ella.
 */
const config: NextConfig = {
  transpilePackages: ['@campaignsuite/platform', '@campaignsuite/botmaker'],
  typedRoutes: false,
  poweredByHeader: false,
  async headers() {
    return [
      // La página del bot se muestra dentro del widget, en el sitio de cualquier campaña.
      { source: '/b/:path*', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
      // Lo demás no se muestra dentro de otros sitios ni se indexa.
      { source: '/((?!b/).*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default config;
