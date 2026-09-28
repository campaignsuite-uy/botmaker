/**
 * Claves de OpenRouter por uso. Cada uso tiene su propia clave, con su propio tope en OpenRouter, separada de las de
 * los otros productos de CampaignSuite. Viven solo en las variables de entorno del servidor: nunca en el código, en la
 * base ni en el navegador.
 *
 *  - BOTS_OPENROUTER_API_KEY_VIVO: el bot conversando con ciudadanos (en_vivo).
 *  - BOTS_OPENROUTER_API_KEY_COPILOTO: lo que dispara el equipo desde el creador (copiloto y simulador).
 *  - BOTS_OPENROUTER_API_KEY_FONDO: tareas de fondo (pruebas, muestreo, agrupar no entendidas).
 *
 * En desarrollo alcanza con una misma clave en las tres.
 */
import type { UsoMotor } from '../dominio/tipos';

export const VARIABLE_CLAVE: Record<UsoMotor, string> = {
  en_vivo: 'BOTS_OPENROUTER_API_KEY_VIVO',
  copiloto: 'BOTS_OPENROUTER_API_KEY_COPILOTO',
  simulador: 'BOTS_OPENROUTER_API_KEY_COPILOTO',
  pruebas: 'BOTS_OPENROUTER_API_KEY_FONDO',
  fondo: 'BOTS_OPENROUTER_API_KEY_FONDO',
};

export function claveOpenRouter(uso: UsoMotor, entorno: Record<string, string | undefined> = process.env): string | null {
  const v = entorno[VARIABLE_CLAVE[uso]]?.trim();
  return v ? v : null;
}

/**
 * ¿Todo va al motor simulado? Con BOTS_SIMULAR=1, siempre; con BOTS_SIMULAR=0, nunca; si no está, en la demo en memoria
 * (CAMPAIGNSUITE_DATOS=demo), para que la demo no gaste ni necesite claves.
 */
export function simularMotores(entorno: Record<string, string | undefined> = process.env): boolean {
  if (entorno.BOTS_SIMULAR === '1') return true;
  if (entorno.BOTS_SIMULAR === '0') return false;
  return (entorno.CAMPAIGNSUITE_DATOS || 'demo') === 'demo';
}
