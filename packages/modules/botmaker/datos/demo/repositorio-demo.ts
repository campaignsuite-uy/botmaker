/**
 * Repositorio en memoria (CAMPAIGNSUITE_DATOS=demo): la demo y las pruebas, sin ninguna cuenta. Vive mientras el
 * servidor está prendido.
 *
 * Aplica las mismas reglas que la base: cada escritura vuelve a exigir la acción de la matriz con el rol que da la
 * plataforma (el núcleo en memoria de @campaignsuite/platform), como hacen las funciones bots.* en Supabase. Así una
 * prueba contra la demo prueba también la tercera capa de permisos.
 */
import { nucleoMemoria, operacionesCampanaMemoria } from '@campaignsuite/platform/memoria';
import { rolEnCampana } from '@campaignsuite/platform';
import { esquemaCambiosBot, esquemaDatosPersonales, esquemaNuevoBot, esquemaTopes } from '../../dominio/bots';
import type { Definicion } from '../../dominio/definicion';
import {
  BAJA_MAXIMA_ACIERTO, ORIGENES_CAMBIO, type Borrador, type Cambio, type CambioResumen, type EventoPublicacion, type NuevoCambio, type Version, type VersionCompleta,
} from '../../dominio/versiones';
import type { Corrida, ResultadoCaso, ResumenCorrida } from '../../dominio/corridas';
import { FICHAS_MOTORES, MOTORES_POR_DEFECTO, fichaMotor, type FichaMotor } from '../../dominio/motores';
import { exigir, puede, type Accion } from '../../dominio/permisos';
import type {
  Bot, CambiosBot, EleccionMotores, FuncionMotor, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolEfectivo, RolModulo, Topes, UsoMotor,
} from '../../dominio/tipos';
import { PRODUCTO } from '../../dominio/tipos';
import { ErrorDatos } from '../errores';
import type {
  BotPublico, CanalWeb, CanalWhatsapp, CanalWhatsappPublico, ConexionWhatsapp, ConversacionCompleta, EntradaWebhook, EnvioPendiente, ExportacionBase,
  ExportacionContacto, FichaContacto, FilaBaseContacto, FilaContacto, FilaConversacion, FiltroContactos, FiltroConversaciones, FiltroLlamadas, FilaMuestra,
  PaginaContactos, PlantillaEnviada, PlantillaGuardada, Repositorio, RepositorioPublico, RepositorioTareas, RepositorioWhatsapp, ResultadoEnvio, SaludCanal,
  TurnoDevuelto, TurnoGuardado,
} from '../repositorio';
import { claveConsulta, consultasDeEventos } from '../../dominio/contactos';
import {
  estadoSiguiente, mensajePlantilla, ventanaAbierta, type EstadoCanal, type EstadoEnvio, type MensajeWhatsapp, type Plantilla,
} from '../../dominio/whatsapp';
import {
  inicioVentana, LIMITES_WEB, MINUTOS_ALERTA_DERIVADA, type Alerta, type Canal, type Condiciones, type Contacto, type Conversacion, type EventoAnalitica, type Mensaje, type PedidoDatos,
} from '../../dominio/conversaciones';
import { sesionNueva } from '../../dominio/motor';
import { semillaDemo } from './semilla';
import { semillaCanal } from './semilla-canal';

type VersionDemo = Version & { definicion: unknown };

interface EstadoDemo {
  bots: Bot[];
  motores: Map<string, MotorFuncion[]>;
  llamadas: LlamadaMotor[];
  versiones: VersionDemo[];
  cambios: Map<string, Cambio[]>;
  corridas: (Corrida & { resultados: ResultadoCaso[] })[];
  eventos: EventoPublicacion[];
  claves: Map<string, string>;
  siguienteBot: number;
  siguienteLlamada: number;
  siguienteVersion: number;
  // Etapas 5 y 6: canal web, conversaciones y bandeja.
  canales: Map<string, CanalWeb>;
  condiciones: Condiciones[];
  contactos: Contacto[];
  conversaciones: Conversacion[];
  mensajes: Map<string, Mensaje[]>;
  analitica: (EventoAnalitica & { botId: string; versionId: string | null; canal: Canal; conversacionId: string; contactoHash: string; fecha: string })[];
  conteos: Map<string, number>;
  alertas: Alerta[];
  revisiones: Map<string, { veredicto: 'correcta' | 'incorrecta'; convertida: boolean; por: string; fecha: string }>;
  pedidos: PedidoDatos[];
  exportaciones: ExportacionBase[];
  siguienteId: number;
  // Etapa 7: WhatsApp.
  wa: {
    canales: CanalDemo[];
    /** Vault simulado: la clave de cada canal, por su referencia. */
    vault: Map<string, string>;
    entradas: Map<string, EntradaDemo>;
    envios: EnvioDemo[];
    stats: Map<string, StatsDia>;
    plantillas: PlantillaGuardada[];
  };
}

interface CanalDemo {
  id: string;
  botId: string;
  campanaId: string;
  estado: EstadoCanal;
  numero: string | null;
  webhookUrl: string | null;
  conectadoEn: string | null;
  secretoHash: string | null;
  claveRef: string | null;
  ultimoRecibido: string | null;
  ultimoError: string | null;
  ultimoErrorEn: string | null;
  plantillasRevisadasEn: string | null;
}

interface EntradaDemo {
  canalId: string;
  clave: string;
  entrada: EntradaWebhook | null;
  recibidaEn: string;
  procesadaEn: string | null;
  tomadaEn: string | null;
  intentos: number;
}

interface EnvioDemo {
  id: string;
  canalId: string;
  conversacionId: string;
  n: number;
  parte: number;
  mensaje: MensajeWhatsapp;
  estado: 'pendiente' | 'enviando' | EstadoEnvio;
  idProveedor: string | null;
  intentos: number;
  proximo: string;
  error: string | null;
  creadoEn: string;
}

interface StatsDia {
  recibidos: number;
  repetidos: number;
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  avisos: number;
  demoraTotalMs: number;
  demoraMaxMs: number;
}

const statsVacias = (): StatsDia => ({ recibidos: 0, repetidos: 0, enviados: 0, entregados: 0, leidos: 0, fallidos: 0, avisos: 0, demoraTotalMs: 0, demoraMaxMs: 0 });

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

export class RepositorioDemo implements Repositorio, RepositorioPublico, RepositorioTareas, RepositorioWhatsapp {
  private e: EstadoDemo;

  constructor(opciones: { ahora?: Date; vacio?: boolean } = {}) {
    const ahora = opciones.ahora ?? new Date();
    const s: ReturnType<typeof semillaDemo> = opciones.vacio ? { bots: [], motores: new Map(), llamadas: [], versiones: [] } : semillaDemo(ahora);
    const c = opciones.vacio ? null : semillaCanal(ahora);
    if (c) {
      s.bots.push(c.bot);
      s.motores.set(c.bot.id, c.motores);
      s.versiones.push(c.version);
    }
    const hace = (min: number) => new Date(new Date(c?.publicadoDesde ?? ahora).getTime() - min * 60_000).toISOString();
    this.e = {
      bots: s.bots,
      motores: s.motores,
      llamadas: s.llamadas,
      versiones: s.versiones,
      cambios: new Map(),
      corridas: [],
      eventos: c ? [
        { id: 1, botId: c.bot.id, versionId: c.version.id, accion: 'pedido', nota: 'Primera versión para la web', corridaId: null, personaId: 'p-lucia', fecha: hace(60) },
        { id: 2, botId: c.bot.id, versionId: c.version.id, accion: 'aprobado', nota: '', corridaId: null, personaId: 'p-joaquin', fecha: hace(0) },
      ] : [],
      claves: new Map(),
      siguienteBot: s.bots.length + 1,
      siguienteLlamada: s.llamadas.length + 1,
      siguienteVersion: s.versiones.length + 1,
      canales: new Map(),
      condiciones: c?.condiciones ?? [],
      contactos: c?.contactos ?? [],
      conversaciones: c?.conversaciones ?? [],
      mensajes: c?.mensajes ?? new Map(),
      analitica: c?.analitica ?? [],
      conteos: new Map(),
      alertas: [],
      revisiones: new Map(),
      pedidos: [],
      exportaciones: [],
      siguienteId: 100,
      wa: {
        canales: c ? [{
          id: c.whatsapp.id, botId: c.whatsapp.botId, campanaId: c.whatsapp.campanaId, estado: 'activo', numero: c.whatsapp.numero, webhookUrl: c.whatsapp.webhookUrl,
          conectadoEn: c.whatsapp.conectadoEn, secretoHash: c.whatsapp.secretoHash, claveRef: 'vault-demo-1', ultimoRecibido: null, ultimoError: null, ultimoErrorEn: null,
          plantillasRevisadasEn: null,
        }] : [],
        vault: new Map(c ? [['vault-demo-1', c.whatsapp.clave]] : []),
        entradas: new Map(),
        envios: [],
        stats: new Map(),
        plantillas: c ? c.whatsapp.plantillas.map((pl) => ({ ...pl, canalId: c.whatsapp.id, creadaPor: null, creadaEn: c.whatsapp.conectadoEn, revisadaEn: c.whatsapp.conectadoEn })) : [],
      },
    };
  }

  // ── Permisos (la tercera capa, como la base) ──────────────────────────────────────────────────

  private rol(campanaId: string, personaId: string): RolEfectivo | null {
    return rolEnCampana(nucleoMemoria(), personaId, campanaId, PRODUCTO) as RolEfectivo | null;
  }

  private exigir(campanaId: string, personaId: string, accion: Accion): void {
    try {
      exigir(this.rol(campanaId, personaId), accion);
    } catch {
      throw new ErrorDatos('sin_permiso', `Tu rol no permite esta acción (${accion}).`);
    }
  }

  private botEditable(botId: string): Bot {
    const b = this.e.bots.find((x) => x.id === botId);
    if (!b) throw new ErrorDatos('no_existe', 'No existe el bot.');
    return b;
  }

