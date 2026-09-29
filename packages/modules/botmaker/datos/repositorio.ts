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
import type { EntranteWhatsapp, EstadoCanal, EstadoEnvio, MensajeWhatsapp, Plantilla } from '../dominio/whatsapp';
import type { ConsultaContacto, TipoConsulta } from '../dominio/contactos';
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

  // ── WhatsApp (etapa 7) ────────────────────────────────────────────────────────────────────────

  /** El canal de WhatsApp del bot con su salud, o null si nunca se conectó (ver). */
  canalWhatsapp(botId: string): Promise<CanalWhatsapp | null>;
  /**
   * Conecta (o reconecta) el número: la clave de 360dialog va a Vault y la base guarda solo la referencia; del secreto
   * del webhook, solo su hash (configurar_canales). Queda prendido y cierra la alerta de canal desconectado.
   */
  conectarWhatsapp(botId: string, d: ConexionWhatsapp, por: string): Promise<string>;
  /** Prender o apagar el canal sin tocar la clave (configurar_canales). */
  prenderWhatsapp(botId: string, activo: boolean, por: string): Promise<void>;
  /** Escribir con una plantilla aprobada (la única forma con la ventana de 24 horas cerrada). Devuelve el número del mensaje. */
  responderConPlantilla(conversacionId: string, p: PlantillaEnviada, por: string): Promise<number>;
  /** Las plantillas de la cuenta del canal de WhatsApp del bot (ver). */
  plantillas(botId: string): Promise<PlantillaGuardada[]>;
  /** Anota una plantilla que se acaba de crear en 360dialog (configurar_canales). */
  guardarPlantillaCreada(botId: string, p: Plantilla, por: string): Promise<void>;
  /** Saca una plantilla que se borró en 360dialog (configurar_canales). */
  quitarPlantilla(botId: string, nombre: string, por: string): Promise<void>;

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

  // ── Base de contactos (7.06) ──────────────────────────────────────────────────────────────────

  /**
   * La base de contactos de la campaña, de a una página, los más recientes primero (leer_conversaciones). Sin los
   * borrados a pedido. El número viene solo para quien atiende (responder_conversaciones), y solo quien atiende busca
   * por número.
   */
  baseContactos(campanaId: string, filtro: FiltroContactos, por: string): Promise<PaginaContactos>;
  /** Un contacto con sus conversaciones y todo lo que consultó (leer_conversaciones). null si no existe o no se ve. */
  fichaContacto(contactoId: string, por: string): Promise<FichaContacto | null>;
  /** Toda la base que cumple el filtro, para descargarla; queda registrado quién, cuándo y cuántos (gestionar_datos_contactos). */
  exportarBaseContactos(campanaId: string, filtro: Omit<FiltroContactos, 'limite' | 'desde'>, por: string): Promise<FilaBaseContacto[]>;
  /** Las descargas de la base, la más nueva primero (gestionar_datos_contactos). */
  exportacionesBase(campanaId: string, por: string): Promise<ExportacionBase[]>;

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
  contacto: Pick<Contacto, 'id' | 'nombre' | 'borradoEn' | 'nombrePerfil'>;
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
  /** envios: lo mismo en mensajes de WhatsApp, si la conversación es por WhatsApp. */
  mensajes: { texto: string; cajaId: string | null; datos: Mensaje['datos']; envios?: MensajeWhatsapp[] }[];
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

export interface FiltroContactos {
  botId?: string;
  canal?: Canal;
  /** Nombre, nombre de perfil, dato que dio o (quien atiende) número. */
  buscar?: string;
  /** Solo los que consultaron esto. */
  consulta?: { tipo: TipoConsulta; clave: string };
  /** Tamaño de la página (hasta 200) y desde qué fila. */
  limite?: number;
  desde?: number;
}

export interface FilaBaseContacto {
  contacto: Contacto;
  conversaciones: number;
  /** Cuándo empezó la primera y cuándo se movió la última (ISO, UTC). */
  primera: string | null;
  ultima: string | null;
  consultas: ConsultaContacto[];
}

