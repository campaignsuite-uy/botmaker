/**
 * Tipos del dominio de BotMaker. Espejo del esquema `bots` de la base (packages/db/migraciones/bots_0001_base.sql):
 * los nombres de las columnas van en inglés en la base y acá en español.
 */

/** Roles de BotMaker en una campaña (core.products.valid_roles). El primero arma el equipo del producto. */
export const ROLES_MODULO = ['administrador', 'editor', 'agente', 'lector'] as const;
export type RolModulo = (typeof ROLES_MODULO)[number];
/** El rol con que la persona entra: el del producto o, en una organización demo, observador. */
export type RolEfectivo = RolModulo | 'observador';

export const PRODUCTO = 'botmaker';

export const CASOS = ['electoral', 'politico'] as const;
export type CasoUso = (typeof CASOS)[number];

export const ESTADOS_BOT = ['borrador', 'publicado', 'pausado', 'archivado'] as const;
export type EstadoBot = (typeof ESTADOS_BOT)[number];

export const TRATOS = ['usted', 'tu'] as const;
export type Trato = (typeof TRATOS)[number];

/** Las tres funciones de la capa de motores. */
export const FUNCIONES = ['interpretar', 'responder', 'copiloto'] as const;
export type FuncionMotor = (typeof FUNCIONES)[number];

/** Para qué se llamó al motor. Cada uso sale con su propia clave de OpenRouter (motores/claves.ts). */
export const USOS = ['en_vivo', 'copiloto', 'fondo', 'simulador', 'pruebas'] as const;
export type UsoMotor = (typeof USOS)[number];

export interface Bot {
  id: string;
  campanaId: string;
  organizacionId: string;
  nombre: string;
  /** Id corto de la dirección pública (landing y widget). No cambia. */
  idPublico: string;
  caso: CasoUso;
  /** País del mercado (ISO de 2 letras): define las condiciones que se avisan. */
  mercado: string;
  estado: EstadoBot;
  versionPublicadaId: string | null;
  trato: Trato;
  /** Texto del aviso de IA del primer mensaje (vacío: el texto por defecto). */
  avisoIa: string;
  personalizacion: boolean;
  /** Días que se guarda el texto de las conversaciones. */
  diasGuardado: number;
  topeDiarioUsd: number;
  topeMensualUsd: number;
  creadoPor: string | null;
  creadoEn: string;
  actualizadoEn: string;
  archivadoEn: string | null;
}

export interface NuevoBot {
  nombre: string;
  caso: CasoUso;
  mercado: string;
  trato: Trato;
}

export interface CambiosBot {
  nombre?: string;
  caso?: CasoUso;
  mercado?: string;
  trato?: Trato;
  avisoIa?: string;
}

/** El motor principal y de respaldo de una función (en un bot o por defecto). */
export interface MotorFuncion {
  funcion: FuncionMotor;
  principal: string;
  respaldo: string | null;
  tiempoMaximoMs: number;
}

export type EleccionMotores = Partial<Record<FuncionMotor, { principal: string; respaldo: string | null }>>;

export interface Topes {
  diarioUsd: number;
  mensualUsd: number;
}

/** Una llamada a un motor, sin textos (bots.engine_calls). */
export interface LlamadaMotor {
  id: number;
  botId: string;
  campanaId: string;
  uso: UsoMotor;
  funcion: FuncionMotor;
  motorId: string;
  modelo: string;
  proveedor: string;
  respaldo: boolean;
  ok: boolean;
  error: string | null;
  demoraMs: number | null;
  tokensEntrada: number | null;
  tokensSalida: number | null;
  tokensCache: number | null;
  tokensRazonamiento: number | null;
  costoUsd: number;
  idGeneracion: string | null;
  personaId: string | null;
  fecha: string;
}

export type NuevaLlamada = Omit<LlamadaMotor, 'id' | 'fecha'> & { fecha?: string };

/** Gasto de un bot en un día (UTC) y un uso (bots.spend_daily). */
export interface GastoDia {
  botId: string;
  dia: string;
  uso: UsoMotor;
  costoUsd: number;
  llamadas: number;
}

/** Lo que BotMaker usa de la campaña de la plataforma (core.campaigns), sin copiarlo. */
export interface CampanaBots {
  id: string;
  organizacionId: string;
  slug: string;
  nombre: string;
  paisIso: string;
  pais: string;
  zonaHoraria: string;
  fechaEleccion: string | null;
}
