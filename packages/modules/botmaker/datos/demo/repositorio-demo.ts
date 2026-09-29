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
import { exigir, type Accion } from '../../dominio/permisos';
import type {
  Bot, CambiosBot, EleccionMotores, FuncionMotor, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolEfectivo, RolModulo, Topes, UsoMotor,
} from '../../dominio/tipos';
import { PRODUCTO } from '../../dominio/tipos';
import { ErrorDatos } from '../errores';
import type { FiltroLlamadas, Repositorio } from '../repositorio';
import { semillaDemo } from './semilla';

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
}

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

export class RepositorioDemo implements Repositorio {
  private e: EstadoDemo;

  constructor(opciones: { ahora?: Date; vacio?: boolean } = {}) {
    const s = opciones.vacio ? { bots: [], motores: new Map(), llamadas: [], versiones: [] } : semillaDemo(opciones.ahora ?? new Date());
    this.e = {
      bots: s.bots,
      motores: s.motores,
      llamadas: s.llamadas,
      versiones: s.versiones,
      cambios: new Map(),
      corridas: [],
      eventos: [],
      claves: new Map(),
      siguienteBot: s.bots.length + 1,
      siguienteLlamada: s.llamadas.length + 1,
      siguienteVersion: s.versiones.length + 1,
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
