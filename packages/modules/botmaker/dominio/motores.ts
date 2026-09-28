import type { FuncionMotor, MotorFuncion } from './tipos';

/**
 * La ficha de cada motor de IA y el motor por defecto de cada función. Espejo de bots.engines y bots.engine_defaults
 * (packages/db/migraciones/bots_0001_base.sql): `pnpm db:probar` controla que coincidan. Un motor nuevo, o un cambio en
 * las condiciones de uno, entra por una migración nueva y acá.
 *
 * Las condiciones salen de la evaluación de motores del 27/9/2026. El creador las usa para avisar, nunca para bloquear.
 */

export type Permiso = 'si' | 'con_condiciones' | 'no';

export interface FichaMotor {
  id: string;
  nombre: string;
  empresa: string;
  /** Cómo se llega al modelo: OpenRouter o el motor simulado (sin costo, sin red). */
  ruta: 'openrouter' | 'simulado';
  /** Id del modelo en la ruta (OpenRouter: "anthropic/claude-haiku-4.5"). */
  modelo: string;
  /** Preferencias de proveedor de OpenRouter (only, order, allow_fallbacks…). */
  proveedor: Record<string, unknown>;
  /** Razonamiento de OpenRouter ({ effort }); null si no se manda. */
  razonamiento: { effort: string } | null;
  /** El modelo no acepta `temperature` (Claude Sonnet 5, Gemini con razonamiento). */
  sinTemperatura: boolean;
  /** Marcar el material para la caché del proveedor (Anthropic). */
  cache: boolean;
  /** USD por millón de tokens. */
  precioEntrada: number;
  precioSalida: number;
  precioCache: number | null;
  /** El proveedor garantiza el esquema JSON estricto. */
  jsonEstricto: boolean;
  permiteElectoral: Permiso;
  permitePolitico: Permiso;
  exigeAvisoIa: boolean;
  permitePersonalizacion: boolean;
  entrena: boolean;
  retencion: string;
  region: string;
  condiciones: string;
  /** Funciones para las que es candidato. */
  funciones: FuncionMotor[];
  activo: boolean;
}

const OPENAI_GROQ = 'Licencia Apache 2.0 y política de Groq, sin cláusula electoral. La prohibición de campañas de OpenAI es de sus servicios; no se encontró que alcance a gpt-oss.';
const MISTRAL = 'Sin cláusula de campañas; prohíbe la desinformación que afecte procesos cívicos o políticos.';
const ANTHROPIC = 'Permite bots de campaña si avisan que son IA al empezar cada conversación y no segmentan por el perfil de cada persona.';

