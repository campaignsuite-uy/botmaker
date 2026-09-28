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
import type { FichaMotor } from '../../dominio/motores';
import type {
  Bot, CambiosBot, EleccionMotores, FuncionMotor, GastoDia, LlamadaMotor, MotorFuncion, NuevaLlamada, NuevoBot, RolModulo, Topes, UsoMotor,
} from '../../dominio/tipos';
import { ErrorDatos, errorDeBase } from '../errores';
import type { FiltroLlamadas, Repositorio } from '../repositorio';
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
    const filas = datos(await this.servicio.from('engine_defaults').select('function, primary_engine_id, fallback_engine_id, timeout_ms'), 'leer los motores por defecto') as M.FilaMotorFuncion[];
    return M.ordenarFunciones(filas.map(M.aMotorFuncion));
  }

  async motoresDeBot(botId: string): Promise<MotorFuncion[]> {
    // Con la clave de servicio: la capa de motores lo necesita también en la app pública (etapa 5), sin sesión.
    const filas = datos(await this.servicio.from('bot_engines').select('function, primary_engine_id, fallback_engine_id, timeout_ms').eq('bot_id', botId), 'leer los motores del bot') as M.FilaMotorFuncion[];
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

  async crearBot(campanaId: string, d: NuevoBot, clave: string, _por: string): Promise<string> {
    const b = await this.bots_();
    const id = datos(await b.rpc('crear_bot', { campana: campanaId, datos: { nombre: d.nombre, caso: d.caso, mercado: d.mercado, trato: d.trato }, clave }), 'crear el bot');
    return String(id);
  }

  async guardarBot(botId: string, cambios: CambiosBot, _por: string): Promise<void> {
    const b = await this.bots_();
    datos(await b.rpc('guardar_bot', { bot: botId, datos: cambios }), 'guardar el bot');
  }

  async guardarMotores(botId: string, motores: EleccionMotores, topes: Topes | null, _por: string): Promise<void> {
    const b = await this.bots_();
    const m: Record<string, { principal: string; respaldo: string | null }> = {};
    for (const [f, e] of Object.entries(motores) as [FuncionMotor, { principal: string; respaldo: string | null } | undefined][]) if (e) m[f] = e;
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

  async registrarLlamada(l: NuevaLlamada): Promise<void> {
    datos(await this.servicio.from('engine_calls').insert(M.haciaLlamada(l)), 'registrar la llamada');
  }
}
