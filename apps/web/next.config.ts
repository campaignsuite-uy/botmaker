import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript; Next los compila.
  transpilePackages: ['@campaignsuite/ui', '@campaignsuite/platform', '@campaignsuite/botmaker'],
  typedRoutes: false,
  // El material de un bot se puede subir como archivo de texto de hasta 2 MB.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  // La app del equipo es privada: ningún buscador la indexa (también en los metadatos de app/layout.tsx).
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default config;
