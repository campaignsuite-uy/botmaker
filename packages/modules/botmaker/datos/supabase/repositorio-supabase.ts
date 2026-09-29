/**
 * Repositorio de BotMaker sobre Supabase (esquema `bots`, packages/db/migraciones/bots_*.sql). SOLO SERVIDOR.
 *
 * Dos clientes:
 *  - Persona (clave pública + el token de Supabase Auth del pedido en curso): todo lo que lee y cambia la persona pasa
 *    por las reglas por fila y por las funciones bots.*, que vuelven a exigir cada acción de la matriz.
 *  - Servicio (clave de servicio, saltea las reglas por fila): solo para registrar las llamadas a motores y leer el
 *    gasto de un bot para los topes (la capa de motores lo necesita aunque la persona no vea costos).
 *
 * Requiere que `bots` esté en Project Settings → Data API → Exposed schemas del proyecto de Supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Definicion } from '../../dominio/definicion';
import type { FichaMotor } from '../../dominio/motores';
import type { Borrador, Cambio, CambioResumen, EventoPublicacion, NuevoCambio, Version, VersionCompleta } from '../../dominio/versiones';
import type { Corrida, ResultadoCaso, ResumenCorrida } from '../../dominio/corridas';
import type {
  Bot, CambiosBot, EleccionMotores, FuncionMotor, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolModulo, Topes, UsoMotor,
} from '../../dominio/tipos';
import type { Alerta, Condiciones, PedidoDatos } from '../../dominio/conversaciones';
import { ErrorDatos, errorDeBase } from '../errores';
import type {
  CanalWeb, CanalWhatsapp, ConexionWhatsapp, ConversacionCompleta, ExportacionBase, ExportacionContacto, FichaContacto, FilaBaseContacto, FilaContacto,
  FilaConversacion, FilaMuestra, FiltroContactos, FiltroConversaciones, FiltroLlamadas, PaginaContactos, PlantillaEnviada, PlantillaGuardada, Repositorio,
  TurnoDevuelto,
} from '../repositorio';
import type { Plantilla } from '../../dominio/whatsapp';
import * as M from './mapeo';

export interface ClientesSupabase {
  servicio: SupabaseClient;
  persona: () => Promise<SupabaseClient | null>;
}

type Resultado<T> = { data: T; error: { message: string; code?: string } | null };

function datos<T>(r: Resultado<T>, que: string): T {
  if (r.error) throw errorDeBase(r.error, que);
  return r.data;
}

export class RepositorioSupabase implements Repositorio {
  constructor(private readonly c: ClientesSupabase) {}

  static desdeEntorno(tokenDeSesion: () => Promise<string | null>): RepositorioSupabase {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const clavePublica = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const faltan = [!url && 'SUPABASE_URL', !claveServicio && 'SUPABASE_SERVICE_ROLE_KEY', !clavePublica && 'SUPABASE_ANON_KEY'].filter(Boolean);
    if (faltan.length) throw new Error(`CAMPAIGNSUITE_DATOS=supabase necesita ${faltan.join(' y ')} (ver .env.ejemplo).`);
    const sinSesion = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const servicio = createClient(url!, claveServicio!, sinSesion);
    const porToken = new Map<string, SupabaseClient>();
    const persona = async () => {
      const token = await tokenDeSesion();
      if (!token) return null;
      let cliente = porToken.get(token);
      if (!cliente) {
        cliente = createClient(url!, clavePublica!, { ...sinSesion, global: { headers: { Authorization: `Bearer ${token}` } } });
        if (porToken.size >= 200) porToken.delete(porToken.keys().next().value!);
        porToken.set(token, cliente);
      }
      return cliente;
    };
    return new RepositorioSupabase({ servicio, persona });
  }

  private async bots_(): Promise<ReturnType<SupabaseClient['schema']>> {
    const p = await this.c.persona();
    if (!p) throw new ErrorDatos('sesion', 'Tenés que ingresar de nuevo.');
    return p.schema('bots');
  }

  private get servicio() {
    return this.c.servicio.schema('bots');
  }

  // ── Lectura ───────────────────────────────────────────────────────────────────────────────────

  async campanaPreparada(campanaId: string): Promise<boolean> {
    const b = await this.bots_();
    const r = datos(await b.from('campaign_settings').select('id').eq('id', campanaId).maybeSingle(), 'leer BotMaker en la campaña');
    return !!r;
  }

  async bots(campanaId: string, opciones: { archivados?: boolean } = {}): Promise<Bot[]> {
    const b = await this.bots_();
    let q = b.from('bots').select(M.COLUMNAS_BOT).eq('campaign_id', campanaId);
    if (!opciones.archivados) q = q.neq('status', 'archivado');
    const filas = datos(await q.order('created_at', { ascending: false }), 'leer los bots') as M.FilaBot[];
    return filas.map(M.aBot);
  }

  async bot(botId: string): Promise<Bot | null> {
    const b = await this.bots_();
    const f = datos(await b.from('bots').select(M.COLUMNAS_BOT).eq('id', botId).maybeSingle(), 'leer el bot') as M.FilaBot | null;
    return f ? M.aBot(f) : null;
  }

  async topesBot(botId: string): Promise<Topes | null> {
    const f = datos(await this.servicio.from('bots').select('daily_cap_usd, monthly_cap_usd').eq('id', botId).maybeSingle(), 'leer los topes del bot') as { daily_cap_usd: number | string; monthly_cap_usd: number | string } | null;
    return f ? { diarioUsd: Number(f.daily_cap_usd), mensualUsd: Number(f.monthly_cap_usd) } : null;
  }

  async fichas(): Promise<FichaMotor[]> {
    const filas = datos(await this.servicio.from('engines').select('*').order('id'), 'leer los motores') as M.FilaMotor[];
    return filas.map(M.aFicha);
  }

  async motoresPorDefecto(): Promise<MotorFuncion[]> {
    const filas = datos(await this.servicio.from('engine_defaults').select(M.COLUMNAS_MOTOR_FUNCION), 'leer los motores por defecto') as M.FilaMotorFuncion[];
    return M.ordenarFunciones(filas.map(M.aMotorFuncion));
  }

  async motoresDeBot(botId: string): Promise<MotorFuncion[]> {
    // Con la clave de servicio: la capa de motores lo necesita también en la app pública (etapa 5), sin sesión.
    const filas = datos(await this.servicio.from('bot_engines').select(M.COLUMNAS_MOTOR_FUNCION).eq('bot_id', botId), 'leer los motores del bot') as M.FilaMotorFuncion[];
    return M.ordenarFunciones(filas.map(M.aMotorFuncion));
  }

  async gastoBot(botId: string, desdeDia: string, uso?: UsoMotor): Promise<number> {
    let q = this.servicio.from('spend_daily').select('cost_usd').eq('bot_id', botId).gte('day', desdeDia);
    if (uso) q = q.eq('use', uso);
    const filas = datos(await q, 'leer el gasto del bot') as { cost_usd: number | string }[];
    return filas.reduce((a, f) => a + Number(f.cost_usd), 0);
  }

  async gastoPorDia(campanaId: string, desdeDia: string): Promise<GastoDia[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('spend_daily').select('bot_id, day, use, cost_usd, calls').eq('campaign_id', campanaId).gte('day', desdeDia).order('day'), 'leer el gasto') as M.FilaGasto[];
    return filas.map(M.aGasto);
  }

  async llamadas(campanaId: string, filtro: FiltroLlamadas = {}): Promise<LlamadaMotor[]> {
    const b = await this.bots_();
    let q = b.from('engine_calls').select(M.COLUMNAS_LLAMADA).eq('campaign_id', campanaId);
    if (filtro.botId) q = q.eq('bot_id', filtro.botId);
    if (filtro.desde) q = q.gte('created_at', filtro.desde);
    const filas = datos(await q.order('created_at', { ascending: false }).limit(filtro.limite ?? 200), 'leer las llamadas') as M.FilaLlamada[];
    return filas.map(M.aLlamada);
  }

  // ── Escritura: siempre por las funciones de la base ───────────────────────────────────────────

  async crearBot(campanaId: string, d: NuevoBot, clave: string, _por: string, definicion?: Definicion): Promise<string> {
    const b = await this.bots_();
    const campos = { nombre: d.nombre, caso: d.caso, mercado: d.mercado, trato: d.trato, ...(definicion ? { definicion } : {}) };
    const id = datos(await b.rpc('crear_bot', { campana: campanaId, datos: campos, clave }), 'crear el bot');
    return String(id);
  }

  async guardarBot(botId: string, cambios: CambiosBot, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('guardar_bot', { bot: botId, datos: cambios }), 'guardar el bot');
  }

  async guardarMotores(botId: string, motores: EleccionMotores, topes: Topes | null, _por: string): Promise<void> {
    const b = await this.bots_();
    const m: Record<string, { principal: string; respaldo: string | null; dobleLectura?: boolean }> = {};
    for (const [f, e] of Object.entries(motores) as [FuncionMotor, { principal: string; respaldo: string | null; dobleLectura?: boolean } | undefined][]) {
      if (e) m[f] = { principal: e.principal, respaldo: e.respaldo, ...(e.dobleLectura !== undefined ? { dobleLectura: e.dobleLectura } : {}) };
    }
    datos(await b.rpc('guardar_motores', { bot: botId, motores: m, topes: topes ? { diario: topes.diarioUsd, mensual: topes.mensualUsd } : null }), 'guardar los motores');
  }

  async guardarDatosPersonales(botId: string, personalizacion: boolean, diasGuardado: number, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('guardar_datos_personales', { bot: botId, personalizacion, dias: diasGuardado }), 'guardar los datos personales');
  }

  async archivarBot(botId: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('archivar', { bot: botId }), 'archivar el bot');
  }

  async asignarRol(campanaId: string, personaId: string, rol: RolModulo | null, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('asignar_rol', { campana: campanaId, persona: personaId, rol: rol ?? '' }), 'cambiar el rol');
  }

  // ── Versiones y borrador ──────────────────────────────────────────────────────────────────────

  async versiones(botId: string): Promise<Version[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('versions').select(M.COLUMNAS_VERSION).eq('bot_id', botId).order('number', { ascending: false }), 'leer las versiones') as M.FilaVersion[];
    return filas.map(M.aVersion);
  }

  async borrador(botId: string): Promise<Borrador | null> {
    const b = await this.bots_();
    const f = datos(await b.from('versions').select(`${M.COLUMNAS_VERSION}, definition`).eq('bot_id', botId).eq('status', 'borrador').maybeSingle(), 'leer el borrador') as M.FilaVersion | null;
    return f ? { ...M.aVersion(f), definicion: f.definition } : null;
  }

  async crearBorrador(botId: string, definicion: Definicion | null, _por: string): Promise<string> {
    const b = await this.bots_();
    return String(datos(await b.rpc('crear_borrador', { bot: botId, definicion }), 'crear el borrador'));
  }

  async guardarCambio(versionId: string, seqEsperada: number, cambio: NuevoCambio, definicion: Definicion, _por: string): Promise<number> {
    const b = await this.bots_();
    const r = await b.rpc('guardar_cambio', {
      version: versionId, seq_esperada: seqEsperada, origen: cambio.origen, operaciones: cambio.operaciones, inversa: cambio.inversa,
      resumen: cambio.resumen, objetivo: cambio.objetivo, definicion,
    });
    return Number(datos(r, 'guardar el cambio'));
  }

  async cambios(versionId: string): Promise<CambioResumen[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('version_changes').select(M.COLUMNAS_CAMBIO).eq('version_id', versionId).order('seq'), 'leer los cambios') as M.FilaCambio[];
    return filas.map(M.aCambioResumen);
  }

  async cambio(versionId: string, seq: number): Promise<Cambio | null> {
    const b = await this.bots_();
    const f = datos(await b.from('version_changes').select(`${M.COLUMNAS_CAMBIO}, operations, inverse`).eq('version_id', versionId).eq('seq', seq).maybeSingle(), 'leer el cambio') as M.FilaCambio | null;
    return f ? M.aCambio(f) : null;
  }

  async version(versionId: string): Promise<VersionCompleta | null> {
    const b = await this.bots_();
    const f = datos(await b.from('versions').select(`${M.COLUMNAS_VERSION}, definition`).eq('id', versionId).maybeSingle(), 'leer la versión') as M.FilaVersion | null;
    return f ? { ...M.aVersion(f), definicion: f.definition } : null;
  }

  // ── Corridas ──────────────────────────────────────────────────────────────────────────────────

  async crearCorrida(versionId: string, motores: Record<string, unknown>, etiqueta: string, total: number, _por: string): Promise<string> {
    const b = await this.bots_();
    return String(datos(await b.rpc('crear_corrida', { version: versionId, motores, etiqueta, total }), 'empezar la corrida'));
  }

  async guardarResultados(corridaId: string, resultados: ResultadoCaso[], _por: string): Promise<number> {
    const b = await this.bots_();
    const filas = resultados.map((r) => ({ caso: r.caso, tipo: r.tipo, ok: r.ok, resultado: r.resultado, costo: r.costo }));
    return Number(datos(await b.rpc('guardar_resultados', { corrida: corridaId, resultados: filas }), 'guardar los resultados'));
  }

  async cerrarCorrida(corridaId: string, resumen: ResumenCorrida | null, estado: 'terminada' | 'cancelada', _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('cerrar_corrida', { corrida: corridaId, resumen, estado }), 'cerrar la corrida');
  }

  async corridas(botId: string): Promise<Corrida[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('test_runs').select(M.COLUMNAS_CORRIDA).eq('bot_id', botId).order('created_at', { ascending: false }).limit(100), 'leer las corridas') as M.FilaCorrida[];
    return filas.map(M.aCorrida);
  }

  async corrida(corridaId: string): Promise<(Corrida & { resultados: ResultadoCaso[] }) | null> {
    const b = await this.bots_();
    const f = datos(await b.from('test_runs').select(M.COLUMNAS_CORRIDA).eq('id', corridaId).maybeSingle(), 'leer la corrida') as M.FilaCorrida | null;
    if (!f) return null;
    const rs = datos(await b.from('test_results').select('case_id, kind, ok, result, cost_usd').eq('run_id', corridaId).order('case_id'), 'leer los resultados') as M.FilaResultado[];
    return { ...M.aCorrida(f), resultados: rs.map(M.aResultado) };
  }

  // ── Publicación ───────────────────────────────────────────────────────────────────────────────

  async pedirPublicacion(versionId: string, seqEsperada: number, nota: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('pedir_publicacion', { version: versionId, seq_esperada: seqEsperada, nota }), 'pedir publicar');
  }

  async aprobarPublicacion(versionId: string, nota: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('aprobar_publicacion', { version: versionId, nota }), 'aprobar la publicación');
  }

  async devolverPublicacion(versionId: string, nota: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('devolver_publicacion', { version: versionId, nota }), 'devolver el pedido');
  }

  async eventosPublicacion(botId: string): Promise<EventoPublicacion[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('publication_events').select('id, bot_id, version_id, action, note, run_id, profile_id, created_at').eq('bot_id', botId).order('id', { ascending: false }), 'leer la publicación') as M.FilaEventoPublicacion[];
    return filas.map(M.aEventoPublicacion);
  }

  async registrarLlamada(l: NuevaLlamada): Promise<void> {
    datos(await this.servicio.from('engine_calls').insert(M.haciaLlamada(l)), 'registrar la llamada');
  }

  // ── Pausa, canal web y condiciones (bots_0006) ────────────────────────────────────────────────

  async pausarBot(botId: string, pausar: boolean, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('pausar', { bot: botId, pausar }), pausar ? 'pausar el bot' : 'reanudar el bot');
  }

  async canalWeb(botId: string): Promise<CanalWeb> {
    const b = await this.bots_();
    return datos(await b.rpc('canal_web', { bot: botId }), 'leer el canal web') as CanalWeb;
  }

  async guardarCanalWeb(botId: string, canal: CanalWeb, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('guardar_canal_web', { bot: botId, activo: canal.activo, modo_condiciones: canal.modoCondiciones }), 'guardar el canal web');
  }

  async condiciones(botId: string): Promise<Condiciones[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('terms').select('bot_id, number, body, published_by, published_at').eq('bot_id', botId).order('number', { ascending: false }), 'leer las condiciones') as
      { bot_id: string; number: number; body: string; published_by: string | null; published_at: string }[];
    return filas.map((f) => ({ botId: f.bot_id, numero: f.number, texto: f.body, publicadasPor: f.published_by, publicadasEn: f.published_at }));
  }

  async publicarCondiciones(botId: string, texto: string, _por: string): Promise<number> {
    const b = await this.bots_();
    return Number(datos(await b.rpc('publicar_condiciones', { bot: botId, texto }), 'publicar las condiciones'));
  }

  // ── Bandeja (bots_0007) ───────────────────────────────────────────────────────────────────────

  async conversaciones(campanaId: string, filtro: FiltroConversaciones = {}): Promise<FilaConversacion[]> {
    const b = await this.bots_();
    const f = {
      ...(filtro.botId ? { bot: filtro.botId } : {}), ...(filtro.estado ? { estado: filtro.estado } : {}), ...(filtro.canal ? { canal: filtro.canal } : {}),
      ...(filtro.buscar ? { buscar: filtro.buscar } : {}), ...(filtro.asignadaA ? { asignada: filtro.asignadaA } : {}), limite: filtro.limite ?? 100,
    };
    return datos(await b.rpc('bandeja_conversaciones', { campana: campanaId, filtro: f }), 'leer la bandeja') as FilaConversacion[];
  }

  async conversacion(conversacionId: string): Promise<ConversacionCompleta | null> {
    const b = await this.bots_();
    const r = await b.rpc('bandeja_conversacion', { sesion: conversacionId });
    if (r.error && /no permite/.test(r.error.message)) return null;
    return datos(r, 'leer la conversación') as ConversacionCompleta | null;
  }

  async tomarConversacion(conversacionId: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('tomar_conversacion', { sesion: conversacionId }), 'tomar la conversación');
  }

  async responderConversacion(conversacionId: string, texto: string, _por: string): Promise<number> {
    const b = await this.bots_();
    return Number(datos(await b.rpc('responder_conversacion', { sesion: conversacionId, texto }), 'responder'));
  }

  async devolverConversacion(conversacionId: string, turno: TurnoDevuelto, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('devolver_conversacion', { sesion: conversacionId, turno }), 'devolver la conversación');
  }

  async cerrarConversacion(conversacionId: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('cerrar_conversacion', { sesion: conversacionId }), 'cerrar la conversación');
  }

  async alertas(campanaId: string, opciones: { abiertas?: boolean } = {}): Promise<Alerta[]> {
    const b = await this.bots_();
    let q = b.from('alerts').select('id, kind, bot_id, campaign_id, ref, opened_at, closed_at').eq('campaign_id', campanaId);
    if (opciones.abiertas) q = q.is('closed_at', null);
    const filas = datos(await q.order('opened_at', { ascending: false }).limit(200), 'leer las alertas') as
      { id: string; kind: Alerta['tipo']; bot_id: string; campaign_id: string; ref: string; opened_at: string; closed_at: string | null }[];
    return filas.map((f) => ({ id: f.id, tipo: f.kind, botId: f.bot_id, campanaId: f.campaign_id, ref: f.ref, abiertaEn: f.opened_at, cerradaEn: f.closed_at }));
  }

  async muestra(campanaId: string, opciones: { pendientes?: boolean; limite?: number } = {}): Promise<FilaMuestra[]> {
    const b = await this.bots_();
    return datos(await b.rpc('bandeja_muestra', { campana: campanaId, pendientes: !!opciones.pendientes, limite: opciones.limite ?? 100 }), 'leer la muestra') as FilaMuestra[];
  }

  async revisarRespuesta(conversacionId: string, n: number, veredicto: 'correcta' | 'incorrecta', convertida: boolean, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('revisar_respuesta', { sesion: conversacionId, numero: n, veredicto, convertida }), 'guardar la revisión');
  }

  async buscarContactos(campanaId: string, texto: string, _por: string): Promise<FilaContacto[]> {
    const b = await this.bots_();
    return datos(await b.rpc('buscar_contactos', { campana: campanaId, texto }), 'buscar contactos') as FilaContacto[];
  }

  async exportarContacto(contactoId: string, _por: string): Promise<ExportacionContacto> {
    const b = await this.bots_();
    return datos(await b.rpc('exportar_contacto', { contacto: contactoId }), 'exportar el contacto') as ExportacionContacto;
  }

  async borrarContacto(contactoId: string, nota: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('borrar_contacto', { contacto: contactoId, nota }), 'borrar el contacto');
  }

  // ── WhatsApp (bots_0008) ──────────────────────────────────────────────────────────────────────

  async canalWhatsapp(botId: string): Promise<CanalWhatsapp | null> {
    const b = await this.bots_();
    const r = datos(await b.rpc('canal_whatsapp', { bot: botId }), 'leer el canal de WhatsApp') as CanalWhatsapp | null;
    if (!r) return null;
    const s = r.salud;
    return {
      ...r, respuestasMes: Number(r.respuestasMes),
      salud: {
        dias: Number(s.dias), recibidos: Number(s.recibidos), repetidos: Number(s.repetidos), enviados: Number(s.enviados), entregados: Number(s.entregados),
        leidos: Number(s.leidos), fallidos: Number(s.fallidos), demoraMaxMs: Number(s.demoraMaxMs), demoraMediaMs: s.demoraMediaMs === null ? null : Number(s.demoraMediaMs),
        pendientes: Number(s.pendientes),
      },
    };
  }

  async conectarWhatsapp(botId: string, d: ConexionWhatsapp, _por: string): Promise<string> {
    const b = await this.bots_();
    return String(datos(await b.rpc('conectar_whatsapp', { bot: botId, clave: d.clave, numero: d.numero ?? '', secreto_hash: d.secretoHash, webhook_url: d.webhookUrl }), 'conectar WhatsApp'));
  }

  async prenderWhatsapp(botId: string, activo: boolean, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('prender_whatsapp', { bot: botId, activo }), activo ? 'prender WhatsApp' : 'apagar WhatsApp');
  }

  async responderConPlantilla(conversacionId: string, p: PlantillaEnviada, _por: string): Promise<number> {
    const b = await this.bots_();
    return Number(datos(await b.rpc('responder_con_plantilla', { sesion: conversacionId, plantilla: p }), 'mandar la plantilla'));
  }

  async plantillas(botId: string): Promise<PlantillaGuardada[]> {
    const b = await this.bots_();
    return datos(await b.rpc('plantillas', { bot: botId }), 'leer las plantillas') as PlantillaGuardada[];
  }

  async guardarPlantillaCreada(botId: string, p: Plantilla, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('guardar_plantilla_creada', { bot: botId, plantilla: p }), 'guardar la plantilla');
  }

  async quitarPlantilla(botId: string, nombre: string, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('quitar_plantilla', { bot: botId, nombre }), 'quitar la plantilla');
  }

  // ── Base de contactos (7.06) ──────────────────────────────────────────────────────────────────

  async baseContactos(campanaId: string, filtro: FiltroContactos, _por: string): Promise<PaginaContactos> {
    const b = await this.bots_();
    return datos(await b.rpc('base_contactos', { campana: campanaId, filtro }), 'leer la base de contactos') as PaginaContactos;
  }

  async fichaContacto(contactoId: string, _por: string): Promise<FichaContacto | null> {
    const b = await this.bots_();
    return datos(await b.rpc('ficha_contacto', { contacto: contactoId }), 'leer el contacto') as FichaContacto | null;
  }

  async exportarBaseContactos(campanaId: string, filtro: Omit<FiltroContactos, 'limite' | 'desde'>, _por: string): Promise<FilaBaseContacto[]> {
    const b = await this.bots_();
    return datos(await b.rpc('exportar_base_contactos', { campana: campanaId, filtro }), 'exportar la base de contactos') as FilaBaseContacto[];
  }

  async exportacionesBase(campanaId: string, _por: string): Promise<ExportacionBase[]> {
    const b = await this.bots_();
    return datos(await b.rpc('exportaciones_base', { campana: campanaId }), 'leer las descargas de la base') as ExportacionBase[];
  }

  async pedidosDatos(campanaId: string): Promise<PedidoDatos[]> {
    const b = await this.bots_();
    const filas = datos(await b.from('data_requests').select('id, campaign_id, contact_id, kind, note, handled_by, handled_at').eq('campaign_id', campanaId).order('handled_at', { ascending: false }).limit(200), 'leer los pedidos') as
      { id: string; campaign_id: string; contact_id: string; kind: PedidoDatos['tipo']; note: string; handled_by: string | null; handled_at: string }[];
    return filas.map((f) => ({ id: f.id, campanaId: f.campaign_id, contactoId: f.contact_id, tipo: f.kind, nota: f.note, hechoPor: f.handled_by, hechoEn: f.handled_at }));
  }
}
