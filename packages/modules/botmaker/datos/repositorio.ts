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
import type { Alerta, Canal, Condiciones, Contacto, Conversacion, EstadoConversacion, EventoAnalitica, Mensaje, ModoCondiciones, PedidoDatos } from '../dominio/conversaciones';
import type { Decision, Sesion } from '../dominio/motor';
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

  /** Pausar o reanudar el bot (publicar): en pausa no contesta en ningún canal y todo va a la bandeja. */
  pausarBot(botId: string, pausar: boolean, por: string): Promise<void>;

  // ── Canal web y condiciones (etapa 5) ─────────────────────────────────────────────────────────

  canalWeb(botId: string): Promise<CanalWeb>;
  /** Prender o apagar el canal web y cómo se aceptan las condiciones (configurar_canales). */
  guardarCanalWeb(botId: string, canal: CanalWeb, por: string): Promise<void>;
  /** Las condiciones del bot, de la versión más nueva a la más vieja. */
  condiciones(botId: string): Promise<Condiciones[]>;
  /** Publica una versión nueva de las condiciones (configurar_canales). Devuelve su número. */
  publicarCondiciones(botId: string, texto: string, por: string): Promise<number>;

  // ── Bandeja (etapa 6) ─────────────────────────────────────────────────────────────────────────

  conversaciones(campanaId: string, filtro?: FiltroConversaciones): Promise<FilaConversacion[]>;
  conversacion(conversacionId: string): Promise<ConversacionCompleta | null>;
  /** Una persona del equipo toma la conversación: el bot deja de contestar en ella (responder_conversaciones). */
  tomarConversacion(conversacionId: string, por: string): Promise<void>;
  /** Responder como la campaña. Devuelve el número del mensaje. */
  responderConversacion(conversacionId: string, texto: string, por: string): Promise<number>;
  /** Devolver al bot: guarda lo que dijo el bot al volver (el turno de devolverAlBot) y la deja atendida por el bot. */
  devolverConversacion(conversacionId: string, turno: TurnoDevuelto, por: string): Promise<void>;
  cerrarConversacion(conversacionId: string, por: string): Promise<void>;
  alertas(campanaId: string, opciones?: { abiertas?: boolean }): Promise<Alerta[]>;
  /** Las respuestas con base que entraron en la muestra, con su revisión si la tienen. */
  muestra(campanaId: string, opciones?: { pendientes?: boolean; limite?: number }): Promise<FilaMuestra[]>;
  revisarRespuesta(conversacionId: string, n: number, veredicto: 'correcta' | 'incorrecta', convertida: boolean, por: string): Promise<void>;
  /** Buscar contactos por nombre, dato o texto de sus mensajes (gestionar_datos_contactos). */
  buscarContactos(campanaId: string, texto: string, por: string): Promise<FilaContacto[]>;
  exportarContacto(contactoId: string, por: string): Promise<ExportacionContacto>;
  /** Borra los datos del contacto y el texto de sus mensajes; quedan los eventos, que no tienen textos. */
  borrarContacto(contactoId: string, nota: string, por: string): Promise<void>;
  pedidosDatos(campanaId: string): Promise<PedidoDatos[]>;

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

export interface CanalWeb {
  activo: boolean;
  modoCondiciones: ModoCondiciones;
}

export interface FiltroConversaciones {
  botId?: string;
  estado?: EstadoConversacion | 'abiertas';
  canal?: Canal;
  /** Nombre o dato del contacto. */
  buscar?: string;
  /** Solo las asignadas a esta persona. */
  asignadaA?: string;
  limite?: number;
}

export interface FilaConversacion {
  conversacion: Conversacion;
  contacto: Pick<Contacto, 'id' | 'nombre' | 'borradoEn'>;
  /** El último mensaje (su texto, o null si se borró). */
  ultimo: Pick<Mensaje, 'autor' | 'texto' | 'creadoEn'> | null;
  mensajes: number;
}

export interface ConversacionCompleta {
  conversacion: Conversacion;
  contacto: Contacto;
  mensajes: Mensaje[];
}

export interface TurnoDevuelto {
  mensajes: { texto: string; cajaId: string | null; datos: Mensaje['datos'] }[];
  sesion: Sesion;
  decision: Decision;
  cajaActual: string | null;
  eventos: EventoAnalitica[];
}

export interface FilaMuestra {
  conversacionId: string;
  botId: string;
  n: number;
  pregunta: string | null;
  respuesta: string | null;
  secciones: string[];
  fecha: string;
  veredicto: 'correcta' | 'incorrecta' | null;
  convertida: boolean;
  revisadaPor: string | null;
}

