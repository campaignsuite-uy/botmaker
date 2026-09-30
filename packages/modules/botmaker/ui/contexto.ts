import type { DatosNucleo } from '@campaignsuite/platform';
import type { CampanaBots, RolEfectivo } from '../dominio/tipos';

/**
 * Lo que cada pantalla recibe de la app (apps/web/lib/modulo.ts): quién es la persona, en qué campaña y con qué rol en
 * BotMaker. La app resuelve la sesión y los permisos de la plataforma; la vista arma los datos y la pantalla solo
 * dibuja. `parametros` son los de la dirección (?ok=…&error=…).
 */
export interface ContextoPantalla {
  persona: { id: string; nombre: string; iniciales: string };
  /** `demo`: organización demo de la base: todos son observadores. */
  organizacion: { slug: string; nombre: string; demo?: boolean };
  campana: CampanaBots;
  rol: RolEfectivo;
  /** Ruta base del producto en esta campaña: /pruebas/pa-pruebas/bots. */
  base: string;
  /** El inicio de la campaña y su configuración (solo si la persona la administra). */
  plataforma: { inicio: string; configuracion: string | null };
  /** El núcleo que ve la persona: el equipo de la campaña, para Equipo y roles. */
  nucleo?: DatosNucleo;
  parametros: Record<string, string | undefined>;
}

/** Un href dentro de BotMaker. */
export function ruta(ctx: Pick<ContextoPantalla, 'base'>, seccion = '', extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return `${ctx.base}${seccion ? `/${seccion}` : ''}${s ? `?${s}` : ''}`;
}
