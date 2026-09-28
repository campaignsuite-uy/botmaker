import type { ReactNode } from 'react';
import { obtenerRepositorio } from '@campaignsuite/botmaker/datos';
import { Marco } from '@campaignsuite/botmaker/ui/marco';
import { datosMarco } from '@campaignsuite/botmaker/vistas/marco';
import { contextoBots, type Parametros } from '@/lib/modulo';

export default async function LayoutBots({ children, params }: { children: ReactNode; params: Parametros }) {
  const ctx = await contextoBots(params);
  const datos = await datosMarco(obtenerRepositorio(), ctx);
  return <Marco ctx={ctx} datos={datos}>{children}</Marco>;
}
