import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@campaignsuite/botmaker/ui/publico/estilos.css';

export const metadata: Metadata = {
  title: 'Asistente de la campaña',
  description: 'Conversación con el asistente virtual de la campaña.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
