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
import { FICHAS_MOTORES, MOTORES_POR_DEFECTO, fichaMotor, type FichaMotor } from '../../dominio/motores';
import { exigir, type Accion } from '../../dominio/permisos';
import type {
  Bot, CambiosBot, EleccionMotores, FuncionMotor, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolEfectivo, RolModulo, Topes, UsoMotor,
} from '../../dominio/tipos';
import { PRODUCTO } from '../../dominio/tipos';
import { ErrorDatos } from '../errores';
import type { FiltroLlamadas, Repositorio } from '../repositorio';
import { semillaDemo } from './semilla';

interface EstadoDemo {
  bots: Bot[];
  motores: Map<string, MotorFuncion[]>;
  llamadas: LlamadaMotor[];
  claves: Map<string, string>;
  siguienteBot: number;
  siguienteLlamada: number;
}

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

export class RepositorioDemo implements Repositorio {
  private e: EstadoDemo;

  constructor(opciones: { ahora?: Date; vacio?: boolean } = {}) {
    const s = opciones.vacio ? { bots: [], motores: new Map(), llamadas: [] } : semillaDemo(opciones.ahora ?? new Date());
    this.e = {
      bots: s.bots,
      motores: s.motores,
      llamadas: s.llamadas,
      claves: new Map(),
      siguienteBot: s.bots.length + 1,
      siguienteLlamada: s.llamadas.length + 1,
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

  async crearBot(campanaId: string, datos: NuevoBot, clave: string, por: string): Promise<string> {
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
      m.principal = eleccion.principal;
      m.respaldo = eleccion.respaldo;
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

  private nuevoIdPublico(): string {
    for (;;) {
      let x = '';
      for (let i = 0; i < 10; i++) x += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
      if (!this.e.bots.some((b) => b.idPublico === x)) return x;
    }
  }
}
