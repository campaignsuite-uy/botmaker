/**
 * La capa de motores lista para usar en el servidor: los adaptadores de una sola vez y el modo simulado según el
 * entorno (motores/claves.ts → simularMotores). SOLO SERVIDOR: las claves salen de las variables de entorno.
 */
import type { RepositorioCapa } from './capa';
import type { MotorFuncion } from '../dominio/tipos';
import { CapaMotores } from './capa';
import { simularMotores } from './claves';
import { AdaptadorOpenRouter } from './openrouter';
import { AdaptadorSimulado } from './simulado';

export { CapaMotores, type PedidoCapa, type ResultadoCapa, type IntentoMotor, type LecturaDoble } from './capa';
export { simularMotores, claveOpenRouter, VARIABLE_CLAVE } from './claves';
export { ENTRADA_PRUEBA } from './prueba';
export type { ContextoBot } from './prompts';

const global_ = globalThis as unknown as { __botsAdaptadores?: { openrouter: AdaptadorOpenRouter; simulado: AdaptadorSimulado } };

/**
 * La capa de motores. Con `motores`, usa esa combinación en lugar de la del bot (para comparar motores en una corrida
 * de prueba); los topes, las fichas y el registro de llamadas siguen siendo los del repositorio.
 */
export function capaMotores(repo: RepositorioCapa, opciones: { motores?: MotorFuncion[] } = {}): CapaMotores {
  const adaptadores = (global_.__botsAdaptadores ??= { openrouter: new AdaptadorOpenRouter(), simulado: new AdaptadorSimulado() });
  const conMotores: RepositorioCapa = opciones.motores
    ? { ...pick(repo), motoresDeBot: async () => opciones.motores!.map((m) => ({ ...m })) }
    : repo;
  return new CapaMotores({ repo: conMotores, adaptadores, simular: simularMotores() });
}

function pick(r: RepositorioCapa): RepositorioCapa {
  return {
    topesBot: (id) => r.topesBot(id), fichas: () => r.fichas(), motoresDeBot: (id) => r.motoresDeBot(id),
    gastoBot: (id, desde, uso) => r.gastoBot(id, desde, uso), registrarLlamada: (l) => r.registrarLlamada(l),
  };
}
