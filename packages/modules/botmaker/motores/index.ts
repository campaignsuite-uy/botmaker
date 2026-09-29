/**
 * La capa de motores lista para usar en el servidor: los adaptadores de una sola vez y el modo simulado según el
 * entorno (motores/claves.ts → simularMotores). SOLO SERVIDOR: las claves salen de las variables de entorno.
 */
import type { RepositorioCapa } from './capa';
import { CapaMotores } from './capa';
import { simularMotores } from './claves';
import { AdaptadorOpenRouter } from './openrouter';
import { AdaptadorSimulado } from './simulado';

export { CapaMotores, type PedidoCapa, type ResultadoCapa, type IntentoMotor, type LecturaDoble } from './capa';
export { simularMotores, claveOpenRouter, VARIABLE_CLAVE } from './claves';
export { ENTRADA_PRUEBA } from './prueba';
export type { ContextoBot } from './prompts';

const global_ = globalThis as unknown as { __botsAdaptadores?: { openrouter: AdaptadorOpenRouter; simulado: AdaptadorSimulado } };

export function capaMotores(repo: RepositorioCapa): CapaMotores {
  const adaptadores = (global_.__botsAdaptadores ??= { openrouter: new AdaptadorOpenRouter(), simulado: new AdaptadorSimulado() });
  return new CapaMotores({ repo, adaptadores, simular: simularMotores() });
}