  // ── Lectura ───────────────────────────────────────────────────────────────────────────────────

  async campanaPreparada(campanaId: string): Promise<boolean> {
    const c = nucleoMemoria().campanas.find((x) => x.id === campanaId);
    return !!c?.productos.some((p) => p.productoId === PRODUCTO);
  }

  async bots(campanaId: string, opciones: { archivados?: boolean } = {}): Promise<Bot[]> {
    return this.e.bots
      .filter((b) => b.campanaId === campanaId && (opciones.archivados || b.estado !== 'archivado'))
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
      .map((b) => ({ ...b }));
  }

  async bot(botId: string): Promise<Bot | null> {
    const b = this.e.bots.find((x) => x.id === botId);
    return b ? { ...b } : null;
  }

  async topesBot(botId: string): Promise<Topes | null> {
    const b = this.e.bots.find((x) => x.id === botId);
    return b ? { diarioUsd: b.topeDiarioUsd, mensualUsd: b.topeMensualUsd } : null;
  }

  async fichas(): Promise<FichaMotor[]> {
    return FICHAS_MOTORES.map((f) => ({ ...f }));
  }

  async motoresPorDefecto(): Promise<MotorFuncion[]> {
    return MOTORES_POR_DEFECTO.map((m) => ({ ...m }));
  }

  async motoresDeBot(botId: string): Promise<MotorFuncion[]> {
    return (this.e.motores.get(botId) ?? []).map((m) => ({ ...m }));
  }

  async gastoBot(botId: string, desdeDia: string, uso?: UsoMotor): Promise<number> {
    return this.e.llamadas
      .filter((l) => l.botId === botId && l.fecha.slice(0, 10) >= desdeDia && (!uso || l.uso === uso))
      .reduce((a, l) => a + l.costoUsd, 0);
  }

