/**
 * Lo que el canal de WhatsApp necesita del servidor donde corre: qué cliente de 360dialog usar (el real o el simulado),
 * la dirección de la app pública y el entorno del núcleo. SOLO SERVIDOR.
 *
 * BOTS_WHATSAPP_SIMULADO: 1, siempre el simulado; 0, siempre el real; vacío, el simulado en la demo y el real con
 * Supabase. El simulado no sale de la memoria del servidor.
 */
import { modoDatos } from '@campaignsuite/platform/entorno';
import { hashConClave } from '../canal-web/servidor';
import { ID_PUBLICO_DEMO } from '../datos/demo/semilla-canal';
import type { RepositorioPublico } from '../datos/repositorio';
import { capaMotores } from '../motores';
import { cliente360Real, type Cliente360 } from './d360';
import type { EntornoWhatsapp, RepoWhatsapp } from './nucleo';
import { simulador360, type Simulador360 } from './simulado';

export function whatsappSimulado(): boolean {
  const v = process.env.BOTS_WHATSAPP_SIMULADO;
  if (v === '1') return true;
  if (v === '0') return false;
  return modoDatos() === 'demo';
}

/**
 * La dirección de la app pública para los avisos de 360dialog y los enlaces de las condiciones. `base`: dónde están
 * montadas las rutas públicas en este servidor ('' en la app pública, '/publico' en la demo de la app del equipo).
 */
export function urlPublicaWhatsapp(base: string): string {
  return process.env.BOTS_URL_PUBLICA?.replace(/\/$/, '') || base;
}

/** El 360dialog simulado de este servidor, con la cuenta de la demo avisando a la ruta de este servidor. */
export function simuladorDelServidor(base: string): Simulador360 {
  return simulador360(`${base}/api/whatsapp/${ID_PUBLICO_DEMO}`);
}

export function clienteWhatsapp(base: string): Cliente360 {
  return whatsappSimulado() ? simuladorDelServidor(base) : cliente360Real();
}

export function entornoWhatsapp(repo: RepoWhatsapp & RepositorioPublico, base: string): EntornoWhatsapp {
  return { ahora: () => new Date(), hash: hashConClave(), capa: capaMotores(repo), cliente: clienteWhatsapp(base), urlPublica: urlPublicaWhatsapp(base) };
}
