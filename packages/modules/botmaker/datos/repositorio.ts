/**
 * Contrato de datos de BotMaker. Dos implementaciones con las mismas reglas:
 *  - memoria (datos/demo/repositorio-demo.ts): la demo y las pruebas, sin ninguna cuenta;
 *  - Supabase (datos/supabase/repositorio-supabase.ts): el esquema `bots`, leído con la sesión de la persona (reglas
 *    por fila) y cambiado por las funciones de la base, que vuelven a exigir cada permiso.
 *
 * Las escrituras reciben quién las hace (`por`): la demo exige con eso la misma matriz que la base; con Supabase lo
 * pone la sesión y `por` solo se usa para comparar.
 */
import type { FichaMotor } from '../dominio/motores';
import type {
  Bot, CambiosBot, CampanaBots, EleccionMotores, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolModulo, Topes, UsoMotor,
} from '../dominio/tipos';

export interface FiltroLlamadas {
  botId?: string;
  desde?: string;
  limite?: number;
}

export interface Repositorio {
  /** ¿BotMaker está preparado en la campaña (bots.campaign_settings)? */
  campanaPreparada(campanaId: string): Promise<boolean>;
  bots(campanaId: string, opciones?: { archivados?: boolean }): Promise<Bot[]>;
  bot(botId: string): Promise<Bot | null>;

  /** Crea un bot en borrador con los motores por defecto. Con la misma `clave` devuelve el que ya creó. */
  crearBot(campanaId: string, datos: NuevoBot, clave: string, por: string): Promise<string>;
  guardarBot(botId: string, cambios: CambiosBot, por: string): Promise<void>;
  guardarMotores(botId: string, motores: EleccionMotores, topes: Topes | null, por: string): Promise<void>;
  guardarDatosPersonales(botId: string, personalizacion: boolean, diasGuardado: number, por: string): Promise<void>;
  archivarBot(botId: string, por: string): Promise<void>;

  /** El rol de un integrante de la campaña en BotMaker (null = sin acceso). */
  asignarRol(campanaId: string, personaId: string, rol: RolModulo | null, por: string): Promise<void>;

  fichas(): Promise<FichaMotor[]>;
  motoresPorDefecto(): Promise<MotorFuncion[]>;
  motoresDeBot(botId: string): Promise<MotorFuncion[]>;

  /** Registra una llamada a un motor (la escribe el servidor: la persona no puede). */
  registrarLlamada(l: NuevaLlamada): Promise<void>;
  /** Gasto de un bot desde un día (UTC, incluido), de un uso o de todos. Lo usa la capa para los topes. */
  gastoBot(botId: string, desdeDia: string, uso?: UsoMotor): Promise<number>;
  gastoPorDia(campanaId: string, desdeDia: string): Promise<GastoDia[]>;
  llamadas(campanaId: string, filtro?: FiltroLlamadas): Promise<LlamadaMotor[]>;
}

export type { CampanaBots };
