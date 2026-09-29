/**
 * Contrato de datos de BotMaker. Dos implementaciones con las mismas reglas:
 *  - memoria (datos/demo/repositorio-demo.ts): la demo y las pruebas, sin ninguna cuenta;
 *  - Supabase (datos/supabase/repositorio-supabase.ts): el esquema `bots`, leído con la sesión de la persona (reglas
 *    por fila) y cambiado por las funciones de la base, que vuelven a exigir cada permiso.
 *
 * Las escrituras reciben quién las hace (`por`): la demo exige con eso la misma matriz que la base; con Supabase lo
 * pone la sesión y `por` solo se usa para comparar.
 */
import type { Definicion } from '../dominio/definicion';
import type { FichaMotor } from '../dominio/motores';
import type { Borrador, Cambio, CambioResumen, EventoPublicacion, NuevoCambio, Version, VersionCompleta } from '../dominio/versiones';
import type { Corrida, ResultadoCaso, ResumenCorrida } from '../dominio/corridas';
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

  /**
   * Crea un bot en borrador con los motores por defecto y, si viene `definicion`, su versión 1 en borrador (la
   * plantilla), todo junto. Con la misma `clave` devuelve el que ya creó.
   */
  crearBot(campanaId: string, datos: NuevoBot, clave: string, por: string, definicion?: Definicion): Promise<string>;
  guardarBot(botId: string, cambios: CambiosBot, por: string): Promise<void>;
  guardarMotores(botId: string, motores: EleccionMotores, topes: Topes | null, por: string): Promise<void>;
  guardarDatosPersonales(botId: string, personalizacion: boolean, diasGuardado: number, por: string): Promise<void>;
  archivarBot(botId: string, por: string): Promise<void>;

  // ── Versiones y borrador (bots.versions y bots.version_changes) ─────────────────────────────

  /** Las versiones del bot, de la más nueva a la más vieja, sin la definición. */
  versiones(botId: string): Promise<Version[]>;
  /** El borrador del bot con su definición (a lo sumo uno), o null. */
  borrador(botId: string): Promise<Borrador | null>;
  /**
   * El borrador del bot: si ya hay uno, devuelve ese. Si no, lo crea con `definicion` o, con null, copiando la versión
   * publicada o la última (sin ninguna, ErrorDatos 'sin_version').
   */
  crearBorrador(botId: string, definicion: Definicion | null, por: string): Promise<string>;
  /**
   * Guarda un cambio del borrador y la definición que quedó, si el borrador sigue en `seqEsperada`; si otra persona lo
   * cambió en el medio, ErrorDatos 'borrador_cambio'. Devuelve el seq nuevo.
   */
  guardarCambio(versionId: string, seqEsperada: number, cambio: NuevoCambio, definicion: Definicion, por: string): Promise<number>;
  /** El historial de una versión, del más viejo al más nuevo, sin operaciones ni inversas. */
  cambios(versionId: string): Promise<CambioResumen[]>;
  /** Un cambio completo, con sus operaciones y su inversa. */
  cambio(versionId: string, seq: number): Promise<Cambio | null>;

  /** Una versión cualquiera del bot con su definición (la publicada, una pedida, una vieja). */
  version(versionId: string): Promise<VersionCompleta | null>;

  // ── Corridas de prueba (bots.test_runs y bots.test_results) ───────────────────────────────────

  /** Empieza una corrida de la versión (en su cambio actual) con una combinación de motores. */
  crearCorrida(versionId: string, motores: Record<string, unknown>, etiqueta: string, total: number, por: string): Promise<string>;
  /** Agrega resultados a una corrida en curso (los repetidos se ignoran). Devuelve cuántos casos lleva. */
  guardarResultados(corridaId: string, resultados: ResultadoCaso[], por: string): Promise<number>;
  cerrarCorrida(corridaId: string, resumen: ResumenCorrida | null, estado: 'terminada' | 'cancelada', por: string): Promise<void>;
  /** Las corridas del bot, de la más nueva a la más vieja, sin los resultados. */
  corridas(botId: string): Promise<Corrida[]>;
  corrida(corridaId: string): Promise<(Corrida & { resultados: ResultadoCaso[] }) | null>;

  // ── Publicación ───────────────────────────────────────────────────────────────────────────────

  /**
   * El editor pide publicar el borrador como lo vio. Necesita una corrida terminada sobre su último cambio y no bajar
   * BAJA_MAXIMA_ACIERTO puntos o más de acierto contra la publicada (ErrorDatos 'sin_corrida' o 'baja_acierto').
   */
  pedirPublicacion(versionId: string, seqEsperada: number, nota: string, por: string): Promise<void>;
  aprobarPublicacion(versionId: string, nota: string, por: string): Promise<void>;
  devolverPublicacion(versionId: string, nota: string, por: string): Promise<void>;
  eventosPublicacion(botId: string): Promise<EventoPublicacion[]>;

  /** El rol de un integrante de la campaña en BotMaker (null = sin acceso). */
  asignarRol(campanaId: string, personaId: string, rol: RolModulo | null, por: string): Promise<void>;

  /** Los topes de gasto de un bot, sin la sesión de la persona (la capa de motores los necesita también en vivo). */
  topesBot(botId: string): Promise<Topes | null>;

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