export interface FilaContacto {
  contacto: Contacto;
  conversaciones: number;
  ultima: string | null;
}

export interface ExportacionContacto {
  contacto: Contacto;
  conversaciones: { conversacion: Omit<Conversacion, 'sesion'>; mensajes: Mensaje[] }[];
  exportadoEn: string;
}

// ── App pública (etapa 5): sin sesión de persona; en Supabase, solo funciones bots.publico_* ─────

export interface BotPublico {
  bot: Bot;
  campana: { nombre: string; zonaHoraria: string };
  /** La versión publicada con su definición (null si el bot no tiene). */
  version: { id: string; numero: number; definicion: unknown } | null;
  publicadoDesde: string | null;
  organizacionDemo: boolean;
  canal: CanalWeb;
  condiciones: { numero: number; texto: string } | null;
}

export interface TurnoGuardado {
  /** Lo que mandó la persona (null en el inicio de la conversación). */
  entrante: { tipo: Mensaje['tipo']; texto: string; datos: Mensaje['datos']; idCanal: string | null } | null;
  salientes: { autor: 'bot' | 'sistema'; texto: string; cajaId: string | null; datos: Mensaje['datos'] }[];
  decision: Decision | null;
  sesion: Sesion;
  estado: EstadoConversacion;
  cajaActual: string | null;
  versionId: string | null;
  eventos: EventoAnalitica[];
  derivacion: { motivo: string; cajaId: string | null } | null;
  /** Las variables del contacto que se guardaron en este turno (contacto.nombre…). */
  datosContacto: Record<string, string>;
  /** El primer mensaje del bot es una respuesta con base que entra en la revisión por muestreo. */
  muestra: boolean;
  ahora: string;
}

/** La app pública también llama a los motores (en vivo): necesita lo mismo que la capa, sin sesión de persona. */
export type RepositorioCapaPublica = Pick<Repositorio, 'topesBot' | 'fichas' | 'motoresDeBot' | 'gastoBot' | 'registrarLlamada'>;

export interface RepositorioPublico extends RepositorioCapaPublica {
  botPublico(idPublico: string): Promise<BotPublico | null>;
  /** La conversación abierta (no cerrada) más nueva del contacto con el bot, sin crear nada. */
  buscarConversacion(botId: string, contactoHash: string): Promise<{ conversacion: Conversacion; contacto: Contacto } | null>;
  /** Suma uno a cada conteo (ventanas fijas) y devuelve cómo quedó cada uno. */
  contar(claves: readonly { clave: string; ventanaSegundos: number }[], ahora: Date): Promise<number[]>;
  /**
   * La conversación abierta del contacto con el bot, o una nueva (y el contacto, si es la primera vez). La que atendía
   * el bot y lleva más de LIMITES_WEB.minutosSesion sin mensajes se cierra y empieza otra; una derivada o en atención sigue.
   * Con `verificadoAhora`, el contacto pasó la verificación anti-robots recién; la conversación queda verificada si el
   * contacto se verificó en las últimas LIMITES_WEB.horasVerificacion horas.
   */
  abrirConversacion(p: { botId: string; contactoHash: string; canal: Canal; verificadoAhora: boolean; ahora: Date }): Promise<{ conversacion: Conversacion; contacto: Contacto; nueva: boolean }>;
  mensajes(conversacionId: string, desde: number): Promise<Mensaje[]>;
  mensajePorIdCanal(conversacionId: string, idCanal: string): Promise<Mensaje | null>;
  /** Guarda un turno si la conversación sigue en `seqEsperada` (si no, ErrorDatos 'conversacion_cambio'). Devuelve los mensajes nuevos. */
  guardarTurno(conversacionId: string, seqEsperada: number, t: TurnoGuardado): Promise<Mensaje[]>;
  aceptarCondiciones(contactoId: string, numero: number, ahora: Date): Promise<void>;
}

/** Tareas de fondo (sin persona): las llama un cron con clave o pg_cron. */
export interface RepositorioTareas {
  /** Abre las alertas que correspondan y cierra las que ya no. */
  revisarAlertas(ahora: Date): Promise<{ abiertas: number; cerradas: number }>;
  /** Vacía el texto de los mensajes vencidos según los días de guardado de cada bot. Devuelve cuántos. */
  borrarVencidos(ahora: Date): Promise<number>;
}
