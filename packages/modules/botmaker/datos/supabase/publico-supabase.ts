/**
 * El repositorio de la app pública y de las tareas de fondo sobre Supabase. SOLO SERVIDOR: usa la clave de servicio y
 * solo llama a las funciones bots.publico_* y bots.tarea_* (packages/db/migraciones/bots_0006 y bots_0007), que
 * devuelven las filas con la forma de dominio/conversaciones.ts. Lo que necesita la capa de motores (topes, fichas,
 * motores del bot, gasto y registro de llamadas) lo lee igual que el repositorio del equipo, con la misma clave.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Canal, Contacto, Conversacion, Mensaje } from '../../dominio/conversaciones';
import type { FichaMotor } from '../../dominio/motores';
import type { MotorFuncion, NuevaLlamada, Topes, UsoMotor } from '../../dominio/tipos';
import { ErrorDatos, errorDeBase } from '../errores';
import type {
  BotPublico, CanalWhatsappPublico, EntradaWebhook, EnvioPendiente, RepositorioPublico, RepositorioTareas, RepositorioWhatsapp, ResultadoEnvio, TurnoGuardado,
} from '../repositorio';
import type { EstadoEnvio, Plantilla } from '../../dominio/whatsapp';
import { RepositorioSupabase } from './repositorio-supabase';

type Resultado<T> = { data: T; error: { message: string; code?: string } | null };

function datos<T>(r: Resultado<T>, que: string): T {
  if (r.error) throw errorDeBase(r.error, que);
  return r.data;
}

export class RepositorioPublicoSupabase implements RepositorioPublico, RepositorioTareas, RepositorioWhatsapp {
  private readonly capa: RepositorioSupabase;

  constructor(private readonly servicio: SupabaseClient) {
    this.capa = new RepositorioSupabase({ servicio, persona: async () => null });
  }

  static desdeEntorno(): RepositorioPublicoSupabase {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !clave) throw new Error('La app pública con CAMPAIGNSUITE_DATOS=supabase necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver .env.ejemplo).');
    return new RepositorioPublicoSupabase(createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
  }

  private get b() {
    return this.servicio.schema('bots');
  }

  // Lo que necesita la capa de motores.
  topesBot(botId: string): Promise<Topes | null> { return this.capa.topesBot(botId); }
  fichas(): Promise<FichaMotor[]> { return this.capa.fichas(); }
  motoresDeBot(botId: string): Promise<MotorFuncion[]> { return this.capa.motoresDeBot(botId); }
  gastoBot(botId: string, desdeDia: string, uso?: UsoMotor): Promise<number> { return this.capa.gastoBot(botId, desdeDia, uso); }
  registrarLlamada(l: NuevaLlamada): Promise<void> { return this.capa.registrarLlamada(l); }

  async botPublico(idPublico: string): Promise<BotPublico | null> {
    const r = datos(await this.b.rpc('publico_bot', { id_publico: idPublico }), 'leer el bot') as (BotPublico & { bot: { topeDiarioUsd: unknown; topeMensualUsd: unknown } }) | null;
    if (!r) return null;
    return { ...r, bot: { ...r.bot, topeDiarioUsd: Number(r.bot.topeDiarioUsd), topeMensualUsd: Number(r.bot.topeMensualUsd) } } as BotPublico;
  }

  async contar(claves: readonly { clave: string; ventanaSegundos: number }[], ahora: Date): Promise<number[]> {
    const r = datos(await this.b.rpc('publico_contar', { claves: claves.map((c) => c.clave), ventanas: claves.map((c) => c.ventanaSegundos), ahora: ahora.toISOString() }), 'contar los mensajes');
    return (r as number[]).map(Number);
  }

  async buscarConversacion(botId: string, contactoHash: string): Promise<{ conversacion: Conversacion; contacto: Contacto } | null> {
    return datos(await this.b.rpc('publico_buscar_conversacion', { bot: botId, hash: contactoHash }), 'leer la conversación') as { conversacion: Conversacion; contacto: Contacto } | null;
  }

  async abrirConversacion(p: { botId: string; contactoHash: string; canal: Canal; verificadoAhora: boolean; ahora: Date }): Promise<{ conversacion: Conversacion; contacto: Contacto; nueva: boolean }> {
    const r = await this.b.rpc('publico_abrir_conversacion', { bot: p.botId, hash: p.contactoHash, canal: p.canal, verificado_ahora: p.verificadoAhora, ahora: p.ahora.toISOString() });
    return datos(r, 'abrir la conversación') as { conversacion: Conversacion; contacto: Contacto; nueva: boolean };
  }

  async mensajes(conversacionId: string, desde: number): Promise<Mensaje[]> {
    return datos(await this.b.rpc('publico_mensajes', { sesion: conversacionId, desde }), 'leer los mensajes') as Mensaje[];
  }

  async mensajePorIdCanal(conversacionId: string, idCanal: string): Promise<Mensaje | null> {
    return datos(await this.b.rpc('publico_mensaje_por_id', { sesion: conversacionId, id_canal: idCanal }), 'leer el mensaje') as Mensaje | null;
  }

  async guardarTurno(conversacionId: string, seqEsperada: number, t: TurnoGuardado): Promise<Mensaje[]> {
    const r = await this.b.rpc('publico_guardar_turno', { sesion: conversacionId, seq_esperada: seqEsperada, turno: t });
    if (r.error && r.error.code === '40001') throw new ErrorDatos('conversacion_cambio', r.error.message);
    return datos(r, 'guardar el turno') as Mensaje[];
  }

  async aceptarCondiciones(contactoId: string, numero: number, ahora: Date): Promise<void> {
    datos(await this.b.rpc('publico_aceptar_condiciones', { contacto: contactoId, numero, ahora: ahora.toISOString() }), 'aceptar las condiciones');
  }

  // ── WhatsApp (bots_0008) ──────────────────────────────────────────────────────────────────────

  async canalWhatsappPublico(idPublico: string): Promise<CanalWhatsappPublico | null> {
    return datos(await this.b.rpc('publico_canal_whatsapp', { id_publico: idPublico }), 'leer el canal') as CanalWhatsappPublico | null;
  }

  async canalWhatsappPorId(canalId: string): Promise<CanalWhatsappPublico | null> {
    return datos(await this.b.rpc('publico_canal_whatsapp_por_id', { canal: canalId }), 'leer el canal') as CanalWhatsappPublico | null;
  }

  async recibirEntradas(canalId: string, entradas: readonly EntradaWebhook[], p: { ahora: Date; demoraMs: number; numero: string | null }): Promise<{ nuevas: number; repetidas: number }> {
    const r = datos(await this.b.rpc('publico_recibir', { canal: canalId, entradas, ahora: p.ahora.toISOString(), demora_ms: Math.round(p.demoraMs), numero: p.numero ?? '' }), 'guardar el aviso') as { nuevas: number; repetidas: number };
    return { nuevas: Number(r.nuevas), repetidas: Number(r.repetidas) };
  }

  async entradasPendientes(canalId: string, limite: number, ahora: Date): Promise<EntradaWebhook[]> {
    return datos(await this.b.rpc('publico_entradas_pendientes', { canal: canalId, limite, ahora: ahora.toISOString() }), 'leer la cola del canal') as EntradaWebhook[];
  }

  async entradaProcesada(canalId: string, clave: string): Promise<void> {
    datos(await this.b.rpc('publico_entrada_procesada', { canal: canalId, clave }), 'marcar lo procesado');
  }

  async guardarTelefono(contactoId: string, telefono: string, nombrePerfil: string | null): Promise<void> {
    datos(await this.b.rpc('publico_guardar_telefono', { contacto: contactoId, telefono, nombre_perfil: nombrePerfil ?? '' }), 'guardar el número');
  }

  async tomarEnvios(f: { canalId?: string; conversacionId?: string }, ahora: Date, limite: number): Promise<EnvioPendiente[]> {
    const r = datos(await this.b.rpc('publico_tomar_envios', { canal: f.canalId ?? null, sesion: f.conversacionId ?? null, ahora: ahora.toISOString(), limite }), 'tomar los envíos') as EnvioPendiente[];
    return r.map((x) => ({ ...x, n: Number(x.n), parte: Number(x.parte), intentos: Number(x.intentos) }));
  }

  async resultadoEnvio(envioId: string, r: ResultadoEnvio, ahora: Date): Promise<void> {
    datos(await this.b.rpc('publico_resultado_envio', { envio: envioId, resultado: r, ahora: ahora.toISOString() }), 'guardar el resultado del envío');
  }

  async aplicarEstado(canalId: string, idProveedor: string, estado: EstadoEnvio, error: string | null, ahora: Date): Promise<void> {
    datos(await this.b.rpc('publico_aplicar_estado', { canal: canalId, id_proveedor: idProveedor, estado, error: error ?? '', ahora: ahora.toISOString() }), 'guardar el estado del mensaje');
  }

  async claveWhatsapp(canalId: string): Promise<string | null> {
    const r = datos(await this.b.rpc('servicio_clave_whatsapp', { canal: canalId }), 'leer la clave del canal') as string | null;
    return r || null;
  }

  async canalDesconectado(canalId: string, error: string, ahora: Date): Promise<void> {
    datos(await this.b.rpc('publico_canal_desconectado', { canal: canalId, error, ahora: ahora.toISOString() }), 'desconectar el canal');
  }

  async canalesConPendientes(ahora: Date): Promise<string[]> {
    return datos(await this.b.rpc('publico_canales_con_pendientes', { ahora: ahora.toISOString() }), 'buscar canales con pendientes') as string[];
  }

  async canalesParaRevisarPlantillas(ahora: Date): Promise<string[]> {
    return datos(await this.b.rpc('publico_canales_para_plantillas', { ahora: ahora.toISOString() }), 'buscar canales para revisar plantillas') as string[];
  }

  async sincronizarPlantillas(canalId: string, plantillas: readonly Plantilla[], ahora: Date): Promise<void> {
    datos(await this.b.rpc('publico_sincronizar_plantillas', { canal: canalId, plantillas, ahora: ahora.toISOString() }), 'guardar las plantillas');
  }

  async revisarAlertas(ahora: Date): Promise<{ abiertas: number; cerradas: number }> {
    return datos(await this.b.rpc('tarea_revisar_alertas', { ahora: ahora.toISOString() }), 'revisar las alertas') as { abiertas: number; cerradas: number };
  }

  async borrarVencidos(ahora: Date): Promise<number> {
    return Number(datos(await this.b.rpc('tarea_borrar_vencidos', { ahora: ahora.toISOString() }), 'borrar lo vencido'));
  }

  async agregarAnalitica(ahora: Date): Promise<{ eventos: number; conversaciones: number }> {
    return datos(await this.b.rpc('tarea_agregar_analitica', { ahora: ahora.toISOString() }), 'sumar la analítica') as { eventos: number; conversaciones: number };
  }
}