export const FICHAS_MOTORES: readonly FichaMotor[] = [
  {
    id: 'simulado', nombre: 'Motor simulado', empresa: 'BotMaker', ruta: 'simulado', modelo: 'simulado', proveedor: {}, razonamiento: null,
    sinTemperatura: false, cache: false, precioEntrada: 0, precioSalida: 0, precioCache: null, jsonEstricto: true,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: false,
    retencion: 'No sale de la app', region: 'Local', condiciones: 'Responde por reglas, sin costo. Para la demo, las pruebas y el simulador en desarrollo.',
    funciones: ['interpretar', 'responder', 'copiloto'], activo: true,
  },
  {
    id: 'gpt-oss-20b', nombre: 'gpt-oss-20b (Groq)', empresa: 'OpenAI (pesos abiertos) en Groq', ruta: 'openrouter', modelo: 'openai/gpt-oss-20b',
    proveedor: { only: ['groq'], allow_fallbacks: false }, razonamiento: { effort: 'low' }, sinTemperatura: false, cache: false,
    precioEntrada: 0.075, precioSalida: 0.3, precioCache: null, jsonEstricto: true,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: false,
    retencion: 'Groq no guarda por defecto (hasta 30 días para detectar abuso)', region: 'EE.UU.', condiciones: OPENAI_GROQ,
    funciones: ['interpretar'], activo: true,
  },
  {
    id: 'gpt-oss-120b', nombre: 'gpt-oss-120b (Groq)', empresa: 'OpenAI (pesos abiertos) en Groq', ruta: 'openrouter', modelo: 'openai/gpt-oss-120b',
    proveedor: { only: ['groq'], allow_fallbacks: false }, razonamiento: { effort: 'low' }, sinTemperatura: false, cache: false,
    precioEntrada: 0.15, precioSalida: 0.6, precioCache: null, jsonEstricto: true,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: false,
    retencion: 'Groq no guarda por defecto (hasta 30 días para detectar abuso)', region: 'EE.UU.', condiciones: OPENAI_GROQ,
    funciones: ['interpretar', 'responder', 'copiloto'], activo: true,
  },
  {
    id: 'mistral-small-4', nombre: 'Mistral Small 4', empresa: 'Mistral', ruta: 'openrouter', modelo: 'mistralai/mistral-small-2603',
    proveedor: {}, razonamiento: null, sinTemperatura: false, cache: false,
    precioEntrada: 0.15, precioSalida: 0.6, precioCache: 0.015, jsonEstricto: true,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: true,
    retencion: 'Entrena por defecto: se apaga en el panel de Mistral', region: 'UE', condiciones: MISTRAL,
    funciones: ['interpretar', 'responder'], activo: true,
  },
  {
    id: 'ministral-8b', nombre: 'Ministral 3 8B', empresa: 'Mistral', ruta: 'openrouter', modelo: 'mistralai/ministral-8b-2512',
    proveedor: {}, razonamiento: null, sinTemperatura: false, cache: false,
    precioEntrada: 0.15, precioSalida: 0.15, precioCache: 0.015, jsonEstricto: false,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: true,
    retencion: 'Entrena por defecto: se apaga en el panel de Mistral', region: 'UE', condiciones: MISTRAL,
    funciones: ['interpretar'], activo: true,
  },
  {
    id: 'claude-haiku-4.5', nombre: 'Claude Haiku 4.5', empresa: 'Anthropic', ruta: 'openrouter', modelo: 'anthropic/claude-haiku-4.5',
    proveedor: { only: ['anthropic'] }, razonamiento: null, sinTemperatura: false, cache: true,
    precioEntrada: 1, precioSalida: 5, precioCache: 0.1, jsonEstricto: true,
    permiteElectoral: 'con_condiciones', permitePolitico: 'con_condiciones', exigeAvisoIa: true, permitePersonalizacion: false, entrena: false,
    retencion: 'No entrena; borra a los 30 días', region: 'EE.UU.', condiciones: ANTHROPIC,
    funciones: ['interpretar', 'responder'], activo: true,
  },
  {
    id: 'claude-sonnet-5', nombre: 'Claude Sonnet 5', empresa: 'Anthropic', ruta: 'openrouter', modelo: 'anthropic/claude-sonnet-5',
    proveedor: { only: ['anthropic'] }, razonamiento: null, sinTemperatura: true, cache: true,
    precioEntrada: 2, precioSalida: 10, precioCache: 0.2, jsonEstricto: true,
    permiteElectoral: 'con_condiciones', permitePolitico: 'con_condiciones', exigeAvisoIa: true, permitePersonalizacion: false, entrena: false,
    retencion: 'No entrena; borra a los 30 días', region: 'EE.UU.', condiciones: ANTHROPIC,
    funciones: ['interpretar', 'responder', 'copiloto'], activo: true,
  },
  {
    id: 'gemini-3.1-flash-lite', nombre: 'Gemini 3.1 Flash-Lite', empresa: 'Google', ruta: 'openrouter', modelo: 'google/gemini-3.1-flash-lite',
    proveedor: { order: ['google-ai-studio', 'google-vertex/global'], allow_fallbacks: false }, razonamiento: { effort: 'minimal' },
    sinTemperatura: true, cache: false, precioEntrada: 0.25, precioSalida: 1.5, precioCache: 0.025, jsonEstricto: true,
    permiteElectoral: 'si', permitePolitico: 'si', exigeAvisoIa: false, permitePersonalizacion: true, entrena: false,
    retencion: 'Plan pago: no entrena; guarda 55 días', region: 'Global',
    condiciones: 'Sin cláusula electoral. Sus condiciones no admiten servicios a los que probablemente entren menores de 18 años: a aclarar antes de elegirlo.',
    funciones: ['interpretar', 'responder'], activo: true,
  },
];

/** Provisorios hasta cerrar la prueba de motores (plan técnico, etapa 1). Espejo de bots.engine_defaults. */
export const MOTORES_POR_DEFECTO: readonly MotorFuncion[] = [
  { funcion: 'interpretar', principal: 'gpt-oss-120b', respaldo: 'claude-haiku-4.5', tiempoMaximoMs: 2500 },
  { funcion: 'responder', principal: 'gpt-oss-120b', respaldo: 'claude-haiku-4.5', tiempoMaximoMs: 4000 },
  { funcion: 'copiloto', principal: 'claude-sonnet-5', respaldo: 'gpt-oss-120b', tiempoMaximoMs: 60000 },
];

export const ETIQUETA_FUNCION: Record<FuncionMotor, string> = {
  interpretar: 'Interpretar',
  responder: 'Responder con base',
  copiloto: 'Copiloto',
};

export const ETIQUETA_PERMISO: Record<Permiso, string> = {
  si: 'Sí',
  con_condiciones: 'Con condiciones',
  no: 'No',
};

export function fichaMotor(id: string, fichas: readonly FichaMotor[] = FICHAS_MOTORES): FichaMotor | undefined {
  return fichas.find((f) => f.id === id);
}

/** Los motores activos que son candidatos para una función (el simulado siempre, para probar sin costo). */
export function motoresPara(funcion: FuncionMotor, fichas: readonly FichaMotor[] = FICHAS_MOTORES): FichaMotor[] {
  return fichas.filter((f) => f.activo && f.funciones.includes(funcion));
}

/** Costo de una llamada en USD según la ficha, para estimar cuando el proveedor no lo informa. */
export function costoEstimado(f: FichaMotor, tokens: { entrada: number; salida: number; cache?: number }): number {
  const cache = tokens.cache ?? 0;
  const sinCache = Math.max(0, tokens.entrada - cache);
  return (sinCache * f.precioEntrada + cache * (f.precioCache ?? f.precioEntrada) + tokens.salida * f.precioSalida) / 1e6;
}