export interface PaginaContactos {
  total: number;
  filas: FilaBaseContacto[];
}

export interface FichaContacto extends FilaBaseContacto {
  lista: { id: string; estado: EstadoConversacion; canal: Canal; iniciadaEn: string; actualizadaEn: string; mensajes: number; asignadaA: string | null }[];
}

/** Una descarga de la base: el filtro sin el texto buscado (puede ser un nombre) y cuántos contactos salieron. */
export interface ExportacionBase {
  id: string;
  campanaId: string;
  botId: string | null;
  canal: Canal | null;
  /** "tema:agua"… (claveConsulta). */
  consulta: string | null;
  conBusqueda: boolean;
  cantidad: number;
  hechoPor: string | null;
  hechoEn: string;
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
  /** envios: el mismo mensaje en el formato de WhatsApp (solo en WhatsApp): se encolan para mandarse. */
  salientes: { autor: 'bot' | 'sistema'; texto: string; cajaId: string | null; datos: Mensaje['datos']; envios?: MensajeWhatsapp[] }[];
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
  /** WhatsApp: la ventana de 24 horas que abre el mensaje de la persona. */
  ventanaHasta?: string | null;
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

// ── WhatsApp (etapa 7) ──────────────────────────────────────────────────────────────────────────

export interface ConexionWhatsapp {
  /** La clave de 360dialog: va directo a Vault, nunca vuelve al navegador ni queda en una tabla. */
  clave: string;
  /** El número como lo ve la gente (solo para mostrar). */
  numero: string | null;
  /** SHA-256 del secreto que 360dialog manda en cada aviso (el secreto no se guarda). */
  secretoHash: string;
  webhookUrl: string;
}

export interface PlantillaEnviada {
  nombre: string;
  idioma: string;
  formato: 'posicional' | 'nombre';
  variables: string[];
  valores: Record<string, string>;
  /** El texto completo, para la conversación. */
  texto: string;
}

/** Una plantilla de la cuenta, como la guarda BotMaker (espejo de 360dialog más quién la creó). */
export interface PlantillaGuardada extends Plantilla {
  canalId: string;
  creadaPor: string | null;
  creadaEn: string;
  /** Última vez que se leyó su estado en 360dialog. */
  revisadaEn: string | null;
}

export interface SaludCanal {
  /** Los últimos días que se suman (UTC, hoy incluido). */
  dias: number;
  recibidos: number;
  repetidos: number;
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  /** Cuánto tardó el aviso de 360dialog en recibir respuesta (lo que exige que sea menos de 5 s; la meta, 0,5 s). */
  demoraMaxMs: number;
  demoraMediaMs: number | null;
  /** Mensajes esperando para salir. */
  pendientes: number;
}

export interface CanalWhatsapp {
  id: string;
  botId: string;
  estado: EstadoCanal;
  numero: string | null;
  webhookUrl: string | null;
  conectadoEn: string | null;
  ultimoRecibido: string | null;
  ultimoError: string | null;
  ultimoErrorEn: string | null;
  salud: SaludCanal;
  /** Mensajes que salieron este mes (UTC): lo que Meta cobra pasadas las 1.000 gratis. */
  respuestasMes: number;
}

/** Lo que necesita el aviso (webhook) de un canal: se busca por el id público del bot. */
export interface CanalWhatsappPublico {
  id: string;
  botId: string;
  idPublico: string;
  estado: EstadoCanal;
  secretoHash: string | null;
}

/** Un aviso de 360dialog ya leído: un mensaje de la persona o un estado de un mensaje que salió. */
export type EntradaWebhook =
  | { clave: string; tipo: 'mensaje'; hora: string; mensaje: EntranteWhatsapp }
  | { clave: string; tipo: 'estado'; hora: string; idProveedor: string; estado: EstadoEnvio; error: string | null };

export interface EnvioPendiente {
  id: string;
  canalId: string;
  conversacionId: string;
  n: number;
  parte: number;
  /** El número de la persona (solo dígitos). null si se borraron sus datos. */
  direccion: string | null;
  mensaje: MensajeWhatsapp;
  intentos: number;
}

export type ResultadoEnvio =
  | { tipo: 'enviado'; idProveedor: string }
  | { tipo: 'reintentar'; error: string; en: string }
  | { tipo: 'fallido'; error: string };

/**
 * WhatsApp sin sesión de persona (el aviso de 360dialog, el envío y las tareas). En Supabase, la clave de servicio y
 * solo funciones bots.publico_* y bots.servicio_*.
 */
export interface RepositorioWhatsapp {
  canalWhatsappPublico(idPublico: string): Promise<CanalWhatsappPublico | null>;
  canalWhatsappPorId(canalId: string): Promise<CanalWhatsappPublico | null>;
  /**
   * Guarda lo que avisó 360dialog para procesarlo aparte: lo repetido (un reintento) se descarta. Suma a la salud del
   * canal los recibidos, los repetidos y la demora del aviso.
   */
  recibirEntradas(canalId: string, entradas: readonly EntradaWebhook[], p: { ahora: Date; demoraMs: number; numero: string | null }): Promise<{ nuevas: number; repetidas: number }>;
  /**
   * Toma lo recibido y todavía no procesado, en orden de llegada (lo marca como tomado: si el proceso se corta, se
   * vuelve a tomar a los 2 minutos; después de 5 intentos se deja).
   */
  entradasPendientes(canalId: string, limite: number, ahora: Date): Promise<EntradaWebhook[]>;
  /** Procesada: se borra lo que tenía de la persona y queda la clave para descartar reintentos. */
  entradaProcesada(canalId: string, clave: string): Promise<void>;
  /** El número de la persona y su nombre de perfil de WhatsApp (se guardan para atenderla y en la base de contactos). */
  guardarTelefono(contactoId: string, telefono: string, nombrePerfil: string | null): Promise<void>;
  /** Toma los envíos pendientes (los marca como en curso) para mandarlos. */
  tomarEnvios(f: { canalId?: string; conversacionId?: string }, ahora: Date, limite: number): Promise<EnvioPendiente[]>;
  resultadoEnvio(envioId: string, r: ResultadoEnvio, ahora: Date): Promise<void>;
  /** Un estado que avisó Meta (enviado, entregado, leído, fallido) de un mensaje que salió. */
  aplicarEstado(canalId: string, idProveedor: string, estado: EstadoEnvio, error: string | null, ahora: Date): Promise<void>;
  /** La clave de 360dialog del canal, leída de Vault. SOLO SERVIDOR. */
  claveWhatsapp(canalId: string): Promise<string | null>;
  /** La clave dejó de valer: el canal queda desconectado y se abre la alerta. */
  canalDesconectado(canalId: string, error: string, ahora: Date): Promise<void>;
  /** Los canales con algo pendiente (entradas sin procesar o envíos para reintentar), para la tarea de fondo. */
  canalesConPendientes(ahora: Date): Promise<string[]>;
  /** Los canales conectados cuyas plantillas conviene volver a leer (alguna en revisión, o hace rato que no se leen). */
  canalesParaRevisarPlantillas(ahora: Date): Promise<string[]>;
  /** Reemplaza el espejo de las plantillas del canal con lo que devolvió 360dialog (conserva quién creó cada una). */
  sincronizarPlantillas(canalId: string, plantillas: readonly Plantilla[], ahora: Date): Promise<void>;
}

/** Tareas de fondo (sin persona): las llama un cron con clave o pg_cron. */
export interface RepositorioTareas {
  /** Abre las alertas que correspondan y cierra las que ya no. */
  revisarAlertas(ahora: Date): Promise<{ abiertas: number; cerradas: number }>;
  /** Vacía el texto de los mensajes vencidos según los días de guardado de cada bot. Devuelve cuántos. */
  borrarVencidos(ahora: Date): Promise<number>;
}