  async gastoPorDia(campanaId: string, desdeDia: string): Promise<GastoDia[]> {
    const m = new Map<string, GastoDia>();
    for (const l of this.e.llamadas) {
      if (l.campanaId !== campanaId || l.fecha.slice(0, 10) < desdeDia) continue;
      const clave = `${l.botId}|${l.fecha.slice(0, 10)}|${l.uso}`;
      const g = m.get(clave) ?? { botId: l.botId, dia: l.fecha.slice(0, 10), uso: l.uso, costoUsd: 0, llamadas: 0 };
      g.costoUsd += l.costoUsd;
      g.llamadas += 1;
      m.set(clave, g);
    }
    return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia));
  }

  async llamadas(campanaId: string, filtro: FiltroLlamadas = {}): Promise<LlamadaMotor[]> {
    return this.e.llamadas
      .filter((l) => l.campanaId === campanaId && (!filtro.botId || l.botId === filtro.botId) && (!filtro.desde || l.fecha >= filtro.desde))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
      .slice(0, filtro.limite ?? 200)
      .map((l) => ({ ...l }));
  }

  // ── Escritura ─────────────────────────────────────────────────────────────────────────────────

  async crearBot(campanaId: string, datos: NuevoBot, clave: string, por: string, definicion?: Definicion): Promise<string> {
    this.exigir(campanaId, por, 'editar_borrador');
    const ya = clave ? this.e.claves.get(clave) : undefined;
    if (ya) {
      if (this.e.bots.find((b) => b.id === ya)?.campanaId !== campanaId) throw new ErrorDatos('clave', 'La clave del formulario es de otra campaña.');
      return ya;
    }
    if (!(await this.campanaPreparada(campanaId))) throw new ErrorDatos('campana', 'BotMaker no está preparado en esta campaña.');
    const v = esquemaNuevoBot.parse(datos);
    const campana = nucleoMemoria().campanas.find((c) => c.id === campanaId)!;
    const ahora = new Date().toISOString();
    const id = `bot-${this.e.siguienteBot++}`;
    this.e.bots.push({
      id, campanaId, organizacionId: campana.organizacionId, nombre: v.nombre, idPublico: this.nuevoIdPublico(), caso: v.caso, mercado: v.mercado,
      estado: 'borrador', versionPublicadaId: null, trato: v.trato, avisoIa: '', personalizacion: false, diasGuardado: 90,
      topeDiarioUsd: 5, topeMensualUsd: 100, creadoPor: por, creadoEn: ahora, actualizadoEn: ahora, archivadoEn: null,
    });
    this.e.motores.set(id, MOTORES_POR_DEFECTO.map((m) => ({ ...m })));
    if (definicion) this.agregarVersion(this.e.bots.at(-1)!, definicion, null, por);
    if (clave) this.e.claves.set(clave, id);
    return id;
  }

  async guardarBot(botId: string, cambios: CambiosBot, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'editar_borrador');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    const v = esquemaCambiosBot.parse(cambios);
    if (v.nombre !== undefined) b.nombre = v.nombre;
    if (v.caso !== undefined) b.caso = v.caso;
    if (v.mercado !== undefined) b.mercado = v.mercado;
    if (v.trato !== undefined) b.trato = v.trato;
    if (v.avisoIa !== undefined) b.avisoIa = v.avisoIa;
    b.actualizadoEn = new Date().toISOString();
  }

  async guardarMotores(botId: string, motores: EleccionMotores, topes: Topes | null, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'elegir_motores');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    const actuales = this.e.motores.get(botId) ?? [];
    for (const [funcion, eleccion] of Object.entries(motores)) {
      if (!eleccion) continue;
      const f = fichaMotor(eleccion.principal);
      if (!f || !f.activo) throw new ErrorDatos('motor', `Motor desconocido o apagado: ${eleccion.principal}`);
      if (eleccion.respaldo && !fichaMotor(eleccion.respaldo)?.activo) throw new ErrorDatos('motor', `Motor desconocido o apagado: ${eleccion.respaldo}`);
      const sirve = (id: string) => !!fichaMotor(id)?.funciones.includes(funcion as FuncionMotor);
      if (!sirve(eleccion.principal) || (eleccion.respaldo && !sirve(eleccion.respaldo))) throw new ErrorDatos('motor_funcion', `El motor no sirve para la función ${funcion}.`);
      if (eleccion.respaldo === eleccion.principal) throw new ErrorDatos('respaldo_igual', 'El respaldo tiene que ser otro motor.');
      const m = actuales.find((x) => x.funcion === funcion);
      if (!m) throw new ErrorDatos('funcion', `Función desconocida: ${funcion}`);
      const doble = eleccion.dobleLectura ?? (m.dobleLectura && !!eleccion.respaldo);
      if (doble && funcion !== 'interpretar') throw new ErrorDatos('doble_lectura', 'La doble lectura es solo para interpretar.');
      if (doble && !eleccion.respaldo) throw new ErrorDatos('doble_lectura', 'La doble lectura necesita un motor de respaldo.');
      m.principal = eleccion.principal;
      m.respaldo = eleccion.respaldo;
      m.dobleLectura = doble;
    }
    if (topes) {
      const t = esquemaTopes.parse(topes);
      b.topeDiarioUsd = t.diarioUsd;
      b.topeMensualUsd = t.mensualUsd;
    }
    b.actualizadoEn = new Date().toISOString();
  }

  async guardarDatosPersonales(botId: string, personalizacion: boolean, diasGuardado: number, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'gestionar_datos_contactos');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    const v = esquemaDatosPersonales.parse({ personalizacion, diasGuardado });
    b.personalizacion = v.personalizacion;
    b.diasGuardado = v.diasGuardado;
    b.actualizadoEn = new Date().toISOString();
  }

  async archivarBot(botId: string, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'publicar');
    if (b.estado === 'archivado') return;
    b.estado = 'archivado';
    b.archivadoEn = new Date().toISOString();
  }

  async asignarRol(campanaId: string, personaId: string, rol: RolModulo | null, por: string): Promise<void> {
    this.exigir(campanaId, por, 'gestionar_equipo');
    await operacionesCampanaMemoria(por).asignarAcceso(campanaId, PRODUCTO, personaId, rol);
  }

  async registrarLlamada(l: NuevaLlamada): Promise<void> {
    this.e.llamadas.push({ ...l, id: this.e.siguienteLlamada++, fecha: l.fecha ?? new Date().toISOString() });
  }

  // ── Versiones y borrador ──────────────────────────────────────────────────────────────────────

  async versiones(botId: string): Promise<Version[]> {
    return this.e.versiones
      .filter((v) => v.botId === botId)
      .sort((a, b) => b.numero - a.numero)
      .map(({ definicion: _, ...v }) => ({ ...v }));
  }

  async borrador(botId: string): Promise<Borrador | null> {
    const v = this.e.versiones.find((x) => x.botId === botId && x.estado === 'borrador');
    return v ? { ...v, definicion: structuredClone(v.definicion) } : null;
  }

  async crearBorrador(botId: string, definicion: Definicion | null, por: string): Promise<string> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'editar_borrador');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    const ya = this.e.versiones.find((x) => x.botId === botId && x.estado === 'borrador');
    if (ya) return ya.id;
    let base: VersionDemo | undefined;
    if (!definicion) {
      // Como bots_0005: primero lo pedido para publicar, después lo publicado, después la última.
      const delBot = this.e.versiones.filter((x) => x.botId === botId).sort((x, y) => y.numero - x.numero);
      base = delBot.find((x) => x.estado === 'pedida') ?? this.e.versiones.find((x) => x.id === b.versionPublicadaId) ?? delBot[0];
      if (!base) throw new ErrorDatos('sin_version', 'El bot no tiene una versión de la que partir.');
    }
    return this.agregarVersion(b, definicion ?? base!.definicion, base?.id ?? null, por).id;
  }

  async guardarCambio(versionId: string, seqEsperada: number, cambio: NuevoCambio, definicion: Definicion, por: string): Promise<number> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    if (!v) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(v.botId);
    this.exigir(b.campanaId, por, 'editar_borrador');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    if (v.estado !== 'borrador') throw new ErrorDatos('no_borrador', 'Esta versión ya no es un borrador.');
    // Los mismos controles que las restricciones de bots.versions y bots.version_changes.
    const conObjetivo = cambio.origen === 'deshacer' || cambio.origen === 'rehacer';
    const resumen = cambio.resumen.trim().slice(0, 500);
    if (
      (definicion as { formato?: unknown } | null)?.formato !== 1 || !ORIGENES_CAMBIO.includes(cambio.origen) || !resumen
      || conObjetivo !== (cambio.objetivo !== null) || (cambio.objetivo !== null && (cambio.objetivo < 1 || cambio.objetivo > v.seq))
    ) {
      throw new ErrorDatos('datos', 'El cambio no es válido.');
    }
    if (v.seq !== seqEsperada) throw new ErrorDatos('borrador_cambio', 'El borrador cambió mientras lo editabas.');
    v.seq += 1;
    v.definicion = structuredClone(definicion);
    v.actualizadaEn = new Date().toISOString();
    const lista = this.e.cambios.get(versionId) ?? [];
    lista.push({ ...structuredClone(cambio), resumen, seq: v.seq, personaId: por, fecha: v.actualizadaEn });
    this.e.cambios.set(versionId, lista);
    return v.seq;
  }

  async cambios(versionId: string): Promise<CambioResumen[]> {
    return (this.e.cambios.get(versionId) ?? []).map((c) => ({ seq: c.seq, origen: c.origen, resumen: c.resumen, objetivo: c.objetivo, personaId: c.personaId, fecha: c.fecha }));
  }

  async cambio(versionId: string, seq: number): Promise<Cambio | null> {
    const c = (this.e.cambios.get(versionId) ?? []).find((x) => x.seq === seq);
    return c ? structuredClone(c) : null;
  }

  async version(versionId: string): Promise<VersionCompleta | null> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    return v ? { ...v, definicion: structuredClone(v.definicion) } : null;
  }

  // ── Corridas ──────────────────────────────────────────────────────────────────────────────────

  private corridaEditable(corridaId: string, por: string) {
    const r = this.e.corridas.find((x) => x.id === corridaId);
    if (!r) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(r.botId);
    this.exigir(b.campanaId, por, 'correr_pruebas');
    if (r.estado !== 'en_curso') throw new ErrorDatos('corrida_terminada', 'La corrida ya terminó.');
    return r;
  }

  async crearCorrida(versionId: string, motores: Record<string, unknown>, etiqueta: string, total: number, por: string): Promise<string> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    if (!v) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(v.botId);
    this.exigir(b.campanaId, por, 'correr_pruebas');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    const id = `corrida-${this.e.corridas.length + 1}`;
    this.e.corridas.push({
      id, botId: v.botId, versionId, versionSeq: v.seq, motores: structuredClone(motores), etiqueta: etiqueta.trim().slice(0, 200), estado: 'en_curso',
      total, hechos: 0, resumen: null, costoUsd: 0, creadaPor: por, creadaEn: new Date().toISOString(), terminadaEn: null, resultados: [],
    });
    return id;
  }

  async guardarResultados(corridaId: string, resultados: ResultadoCaso[], por: string): Promise<number> {
    const r = this.corridaEditable(corridaId, por);
    for (const x of resultados) if (!r.resultados.some((y) => y.caso === x.caso)) r.resultados.push(structuredClone(x));
    r.hechos = r.resultados.length;
    r.costoUsd = r.resultados.reduce((a, x) => a + x.costo, 0);
    return r.hechos;
  }

  async cerrarCorrida(corridaId: string, resumen: ResumenCorrida | null, estado: 'terminada' | 'cancelada', por: string): Promise<void> {
    const r = this.corridaEditable(corridaId, por);
    r.estado = estado;
    r.resumen = resumen ? structuredClone(resumen) : null;
    r.terminadaEn = new Date().toISOString();
  }

  async corridas(botId: string): Promise<Corrida[]> {
    return this.e.corridas.filter((r) => r.botId === botId).reverse().map(({ resultados: _, ...r }) => structuredClone(r));
  }

  async corrida(corridaId: string): Promise<(Corrida & { resultados: ResultadoCaso[] }) | null> {
    const r = this.e.corridas.find((x) => x.id === corridaId);
    return r ? structuredClone(r) : null;
  }

  // ── Publicación (las mismas reglas que bots.pedir_publicacion y compañía) ─────────────────────

  private aciertoDe(versionId: string, seq: number | null): number | null {
    const r = this.e.corridas
      .filter((x) => x.versionId === versionId && x.estado === 'terminada' && (seq === null || x.versionSeq === seq) && typeof x.resumen?.acierto === 'number')
      .sort((a, b) => (b.terminadaEn ?? '').localeCompare(a.terminadaEn ?? ''))[0];
    return r?.resumen?.acierto ?? null;
  }

  private evento(v: VersionDemo, accion: EventoPublicacion['accion'], nota: string, por: string, corridaId: string | null = null) {
    this.e.eventos.push({ id: this.e.eventos.length + 1, botId: v.botId, versionId: v.id, accion, nota: nota.slice(0, 2000), corridaId, personaId: por, fecha: new Date().toISOString() });
  }

  async pedirPublicacion(versionId: string, seqEsperada: number, nota: string, por: string): Promise<void> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    if (!v) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(v.botId);
    this.exigir(b.campanaId, por, 'pedir_publicacion');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    if (v.estado !== 'borrador') throw new ErrorDatos('no_borrador', 'Esta versión ya no es un borrador.');
    if (v.seq !== seqEsperada) throw new ErrorDatos('borrador_cambio', 'El borrador cambió mientras lo editabas.');
    const corrida = this.e.corridas.filter((x) => x.versionId === versionId && x.versionSeq === v.seq && x.estado === 'terminada').at(-1);
    if (!corrida) throw new ErrorDatos('sin_corrida', 'Falta correr las pruebas sobre el último cambio del borrador.');
    const nuevo = this.aciertoDe(versionId, v.seq);
    const publicado = b.versionPublicadaId ? this.aciertoDe(b.versionPublicadaId, null) : null;
    if (nuevo !== null && publicado !== null && publicado - nuevo >= BAJA_MAXIMA_ACIERTO) throw new ErrorDatos('baja_acierto', `La versión baja el acierto de ${publicado} a ${nuevo}.`);
    v.estado = 'pedida';
    this.evento(v, 'pedido', nota, por, corrida.id);
  }

  async aprobarPublicacion(versionId: string, nota: string, por: string): Promise<void> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    if (!v) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(v.botId);
    this.exigir(b.campanaId, por, 'publicar');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    if (v.estado !== 'pedida') throw new ErrorDatos('sin_pedido', 'Esa versión no tiene un pedido de publicación.');
    for (const x of this.e.versiones) if (x.botId === v.botId && x.estado === 'publicada') x.estado = 'archivada';
    v.estado = 'publicada';
    b.versionPublicadaId = v.id;
    if (b.estado !== 'pausado') b.estado = 'publicado';
    b.actualizadoEn = new Date().toISOString();
    this.evento(v, 'aprobado', nota, por);
  }

  async devolverPublicacion(versionId: string, nota: string, por: string): Promise<void> {
    const v = this.e.versiones.find((x) => x.id === versionId);
    if (!v) throw new ErrorDatos('no_existe', 'No existe el bot o la campaña.');
    const b = this.botEditable(v.botId);
    this.exigir(b.campanaId, por, 'publicar');
    if (v.estado !== 'pedida') throw new ErrorDatos('sin_pedido', 'Esa versión no tiene un pedido de publicación.');
    if (!nota.trim()) throw new ErrorDatos('falta_comentario', 'Para devolver hace falta un comentario.');
    v.estado = this.e.versiones.some((x) => x.botId === v.botId && x.estado === 'borrador') ? 'devuelta' : 'borrador';
    this.evento(v, 'devuelto', nota, por);
  }

  async eventosPublicacion(botId: string): Promise<EventoPublicacion[]> {
    return this.e.eventos.filter((x) => x.botId === botId).reverse().map((x) => ({ ...x }));
  }

  // ── Pausar (etapa 5) ──────────────────────────────────────────────────────────────────────────

  async pausarBot(botId: string, pausar: boolean, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'publicar');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    if (pausar) {
      if (b.estado !== 'publicado') throw new ErrorDatos('no_publicado', 'Solo se pausa un bot publicado.');
      b.estado = 'pausado';
    } else {
      if (b.estado !== 'pausado') throw new ErrorDatos('no_pausado', 'El bot no está en pausa.');
      b.estado = 'publicado';
    }
    b.actualizadoEn = new Date().toISOString();
  }

  // ── Canal web y condiciones ───────────────────────────────────────────────────────────────────

  async canalWeb(botId: string): Promise<CanalWeb> {
    return { ...(this.e.canales.get(botId) ?? { activo: true, modoCondiciones: 'aviso' }) };
  }

  async guardarCanalWeb(botId: string, canal: CanalWeb, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    if (!['aviso', 'acepto'].includes(canal.modoCondiciones)) throw new ErrorDatos('datos', 'Modo de condiciones inválido.');
    this.e.canales.set(botId, { activo: !!canal.activo, modoCondiciones: canal.modoCondiciones });
  }

  async condiciones(botId: string): Promise<Condiciones[]> {
    return this.e.condiciones.filter((c) => c.botId === botId).sort((a, b) => b.numero - a.numero).map((c) => ({ ...c }));
  }

  async publicarCondiciones(botId: string, texto: string, por: string): Promise<number> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    const t = texto.trim();
    if (!t || t.length > 20000) throw new ErrorDatos('datos', 'Las condiciones tienen que tener texto (hasta 20.000 caracteres).');
    const numero = Math.max(0, ...this.e.condiciones.filter((c) => c.botId === botId).map((c) => c.numero)) + 1;
    this.e.condiciones.push({ botId, numero, texto: t, publicadasEn: new Date().toISOString(), publicadasPor: por });
    return numero;
  }

  // ── App pública ───────────────────────────────────────────────────────────────────────────────

  async botPublico(idPublico: string): Promise<BotPublico | null> {
    const b = this.e.bots.find((x) => x.idPublico === idPublico);
    if (!b) return null;
    const v = this.e.versiones.find((x) => x.id === b.versionPublicadaId);
    const org = nucleoMemoria().organizaciones.find((o) => o.id === b.organizacionId);
    const cond = this.e.condiciones.filter((c) => c.botId === b.id).sort((x, y) => y.numero - x.numero)[0];
    const aprobado = this.e.eventos.filter((e) => e.botId === b.id && e.accion === 'aprobado').sort((x, y) => x.fecha.localeCompare(y.fecha))[0];
    const campana = nucleoMemoria().campanas.find((x) => x.id === b.campanaId);
    return {
      bot: { ...b }, campana: { nombre: campana?.nombre ?? '', zonaHoraria: campana?.ubicacion.zonaHoraria ?? 'UTC' },
      version: v ? { id: v.id, numero: v.numero, definicion: structuredClone(v.definicion) } : null, publicadoDesde: aprobado?.fecha ?? null,
      organizacionDemo: !!org?.demo, canal: await this.canalWeb(b.id), condiciones: cond ? { numero: cond.numero, texto: cond.texto } : null,
    };
  }

  async contar(claves: readonly { clave: string; ventanaSegundos: number }[], ahora: Date): Promise<number[]> {
    return claves.map((c) => {
      const k = `${c.clave}|${inicioVentana(ahora, c.ventanaSegundos)}`;
      const n = (this.e.conteos.get(k) ?? 0) + 1;
      this.e.conteos.set(k, n);
      return n;
    });
  }

  private nuevoId(prefijo: string): string {
    return `${prefijo}-${this.e.siguienteId++}`;
  }

  async buscarConversacion(botId: string, contactoHash: string): Promise<{ conversacion: Conversacion; contacto: Contacto } | null> {
    const contacto = this.e.contactos.find((c) => c.botId === botId && c.hash === contactoHash);
    if (!contacto) return null;
    const c = this.e.conversaciones.filter((x) => x.contactoId === contacto.id && x.estado !== 'cerrada').sort((x, y) => y.iniciadaEn.localeCompare(x.iniciadaEn))[0];
    return c ? { conversacion: structuredClone(c), contacto: { ...contacto } } : null;
  }

  async abrirConversacion(p: { botId: string; contactoHash: string; canal: Canal; verificadoAhora: boolean; ahora: Date }): Promise<{ conversacion: Conversacion; contacto: Contacto; nueva: boolean }> {
    const b = this.botEditable(p.botId);
    const iso = p.ahora.toISOString();
    let contacto = this.e.contactos.find((c) => c.botId === b.id && c.hash === p.contactoHash);
    if (!contacto) {
      contacto = {
        id: this.nuevoId('ct'), botId: b.id, campanaId: b.campanaId, canal: p.canal, hash: p.contactoHash, nombre: null, datos: {},
        condicionesVersion: null, condicionesAceptadasEn: null, verificadoEn: null, creadoEn: iso, borradoEn: null,
      };
      this.e.contactos.push(contacto);
    }
    if (p.verificadoAhora) contacto.verificadoEn = iso;
    const verificada = !!contacto.verificadoEn && new Date(contacto.verificadoEn).getTime() >= p.ahora.getTime() - LIMITES_WEB.horasVerificacion * 36e5;
    const limite = p.ahora.getTime() - LIMITES_WEB.minutosSesion * 60_000;
    let c = this.e.conversaciones.filter((x) => x.contactoId === contacto!.id && x.estado !== 'cerrada').sort((x, y) => y.iniciadaEn.localeCompare(x.iniciadaEn))[0];
    if (c && c.estado === 'bot' && new Date(c.actualizadaEn).getTime() < limite) {
      c.estado = 'cerrada';
      c = undefined;
    }
    if (c) {
      if (verificada) c.verificada = true;
      return { conversacion: structuredClone(c), contacto: { ...contacto }, nueva: false };
    }
    const nueva: Conversacion = {
      id: this.nuevoId('conv'), botId: b.id, campanaId: b.campanaId, contactoId: contacto.id, canal: p.canal, versionId: b.versionPublicadaId,
      estado: 'bot', sesion: sesionNueva(), cajaActual: null, asignadaA: null, derivadaEn: null, motivoDerivacion: null, cajaDerivacion: null,
      ultimoDelContacto: null, ultimoDelEquipo: null, verificada, seq: 0, iniciadaEn: iso, actualizadaEn: iso,
    };
    this.e.conversaciones.push(nueva);
    this.e.mensajes.set(nueva.id, []);
    return { conversacion: structuredClone(nueva), contacto: { ...contacto }, nueva: true };
  }

  async mensajes(conversacionId: string, desde: number): Promise<Mensaje[]> {
    return (this.e.mensajes.get(conversacionId) ?? []).filter((m) => m.n > desde).map((m) => structuredClone(m));
  }

  async mensajePorIdCanal(conversacionId: string, idCanal: string): Promise<Mensaje | null> {
    const m = (this.e.mensajes.get(conversacionId) ?? []).find((x) => x.idCanal === idCanal);
    return m ? structuredClone(m) : null;
  }

  private conv(conversacionId: string): Conversacion {
    const c = this.e.conversaciones.find((x) => x.id === conversacionId);
    if (!c) throw new ErrorDatos('no_existe', 'No existe la conversación.');
    return c;
  }

  private agregarMensaje(c: Conversacion, m: Omit<Mensaje, 'conversacionId' | 'n'>): Mensaje {
    const lista = this.e.mensajes.get(c.id) ?? [];
    const nuevo: Mensaje = { ...structuredClone(m), conversacionId: c.id, n: c.seq + 1 };
    lista.push(nuevo);
    this.e.mensajes.set(c.id, lista);
    c.seq += 1;
    c.actualizadaEn = m.creadoEn;
    return nuevo;
  }

  private anotar(c: Conversacion, contacto: Contacto, eventos: readonly EventoAnalitica[], fecha: string) {
    for (const e of eventos) {
      this.e.analitica.push({ ...structuredClone(e), botId: c.botId, versionId: c.versionId, canal: c.canal, conversacionId: c.id, contactoHash: contacto.hash, fecha });
    }
  }

  async guardarTurno(conversacionId: string, seqEsperada: number, t: TurnoGuardado): Promise<Mensaje[]> {
    const c = this.conv(conversacionId);
    if (c.seq !== seqEsperada) throw new ErrorDatos('conversacion_cambio', 'La conversación cambió mientras se contestaba.');
    if (t.entrante?.idCanal && (this.e.mensajes.get(c.id) ?? []).some((m) => m.idCanal === t.entrante!.idCanal)) throw new ErrorDatos('repetido', 'Ese mensaje ya llegó.');
    const contacto = this.e.contactos.find((x) => x.id === c.contactoId)!;
    const nuevos: Mensaje[] = [];
    if (t.entrante) {
      nuevos.push(this.agregarMensaje(c, { autor: 'contacto', personaId: null, tipo: t.entrante.tipo, texto: t.entrante.texto, datos: t.entrante.datos, cajaId: null, decision: null, versionId: t.versionId, idCanal: t.entrante.idCanal, muestra: false, creadoEn: t.ahora }));
      c.ultimoDelContacto = t.ahora;
    }
    let primero = true;
    const canalWa = c.canal === 'whatsapp' ? this.e.wa.canales.find((x) => x.botId === c.botId) : undefined;
    for (const m of t.salientes) {
      const esBot = m.autor === 'bot';
      const nuevo = this.agregarMensaje(c, {
        autor: m.autor, personaId: null, tipo: 'texto', texto: m.texto, datos: m.datos, cajaId: m.cajaId, decision: esBot && primero ? t.decision : null,
        versionId: t.versionId, idCanal: null, muestra: esBot && primero && t.muestra, creadoEn: t.ahora,
      });
      if (canalWa && m.envios?.length) this.encolar(canalWa.id, c, nuevo, m.envios, t.ahora);
      nuevos.push(nuevo);
      if (esBot) primero = false;
    }
    if (t.ventanaHasta && t.entrante) c.ventanaHasta = t.ventanaHasta;
    c.sesion = structuredClone(t.sesion);
    c.estado = t.estado;
    c.cajaActual = t.cajaActual;
    c.versionId = t.versionId ?? c.versionId;
    if (t.derivacion) {
      c.derivadaEn = t.ahora;
      c.motivoDerivacion = t.derivacion.motivo;
      c.cajaDerivacion = t.derivacion.cajaId;
    }
    for (const [k, v] of Object.entries(t.datosContacto)) {
      contacto.datos[k] = v;
      if (k === 'contacto.nombre') contacto.nombre = v;
    }
    this.anotar(c, contacto, t.eventos, t.ahora);
    return nuevos.map((m) => structuredClone(m));
  }

  async aceptarCondiciones(contactoId: string, numero: number, ahora: Date): Promise<void> {
    const c = this.e.contactos.find((x) => x.id === contactoId);
    if (!c) throw new ErrorDatos('no_existe', 'No existe el contacto.');
    c.condicionesVersion = numero;
    c.condicionesAceptadasEn = ahora.toISOString();
  }

  // ── Bandeja ───────────────────────────────────────────────────────────────────────────────────

  async conversaciones(campanaId: string, filtro: FiltroConversaciones = {}): Promise<FilaConversacion[]> {
    const buscar = filtro.buscar?.trim().toLowerCase();
    return this.e.conversaciones
      .filter((c) => c.campanaId === campanaId && (!filtro.botId || c.botId === filtro.botId) && (!filtro.canal || c.canal === filtro.canal))
      .filter((c) => !filtro.estado || (filtro.estado === 'abiertas' ? c.estado === 'derivada' || c.estado === 'en_atencion' : c.estado === filtro.estado))
      .filter((c) => !filtro.asignadaA || c.asignadaA === filtro.asignadaA)
      .filter((c) => {
        if (!buscar) return true;
        const ct = this.e.contactos.find((x) => x.id === c.contactoId);
        return !!ct && [ct.nombre ?? '', ct.nombrePerfil ?? '', ct.telefono ?? '', ...Object.values(ct.datos)].some((x) => x.toLowerCase().includes(buscar));
      })
      .sort((a, b) => b.actualizadaEn.localeCompare(a.actualizadaEn))
      .slice(0, filtro.limite ?? 100)
      .map((c) => {
        const ct = this.e.contactos.find((x) => x.id === c.contactoId)!;
        const ms = this.e.mensajes.get(c.id) ?? [];
        const u = ms.at(-1);
        return {
          conversacion: structuredClone(c), contacto: { id: ct.id, nombre: ct.nombre, nombrePerfil: ct.nombrePerfil ?? null, borradoEn: ct.borradoEn },
          ultimo: u ? { autor: u.autor, texto: u.texto, creadoEn: u.creadoEn } : null, mensajes: ms.length,
        };
      });
  }

  async conversacion(conversacionId: string): Promise<ConversacionCompleta | null> {
    const c = this.e.conversaciones.find((x) => x.id === conversacionId);
    if (!c) return null;
    const ct = this.e.contactos.find((x) => x.id === c.contactoId)!;
    return { conversacion: structuredClone(c), contacto: structuredClone(ct), mensajes: (this.e.mensajes.get(c.id) ?? []).map((m) => ({ ...structuredClone(m), ...this.estadoEnvioDe(c.id, m) })) };
  }

  /** Cómo va el envío de un mensaje por WhatsApp: el de la parte más atrasada (fallido gana). */
  private estadoEnvioDe(conversacionId: string, m: Mensaje): { envio?: EstadoEnvio | null } {
    const partes = this.e.wa.envios.filter((x) => x.conversacionId === conversacionId && x.n === m.n);
    if (!partes.length) return m.envio ? { envio: m.envio } : {};
    const estados = partes.map((x) => (x.estado === 'enviando' ? 'pendiente' : x.estado));
    if (estados.includes('fallido')) return { envio: 'fallido' };
    const orden: EstadoEnvio[] = ['pendiente', 'enviado', 'entregado', 'leido'];
    return { envio: orden[Math.min(...estados.map((x) => orden.indexOf(x)))] ?? 'pendiente' };
  }

  private convDelEquipo(conversacionId: string, por: string, accion: Accion = 'responder_conversaciones'): Conversacion {
    const c = this.conv(conversacionId);
    this.exigir(c.campanaId, por, accion);
    return c;
  }

  async tomarConversacion(conversacionId: string, por: string): Promise<void> {
    const c = this.convDelEquipo(conversacionId, por);
    if (c.estado === 'cerrada') throw new ErrorDatos('conversacion_cerrada', 'La conversación está cerrada.');
    const ahora = new Date().toISOString();
    if (c.estado === 'bot') {
      c.derivadaEn = ahora;
      c.motivoDerivacion = 'La tomó el equipo';
      c.sesion = { ...c.sesion, estado: 'derivada', espera: null };
    }
    c.estado = 'en_atencion';
    c.asignadaA = por;
    c.actualizadaEn = ahora;
  }

  async responderConversacion(conversacionId: string, texto: string, por: string): Promise<number> {
    const c = this.convDelEquipo(conversacionId, por);
    const t = texto.trim();
    if (!t || t.length > 4096) throw new ErrorDatos('datos', 'La respuesta tiene que tener texto (hasta 4.096 caracteres).');
    if (c.estado !== 'derivada' && c.estado !== 'en_atencion') throw new ErrorDatos('no_derivada', 'Para responder, primero hay que tomar la conversación.');
    const ahora = new Date().toISOString();
    if (c.estado === 'derivada') {
      c.estado = 'en_atencion';
      c.asignadaA = por;
    }
    const canalWa = this.canalWaDeConversacion(c);
    if (canalWa && !ventanaAbierta(c.ventanaHasta, new Date(ahora))) throw new ErrorDatos('ventana_cerrada', 'La ventana de 24 horas está cerrada: solo se puede escribir con una plantilla.');
    const m = this.agregarMensaje(c, { autor: 'agente', personaId: por, tipo: 'texto', texto: t, datos: null, cajaId: null, decision: null, versionId: null, idCanal: null, muestra: false, creadoEn: ahora });
    if (canalWa) this.encolar(canalWa.id, c, m, [{ type: 'text', text: { body: t } }], ahora);
    c.ultimoDelEquipo = ahora;
    return m.n;
  }

  private canalWaDeConversacion(c: Conversacion): CanalDemo | null {
    return c.canal === 'whatsapp' ? this.e.wa.canales.find((x) => x.botId === c.botId) ?? null : null;
  }

  private encolar(canalId: string, c: Conversacion, m: Mensaje, envios: readonly MensajeWhatsapp[], ahora: string, fallido: string | null = null) {
    envios.forEach((mensaje, parte) => {
      this.e.wa.envios.push({
        id: this.nuevoId('env'), canalId, conversacionId: c.id, n: m.n, parte, mensaje: structuredClone(mensaje), estado: fallido ? 'fallido' : 'pendiente',
        idProveedor: null, intentos: 0, proximo: ahora, error: fallido, creadoEn: ahora,
      });
    });
  }

  async devolverConversacion(conversacionId: string, turno: TurnoDevuelto, por: string): Promise<void> {
    const c = this.convDelEquipo(conversacionId, por);
    if (c.estado !== 'derivada' && c.estado !== 'en_atencion') throw new ErrorDatos('no_derivada', 'La conversación no está derivada.');
    const ahora = new Date().toISOString();
    let primero = true;
    const canalWa = this.canalWaDeConversacion(c);
    const abierta = ventanaAbierta(c.ventanaHasta, new Date(ahora));
    for (const m of turno.mensajes) {
      const nuevo = this.agregarMensaje(c, { autor: 'bot', personaId: null, tipo: 'texto', texto: m.texto, datos: m.datos, cajaId: m.cajaId, decision: primero ? turno.decision : null, versionId: c.versionId, idCanal: null, muestra: false, creadoEn: ahora });
      if (canalWa && m.envios?.length) this.encolar(canalWa.id, c, nuevo, m.envios, ahora, abierta ? null : 'La ventana de 24 horas estaba cerrada: no se mandó.');
      primero = false;
    }
    c.estado = 'bot';
    c.asignadaA = null;
    c.sesion = structuredClone(turno.sesion);
    c.cajaActual = turno.cajaActual;
    c.actualizadaEn = ahora;
    const ct = this.e.contactos.find((x) => x.id === c.contactoId)!;
    this.anotar(c, ct, turno.eventos, ahora);
  }

  async cerrarConversacion(conversacionId: string, por: string): Promise<void> {
    const c = this.convDelEquipo(conversacionId, por);
    c.estado = 'cerrada';
    c.asignadaA = null;
    c.actualizadaEn = new Date().toISOString();
  }

  async alertas(campanaId: string, opciones: { abiertas?: boolean } = {}): Promise<Alerta[]> {
    // La demo no tiene tareas programadas: revisa al leer.
    await this.revisarAlertas(new Date());
    return this.e.alertas
      .filter((a) => a.campanaId === campanaId && (!opciones.abiertas || !a.cerradaEn))
      .sort((a, b) => b.abiertaEn.localeCompare(a.abiertaEn))
      .map((a) => ({ ...a }));
  }

  async revisarAlertas(ahora: Date): Promise<{ abiertas: number; cerradas: number }> {
    let abiertas = 0;
    let cerradas = 0;
    const iso = ahora.toISOString();
    const limite = ahora.getTime() - MINUTOS_ALERTA_DERIVADA * 60_000;
    const debe = new Map<string, { tipo: Alerta['tipo']; botId: string; campanaId: string; ref: string }>();
    for (const c of this.e.conversaciones) {
      const sinRespuesta = (c.estado === 'derivada' || c.estado === 'en_atencion') && c.derivadaEn && (!c.ultimoDelEquipo || c.ultimoDelEquipo < c.derivadaEn);
      if (sinRespuesta && new Date(c.derivadaEn!).getTime() <= limite) debe.set(`derivada_sin_respuesta|${c.id}`, { tipo: 'derivada_sin_respuesta', botId: c.botId, campanaId: c.campanaId, ref: c.id });
    }
    const dia = iso.slice(0, 10);
    for (const b of this.e.bots) {
      if (b.estado !== 'publicado' && b.estado !== 'pausado') continue;
      if (b.topeDiarioUsd > 0 && (await this.gastoBot(b.id, dia, 'en_vivo')) >= b.topeDiarioUsd) debe.set(`tope_alcanzado|${dia}|${b.id}`, { tipo: 'tope_alcanzado', botId: b.id, campanaId: b.campanaId, ref: dia });
    }
    for (const a of this.e.alertas) {
      if (a.cerradaEn) continue;
      const k = a.tipo === 'tope_alcanzado' ? `${a.tipo}|${a.ref}|${a.botId}` : `${a.tipo}|${a.ref}`;
      if (debe.has(k)) debe.delete(k);
      else if (a.tipo !== 'canal_desconectado' || this.e.wa.canales.find((x) => x.id === a.ref)?.estado !== 'desconectado') {
        a.cerradaEn = iso;
        cerradas++;
      }
    }
    for (const x of debe.values()) {
      this.e.alertas.push({ id: this.nuevoId('al'), ...x, abiertaEn: iso, cerradaEn: null });
      abiertas++;
    }
    return { abiertas, cerradas };
  }

  async muestra(campanaId: string, opciones: { pendientes?: boolean; limite?: number } = {}): Promise<FilaMuestra[]> {
    const filas: FilaMuestra[] = [];
    for (const c of this.e.conversaciones.filter((x) => x.campanaId === campanaId)) {
      const ms = this.e.mensajes.get(c.id) ?? [];
      for (const m of ms.filter((x) => x.muestra)) {
        const r = this.e.revisiones.get(`${c.id}|${m.n}`);
        if (opciones.pendientes && r) continue;
        const pregunta = [...ms].reverse().find((x) => x.n < m.n && x.autor === 'contacto');
        filas.push({
          conversacionId: c.id, botId: c.botId, n: m.n, pregunta: pregunta?.texto ?? null, respuesta: m.texto, secciones: m.decision?.secciones ?? [], fecha: m.creadoEn,
          veredicto: r?.veredicto ?? null, convertida: r?.convertida ?? false, revisadaPor: r?.por ?? null,
        });
      }
    }
    return filas.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, opciones.limite ?? 100);
  }

  async revisarRespuesta(conversacionId: string, n: number, veredicto: 'correcta' | 'incorrecta', convertida: boolean, por: string): Promise<void> {
    const c = this.convDelEquipo(conversacionId, por, 'editar_borrador');
    const m = (this.e.mensajes.get(c.id) ?? []).find((x) => x.n === n);
    if (!m?.muestra) throw new ErrorDatos('no_muestra', 'Ese mensaje no está en la muestra.');
    if (!['correcta', 'incorrecta'].includes(veredicto)) throw new ErrorDatos('datos', 'Veredicto inválido.');
    this.e.revisiones.set(`${c.id}|${n}`, { veredicto, convertida, por, fecha: new Date().toISOString() });
  }

  async buscarContactos(campanaId: string, texto: string, por: string): Promise<FilaContacto[]> {
    this.exigir(campanaId, por, 'gestionar_datos_contactos');
    const q = texto.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.e.contactos
      .filter((ct) => ct.campanaId === campanaId && !ct.borradoEn)
      .filter((ct) => ct.id === texto.trim() || [ct.nombre ?? '', ct.nombrePerfil ?? '', ct.telefono ?? '', ...Object.values(ct.datos)].some((x) => x.toLowerCase().includes(q))
        || this.e.conversaciones.some((c) => c.contactoId === ct.id && (this.e.mensajes.get(c.id) ?? []).some((m) => m.autor === 'contacto' && m.texto?.toLowerCase().includes(q))))
      .slice(0, 50)
      .map((ct) => {
        const cs = this.e.conversaciones.filter((c) => c.contactoId === ct.id);
        return { contacto: structuredClone(ct), conversaciones: cs.length, ultima: cs.map((c) => c.actualizadaEn).sort().at(-1) ?? null };
      });
  }

  private pedido(ct: Contacto, tipo: PedidoDatos['tipo'], nota: string, por: string) {
    this.e.pedidos.push({ id: this.nuevoId('pd'), campanaId: ct.campanaId, contactoId: ct.id, tipo, nota: nota.slice(0, 500), hechoPor: por, hechoEn: new Date().toISOString() });
  }

  async exportarContacto(contactoId: string, por: string): Promise<ExportacionContacto> {
    const ct = this.e.contactos.find((x) => x.id === contactoId);
    if (!ct) throw new ErrorDatos('no_existe', 'No existe el contacto.');
    this.exigir(ct.campanaId, por, 'gestionar_datos_contactos');
    this.pedido(ct, 'exportar', '', por);
    return {
      contacto: structuredClone(ct),
      conversaciones: this.e.conversaciones.filter((c) => c.contactoId === ct.id).map(({ sesion: _, ...c }) => ({ conversacion: structuredClone(c), mensajes: structuredClone(this.e.mensajes.get(c.id) ?? []) })),
      exportadoEn: new Date().toISOString(),
    };
  }

  async borrarContacto(contactoId: string, nota: string, por: string): Promise<void> {
    const ct = this.e.contactos.find((x) => x.id === contactoId);
    if (!ct) throw new ErrorDatos('no_existe', 'No existe el contacto.');
    this.exigir(ct.campanaId, por, 'gestionar_datos_contactos');
    const ahora = new Date().toISOString();
    ct.nombre = null;
    ct.datos = {};
    ct.telefono = null;
    ct.nombrePerfil = null;
    ct.borradoEn = ahora;
    for (const c of this.e.conversaciones.filter((x) => x.contactoId === ct.id)) {
      for (const m of this.e.mensajes.get(c.id) ?? []) {
        m.texto = null;
        m.datos = null;
      }
      c.sesion = { ...c.sesion, variables: {}, turnos: [] };
      if (c.estado !== 'cerrada') c.estado = 'cerrada';
    }
    this.pedido(ct, 'borrar', nota, por);
  }

  async pedidosDatos(campanaId: string): Promise<PedidoDatos[]> {
    return this.e.pedidos.filter((p) => p.campanaId === campanaId).reverse().sort((a, b) => b.hechoEn.localeCompare(a.hechoEn)).map((p) => ({ ...p }));
  }

  // ── Base de contactos (7.06) ──────────────────────────────────────────────────────────────────

  /** Una fila de la base: el número solo para quien atiende (como json_contacto en la base). */
  private filaBase(ct: Contacto, verNumero: boolean): FilaBaseContacto {
    const cs = this.e.conversaciones.filter((c) => c.contactoId === ct.id);
    const ids = new Set(cs.map((c) => c.id));
    // De un contacto borrado a pedido no se muestra lo que consultó (los eventos quedan, sin nada que los una a la persona).
    const consultas = ct.borradoEn ? [] : consultasDeEventos(this.e.analitica.filter((a) => ids.has(a.conversacionId)).map((a) => ({ nombre: a.nombre, cajaId: a.cajaId, datos: a.datos, fecha: a.fecha })));
    const contacto = structuredClone(ct);
    if (!verNumero) contacto.telefono = null;
    return {
      contacto, conversaciones: cs.length, consultas,
      primera: cs.map((c) => c.iniciadaEn).sort().at(0) ?? null,
      ultima: cs.map((c) => c.actualizadaEn).sort().at(-1) ?? null,
    };
  }

  private filtrarBase(campanaId: string, f: Omit<FiltroContactos, 'limite' | 'desde'>, verNumero: boolean): FilaBaseContacto[] {
    const q = (f.buscar ?? '').trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    const consulta = f.consulta ? claveConsulta(f.consulta) : null;
    return this.e.contactos
      .filter((ct) => ct.campanaId === campanaId && !ct.borradoEn && (!f.botId || ct.botId === f.botId) && (!f.canal || ct.canal === f.canal))
      .filter((ct) => !q || [ct.nombre ?? '', ct.nombrePerfil ?? '', ...Object.values(ct.datos)].some((x) => x.toLowerCase().includes(q))
        || (verNumero && digitos.length >= 4 && (ct.telefono ?? '').includes(digitos)))
      .map((ct) => this.filaBase(ct, verNumero))
      .filter((x) => !consulta || x.consultas.some((c) => claveConsulta(c) === consulta))
      .sort((a, b) => (b.ultima ?? '').localeCompare(a.ultima ?? '') || a.contacto.id.localeCompare(b.contacto.id));
  }

  async baseContactos(campanaId: string, filtro: FiltroContactos, por: string): Promise<PaginaContactos> {
    this.exigir(campanaId, por, 'leer_conversaciones');
    const todas = this.filtrarBase(campanaId, filtro, puede(this.rol(campanaId, por), 'responder_conversaciones'));
    const desde = Math.max(0, Math.floor(filtro.desde ?? 0));
    const limite = Math.min(200, Math.max(1, Math.floor(filtro.limite ?? 50)));
    return { total: todas.length, filas: todas.slice(desde, desde + limite) };
  }

  async fichaContacto(contactoId: string, por: string): Promise<FichaContacto | null> {
    const ct = this.e.contactos.find((x) => x.id === contactoId);
    if (!ct || !puede(this.rol(ct.campanaId, por), 'leer_conversaciones')) return null;
    const fila = this.filaBase(ct, puede(this.rol(ct.campanaId, por), 'responder_conversaciones'));
    const lista = this.e.conversaciones.filter((c) => c.contactoId === ct.id).sort((a, b) => b.iniciadaEn.localeCompare(a.iniciadaEn))
      .map((c) => ({ id: c.id, estado: c.estado, canal: c.canal, iniciadaEn: c.iniciadaEn, actualizadaEn: c.actualizadaEn, mensajes: c.seq, asignadaA: c.asignadaA }));
    return { ...fila, lista };
  }

  async exportarBaseContactos(campanaId: string, filtro: Omit<FiltroContactos, 'limite' | 'desde'>, por: string): Promise<FilaBaseContacto[]> {
    this.exigir(campanaId, por, 'gestionar_datos_contactos');
    const filas = this.filtrarBase(campanaId, filtro, true);
    this.e.exportaciones.push({
      id: this.nuevoId('ex'), campanaId, botId: filtro.botId ?? null, canal: filtro.canal ?? null, consulta: filtro.consulta ? claveConsulta(filtro.consulta) : null,
      conBusqueda: !!filtro.buscar?.trim(), cantidad: filas.length, hechoPor: por, hechoEn: new Date().toISOString(),
    });
    return filas;
  }

  async exportacionesBase(campanaId: string, por: string): Promise<ExportacionBase[]> {
    this.exigir(campanaId, por, 'gestionar_datos_contactos');
    return this.e.exportaciones.filter((x) => x.campanaId === campanaId).slice().reverse().map((x) => ({ ...x }));
  }

  async borrarVencidos(ahora: Date): Promise<number> {
    let n = 0;
    for (const c of this.e.conversaciones) {
      const b = this.e.bots.find((x) => x.id === c.botId);
      if (!b) continue;
      const limite = ahora.getTime() - b.diasGuardado * 864e5;
      for (const m of this.e.mensajes.get(c.id) ?? []) {
        if (m.texto !== null && new Date(m.creadoEn).getTime() < limite) {
          m.texto = null;
          m.datos = null;
          n++;
        }
      }
      if (new Date(c.actualizadaEn).getTime() < limite) c.sesion = { ...c.sesion, variables: {}, turnos: [] };
    }
    // Los datos del contacto (nombre, número, lo que dio) no vencen: son la base de contactos de la campaña y se borran a
    // pedido (decisión del 29/9). Lo que se vacía es el texto de los mensajes y lo que salió por WhatsApp.
    for (const x of this.e.wa.envios) {
      const c = this.e.conversaciones.find((y) => y.id === x.conversacionId);
      const b = c ? this.e.bots.find((y) => y.id === c.botId) : undefined;
      if (b && new Date(x.creadoEn).getTime() < ahora.getTime() - b.diasGuardado * 864e5) x.mensaje = { type: 'text', text: { body: '' } };
    }
    const limpieza = ahora.getTime() - 8 * 864e5;
    for (const [k, x] of this.e.wa.entradas) if (new Date(x.recibidaEn).getTime() < limpieza) this.e.wa.entradas.delete(k);
    return n;
  }

  // ── WhatsApp: lo que ve y hace el equipo (etapa 7) ────────────────────────────────────────────

  private statsDe(canalId: string, dia: string): StatsDia {
    const k = `${canalId}|${dia}`;
    let x = this.e.wa.stats.get(k);
    if (!x) {
      x = statsVacias();
      this.e.wa.stats.set(k, x);
    }
    return x;
  }

  private salud(canalId: string, ahora: Date): SaludCanal {
    const dias = 7;
    const desde = new Date(ahora.getTime() - (dias - 1) * 864e5).toISOString().slice(0, 10);
    const t = statsVacias();
    for (const [k, v] of this.e.wa.stats) {
      const [c, dia] = k.split('|');
      if (c !== canalId || dia! < desde) continue;
      for (const clave of Object.keys(t) as (keyof StatsDia)[]) t[clave] = clave === 'demoraMaxMs' ? Math.max(t[clave], v[clave]) : t[clave] + v[clave];
    }
    return {
      dias, recibidos: t.recibidos, repetidos: t.repetidos, enviados: t.enviados, entregados: t.entregados, leidos: t.leidos, fallidos: t.fallidos,
      demoraMaxMs: t.demoraMaxMs, demoraMediaMs: t.avisos ? Math.round(t.demoraTotalMs / t.avisos) : null,
      pendientes: this.e.wa.envios.filter((x) => x.canalId === canalId && (x.estado === 'pendiente' || x.estado === 'enviando')).length,
    };
  }

  async canalWhatsapp(botId: string): Promise<CanalWhatsapp | null> {
    const c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) return null;
    const ahora = new Date();
    const mes = ahora.toISOString().slice(0, 7);
    return {
      id: c.id, botId: c.botId, estado: c.estado, numero: c.numero, webhookUrl: c.webhookUrl, conectadoEn: c.conectadoEn, ultimoRecibido: c.ultimoRecibido,
      ultimoError: c.ultimoError, ultimoErrorEn: c.ultimoErrorEn, salud: this.salud(c.id, ahora),
      respuestasMes: this.e.wa.envios.filter((x) => x.canalId === c.id && x.idProveedor && x.creadoEn.startsWith(mes) && x.mensaje.type !== 'template').length,
    };
  }

  async conectarWhatsapp(botId: string, d: ConexionWhatsapp, por: string): Promise<string> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    if (b.estado === 'archivado') throw new ErrorDatos('archivado', 'El bot está archivado.');
    if (!/^[0-9a-f]{64}$/.test(d.secretoHash) || !d.clave.trim() || !d.webhookUrl) throw new ErrorDatos('datos', 'Faltan datos para conectar el canal.');
    const ahora = new Date().toISOString();
    let c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) {
      c = {
        id: this.nuevoId('wa'), botId, campanaId: b.campanaId, estado: 'activo', numero: null, webhookUrl: null, conectadoEn: null, secretoHash: null,
        claveRef: null, ultimoRecibido: null, ultimoError: null, ultimoErrorEn: null, plantillasRevisadasEn: null,
      };
      this.e.wa.canales.push(c);
    }
    c.claveRef ??= this.nuevoId('vault');
    this.e.wa.vault.set(c.claveRef, d.clave.trim());
    Object.assign(c, { estado: 'activo', numero: d.numero, webhookUrl: d.webhookUrl, conectadoEn: ahora, secretoHash: d.secretoHash, ultimoError: null, ultimoErrorEn: null, plantillasRevisadasEn: null });
    for (const a of this.e.alertas) if (a.tipo === 'canal_desconectado' && a.ref === c.id && !a.cerradaEn) a.cerradaEn = ahora;
    return c.id;
  }

  async prenderWhatsapp(botId: string, activo: boolean, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    const c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) throw new ErrorDatos('sin_canal', 'El bot no tiene WhatsApp conectado.');
    if (activo && c.estado === 'desconectado') throw new ErrorDatos('canal_desconectado', 'El canal está desconectado: hay que volver a conectarlo con una clave que funcione.');
    c.estado = activo ? 'activo' : 'apagado';
  }

  async responderConPlantilla(conversacionId: string, p: PlantillaEnviada, por: string): Promise<number> {
    const c = this.convDelEquipo(conversacionId, por);
    const canalWa = this.canalWaDeConversacion(c);
    if (!canalWa) throw new ErrorDatos('canal_no_whatsapp', 'Las plantillas son solo para conversaciones de WhatsApp.');
    if (c.estado === 'cerrada') throw new ErrorDatos('conversacion_cerrada', 'La conversación está cerrada.');
    const pl = this.e.wa.plantillas.find((x) => x.canalId === canalWa.id && x.nombre === p.nombre && x.idioma === p.idioma);
    if (!pl?.usable) throw new ErrorDatos('plantilla_no_usable', 'Esa plantilla no está aprobada o no se puede mandar desde la bandeja.');
    const texto = p.texto.trim();
    if (!texto || texto.length > 4096 || pl.variables.some((v) => !(p.valores[v] ?? '').trim())) throw new ErrorDatos('datos', 'Completá todos los espacios de la plantilla.');
    const ahora = new Date().toISOString();
    if (c.estado === 'bot') {
      c.derivadaEn = ahora;
      c.motivoDerivacion = 'La retomó el equipo con una plantilla';
      c.sesion = { ...c.sesion, estado: 'derivada', espera: null };
    }
    c.estado = 'en_atencion';
    c.asignadaA ??= por;
    const m = this.agregarMensaje(c, { autor: 'agente', personaId: por, tipo: 'texto', texto, datos: { plantilla: pl.nombre } as Mensaje['datos'], cajaId: null, decision: null, versionId: null, idCanal: null, muestra: false, creadoEn: ahora });
    this.encolar(canalWa.id, c, m, [mensajePlantilla(pl, p.valores)], ahora);
    c.ultimoDelEquipo = ahora;
    return m.n;
  }

  async plantillas(botId: string): Promise<PlantillaGuardada[]> {
    const c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) return [];
    return this.e.wa.plantillas.filter((x) => x.canalId === c.id).sort((a, b) => Number(b.usable) - Number(a.usable) || a.nombre.localeCompare(b.nombre)).map((x) => structuredClone(x));
  }

  async guardarPlantillaCreada(botId: string, p: Plantilla, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    const c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) throw new ErrorDatos('sin_canal', 'El bot no tiene WhatsApp conectado.');
    const ahora = new Date().toISOString();
    this.e.wa.plantillas = this.e.wa.plantillas.filter((x) => !(x.canalId === c.id && x.nombre === p.nombre && x.idioma === p.idioma));
    this.e.wa.plantillas.push({ ...structuredClone(p), canalId: c.id, creadaPor: por, creadaEn: ahora, revisadaEn: ahora });
  }

  async quitarPlantilla(botId: string, nombre: string, por: string): Promise<void> {
    const b = this.botEditable(botId);
    this.exigir(b.campanaId, por, 'configurar_canales');
    const c = this.e.wa.canales.find((x) => x.botId === botId);
    if (!c) return;
    this.e.wa.plantillas = this.e.wa.plantillas.filter((x) => !(x.canalId === c.id && x.nombre === nombre));
  }

  // ── WhatsApp sin persona: el aviso, la cola y el envío ────────────────────────────────────────

  private publicoDe(c: CanalDemo): CanalWhatsappPublico {
    const b = this.e.bots.find((x) => x.id === c.botId)!;
    return { id: c.id, botId: c.botId, idPublico: b.idPublico, estado: c.estado, secretoHash: c.secretoHash };
  }

  async canalWhatsappPublico(idPublico: string): Promise<CanalWhatsappPublico | null> {
    const b = this.e.bots.find((x) => x.idPublico === idPublico);
    const c = b ? this.e.wa.canales.find((x) => x.botId === b.id) : undefined;
    return c ? this.publicoDe(c) : null;
  }

  async canalWhatsappPorId(canalId: string): Promise<CanalWhatsappPublico | null> {
    const c = this.e.wa.canales.find((x) => x.id === canalId);
    return c ? this.publicoDe(c) : null;
  }

  async recibirEntradas(canalId: string, entradas: readonly EntradaWebhook[], p: { ahora: Date; demoraMs: number; numero: string | null }): Promise<{ nuevas: number; repetidas: number }> {
    const c = this.e.wa.canales.find((x) => x.id === canalId);
    if (!c) throw new ErrorDatos('no_existe', 'No existe el canal.');
    const iso = p.ahora.toISOString();
    const st = this.statsDe(canalId, iso.slice(0, 10));
    let nuevas = 0;
    let repetidas = 0;
    for (const e of entradas) {
      const k = `${canalId}|${e.clave}`;
      if (this.e.wa.entradas.has(k)) {
        repetidas++;
        continue;
      }
      this.e.wa.entradas.set(k, { canalId, clave: e.clave, entrada: structuredClone(e), recibidaEn: iso, procesadaEn: null, tomadaEn: null, intentos: 0 });
      nuevas++;
      if (e.tipo === 'mensaje') {
        st.recibidos++;
        c.ultimoRecibido = iso;
      }
    }
    st.repetidos += repetidas;
    st.avisos++;
    st.demoraTotalMs += p.demoraMs;
    st.demoraMaxMs = Math.max(st.demoraMaxMs, p.demoraMs);
    if (!c.numero && p.numero) c.numero = p.numero;
    return { nuevas, repetidas };
  }

  async entradasPendientes(canalId: string, limite: number, ahora: Date): Promise<EntradaWebhook[]> {
    const vencida = ahora.getTime() - 2 * 60_000;
    const lista = [...this.e.wa.entradas.values()]
      .filter((x) => x.canalId === canalId && !x.procesadaEn && x.entrada && x.intentos < 5 && (!x.tomadaEn || new Date(x.tomadaEn).getTime() < vencida))
      .sort((a, b) => a.recibidaEn.localeCompare(b.recibidaEn) || a.entrada!.hora.localeCompare(b.entrada!.hora))
      .slice(0, limite);
    for (const x of lista) {
      x.tomadaEn = ahora.toISOString();
      x.intentos++;
    }
    return lista.map((x) => structuredClone(x.entrada!));
  }

  async entradaProcesada(canalId: string, clave: string): Promise<void> {
    const x = this.e.wa.entradas.get(`${canalId}|${clave}`);
    if (!x) return;
    x.procesadaEn = new Date().toISOString();
    // Queda la clave (para descartar reintentos); lo de la persona se borra.
    x.entrada = null;
  }

  async guardarTelefono(contactoId: string, telefono: string, nombrePerfil: string | null): Promise<void> {
    const ct = this.e.contactos.find((x) => x.id === contactoId);
    if (!ct) throw new ErrorDatos('no_existe', 'No existe el contacto.');
    if (!/^\d{7,15}$/.test(telefono)) throw new ErrorDatos('datos', 'Número inválido.');
    ct.telefono = telefono;
    ct.nombrePerfil = nombrePerfil?.trim().slice(0, 120) || null;
  }

  async tomarEnvios(f: { canalId?: string; conversacionId?: string }, ahora: Date, limite: number): Promise<EnvioPendiente[]> {
    const iso = ahora.toISOString();
    const vencido = new Date(ahora.getTime() - 2 * 60_000).toISOString();
    const lista = this.e.wa.envios
      .filter((x) => (!f.canalId || x.canalId === f.canalId) && (!f.conversacionId || x.conversacionId === f.conversacionId))
      .filter((x) => (x.estado === 'pendiente' && x.proximo <= iso) || (x.estado === 'enviando' && x.proximo < vencido))
      .sort((a, b) => a.conversacionId.localeCompare(b.conversacionId) || a.n - b.n || a.parte - b.parte)
      .slice(0, limite);
    return lista.map((x) => {
      x.estado = 'enviando';
      x.intentos++;
      x.proximo = iso;
      const conv = this.e.conversaciones.find((c) => c.id === x.conversacionId);
      const ct = conv ? this.e.contactos.find((y) => y.id === conv.contactoId) : undefined;
      return { id: x.id, canalId: x.canalId, conversacionId: x.conversacionId, n: x.n, parte: x.parte, direccion: ct?.telefono ?? null, mensaje: structuredClone(x.mensaje), intentos: x.intentos };
    });
  }

  async resultadoEnvio(envioId: string, r: ResultadoEnvio, ahora: Date): Promise<void> {
    const x = this.e.wa.envios.find((y) => y.id === envioId);
    if (!x) return;
    const st = this.statsDe(x.canalId, ahora.toISOString().slice(0, 10));
    if (r.tipo === 'enviado') {
      x.estado = 'enviado';
      x.idProveedor = r.idProveedor;
      x.error = null;
      st.enviados++;
    } else if (r.tipo === 'reintentar') {
      x.estado = 'pendiente';
      x.proximo = r.en;
      x.error = r.error;
    } else {
      x.estado = 'fallido';
      x.error = r.error;
      st.fallidos++;
    }
  }

  async aplicarEstado(canalId: string, idProveedor: string, estado: EstadoEnvio, error: string | null, ahora: Date): Promise<void> {
    const x = this.e.wa.envios.find((y) => y.canalId === canalId && y.idProveedor === idProveedor);
    if (!x || x.estado === 'pendiente' || x.estado === 'enviando') return;
    const nuevo = estadoSiguiente(x.estado, estado);
    if (nuevo === x.estado) return;
    x.estado = nuevo;
    if (estado === 'fallido') x.error = error ?? 'WhatsApp no lo pudo entregar.';
    const st = this.statsDe(canalId, ahora.toISOString().slice(0, 10));
    if (nuevo === 'entregado') st.entregados++;
    if (nuevo === 'leido') st.leidos++;
    if (nuevo === 'fallido') st.fallidos++;
    const conv = this.e.conversaciones.find((c) => c.id === x.conversacionId);
    const ct = conv ? this.e.contactos.find((y) => y.id === conv.contactoId) : undefined;
    if (conv && ct) this.anotar(conv, ct, [{ nombre: 'estado_mensaje', cajaId: null, datos: { estado: nuevo } }], ahora.toISOString());
  }

  async claveWhatsapp(canalId: string): Promise<string | null> {
    const c = this.e.wa.canales.find((x) => x.id === canalId);
    return c?.claveRef && c.estado !== 'desconectado' ? this.e.wa.vault.get(c.claveRef) ?? null : null;
  }

  async canalDesconectado(canalId: string, error: string, ahora: Date): Promise<void> {
    const c = this.e.wa.canales.find((x) => x.id === canalId);
    if (!c) return;
    const iso = ahora.toISOString();
    c.estado = 'desconectado';
    c.ultimoError = error.slice(0, 300);
    c.ultimoErrorEn = iso;
    if (!this.e.alertas.some((a) => a.tipo === 'canal_desconectado' && a.ref === c.id && !a.cerradaEn)) {
      this.e.alertas.push({ id: this.nuevoId('al'), tipo: 'canal_desconectado', botId: c.botId, campanaId: c.campanaId, ref: c.id, abiertaEn: iso, cerradaEn: null });
    }
  }

  async canalesConPendientes(ahora: Date): Promise<string[]> {
    const iso = ahora.toISOString();
    const vencida = new Date(ahora.getTime() - 2 * 60_000).toISOString();
    const ids = new Set<string>();
    for (const x of this.e.wa.entradas.values()) if (!x.procesadaEn && x.entrada && x.intentos < 5 && (!x.tomadaEn || x.tomadaEn < vencida)) ids.add(x.canalId);
    for (const x of this.e.wa.envios) if ((x.estado === 'pendiente' && x.proximo <= iso) || (x.estado === 'enviando' && x.proximo < vencida)) ids.add(x.canalId);
    return [...ids];
  }

  async canalesParaRevisarPlantillas(ahora: Date): Promise<string[]> {
    const hace = new Date(ahora.getTime() - 30 * 60_000).toISOString();
    return this.e.wa.canales
      .filter((c) => c.estado === 'activo')
      .filter((c) => !c.plantillasRevisadasEn || c.plantillasRevisadasEn < hace || this.e.wa.plantillas.some((p) => p.canalId === c.id && p.estado === 'en_revision'))
      .map((c) => c.id);
  }

  async sincronizarPlantillas(canalId: string, plantillas: readonly Plantilla[], ahora: Date): Promise<void> {
    const c = this.e.wa.canales.find((x) => x.id === canalId);
    if (!c) return;
    const iso = ahora.toISOString();
    const antes = this.e.wa.plantillas.filter((x) => x.canalId === canalId);
    this.e.wa.plantillas = [
      ...this.e.wa.plantillas.filter((x) => x.canalId !== canalId),
      ...plantillas.map((p) => {
        const previa = antes.find((x) => x.nombre === p.nombre && x.idioma === p.idioma);
        return { ...structuredClone(p), canalId, creadaPor: previa?.creadaPor ?? null, creadaEn: previa?.creadaEn ?? iso, revisadaEn: iso };
      }),
    ];
    c.plantillasRevisadasEn = iso;
  }

  /** Solo la demo: los bots con WhatsApp conectado (para el teléfono de prueba). */
  canalesWhatsappDemo(): { idPublico: string; nombre: string; numero: string | null; estado: EstadoCanal }[] {
    return this.e.wa.canales.flatMap((c) => {
      const b = this.e.bots.find((x) => x.id === c.botId);
      return b ? [{ idPublico: b.idPublico, nombre: b.nombre, numero: c.numero, estado: c.estado }] : [];
    });
  }

  /** Solo la demo: simula que pasaron 24 horas desde el último mensaje de la persona (para probar las plantillas). */
  cerrarVentana(conversacionId: string): void {
    const c = this.e.conversaciones.find((x) => x.id === conversacionId);
    if (c) c.ventanaHasta = new Date(Date.now() - 60_000).toISOString();
  }

  /** Solo para pruebas: los eventos de analítica que se guardaron. */
  analiticaGuardada() {
    return structuredClone(this.e.analitica);
  }

  private agregarVersion(b: Bot, definicion: unknown, basadaEn: string | null, por: string): VersionDemo {
    const ahora = new Date().toISOString();
    const numero = Math.max(0, ...this.e.versiones.filter((x) => x.botId === b.id).map((x) => x.numero)) + 1;
    const v: VersionDemo = {
      id: `ver-${this.e.siguienteVersion++}`, botId: b.id, campanaId: b.campanaId, numero, estado: 'borrador', basadaEn, seq: 0,
      creadaPor: por, creadaEn: ahora, actualizadaEn: ahora, definicion: structuredClone(definicion),
    };
    this.e.versiones.push(v);
    return v;
  }

  private nuevoIdPublico(): string {
    for (;;) {
      let x = '';
      for (let i = 0; i < 10; i++) x += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
      if (!this.e.bots.some((b) => b.idPublico === x)) return x;
    }
  }
}
