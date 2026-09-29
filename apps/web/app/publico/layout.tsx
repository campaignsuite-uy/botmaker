import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { modoDatos } from '@campaignsuite/platform/entorno';
import '@campaignsuite/botmaker/ui/publico/estilos.css';

/**
 * SOLO EN LA DEMO: la app pública de BotMaker montada dentro de la app del equipo, para probar de punta a punta en un
 * mismo servidor (lo que conversa el widget aparece en la bandeja). La app pública de verdad es apps/bots-publico.
 * No se muda a CampaignSuite.
 */
export default function LayoutPublico({ children }: { children: ReactNode }) {
  if (modoDatos() !== 'demo') notFound();
  return children;
}
