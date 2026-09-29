/**
 * Filas del esquema `bots` ↔ tipos del dominio. La base habla en inglés (snake_case) y el dominio en español.
 * numeric llega como texto o número según el cliente: se pasa siempre por Number().
 */
import type { FichaMotor, Permiso } from '../../dominio/motores';
import { FUNCIONES, type Bot, type CasoUso, type EstadoBot, type FuncionMotor, type GastoDia, type LlamadaMotor, type MotorFuncion, type NuevaLlamada, type Trato, type UsoMotor } from '../../dominio/tipos';

export const COLUMNAS_BOT = 'id, organization_id, campaign_id, name, public_id, use_case, market, status, published_version_id, treatment, ai_notice_text, personalization, retention_days, daily_cap_usd, monthly_cap_usd, created_by, created_at, updated_at, archived_at';

export interface FilaBot {
  id: string; organization_id: string; campaign_id: string; name: string; public_id: string; use_case: CasoUso; market: string;
  status: EstadoBot; published_version_id: string | null; treatment: Trato; ai_notice_text: string; personalization: boolean;
  retention_days: number; daily_cap_usd: number | string; monthly_cap_usd: number | string; created_by: string | null;
  created_at: string; updated_at: string; archived_at: string | null;
}

export const aBot = (f: FilaBot): Bot => ({
  id: f.id,
  campanaId: f.campaign_id,
  organizacionId: f.organization_id,
  nombre: f.name,
  idPublico: f.public_id,
  caso: f.use_case,
  mercado: f.market,
  estado: f.status,
  versionPublicadaId: f.published_version_id,
  trato: f.treatment,
  avisoIa: f.ai_notice_text ?? '',
  personalizacion: !!f.personalization,
  diasGuardado: Number(f.retention_days),
  topeDiarioUsd: Number(f.daily_cap_usd),
  topeMensualUsd: Number(f.monthly_cap_usd),
  creadoPor: f.created_by,
  creadoEn: new Date(f.created_at).toISOString(),
  actualizadoEn: new Date(f.updated_at).toISOString(),
  archivadoEn: f.archived_at ? new Date(f.archived_at).toISOString() : null,
});

export interface FilaMotor {
  id: string; name: string; company: string; route: 'openrouter' | 'simulado'; model: string; provider_prefs: Record<string, unknown>;
  reasoning: { effort: string } | null; no_temperature: boolean; cache: boolean; price_in_usd_mtok: number | string;
  price_out_usd_mtok: number | string; price_cache_usd_mtok: number | string | null; strict_json: boolean; allows_electoral: Permiso;
  allows_political: Permiso; requires_ai_notice: boolean; allows_personalization: boolean; trains_on_data: boolean; retention: string;
  region: string; conditions: string; functions: FuncionMotor[]; active: boolean;
}

export const aFicha = (f: FilaMotor): FichaMotor => ({
  id: f.id,
  nombre: f.name,
  empresa: f.company,
  ruta: f.route,
  modelo: f.model,
  proveedor: f.provider_prefs ?? {},
  razonamiento: f.reasoning ?? null,
  sinTemperatura: f.no_temperature,
  cache: f.cache,
  precioEntrada: Number(f.price_in_usd_mtok),
  precioSalida: Number(f.price_out_usd_mtok),
  precioCache: f.price_cache_usd_mtok == null ? null : Number(f.price_cache_usd_mtok),
  jsonEstricto: f.strict_json,
  permiteElectoral: f.allows_electoral,
  permitePolitico: f.allows_political,
  exigeAvisoIa: f.requires_ai_notice,
  permitePersonalizacion: f.allows_personalization,
  entrena: f.trains_on_data,
  retencion: f.retention,
  region: f.region,
  condiciones: f.conditions,
  funciones: f.functions ?? [],
  activo: f.active,
});

export interface FilaMotorFuncion { function: FuncionMotor; primary_engine_id: string; fallback_engine_id: string | null; timeout_ms: number; double_read: boolean }
export const COLUMNAS_MOTOR_FUNCION = 'function, primary_engine_id, fallback_engine_id, timeout_ms, double_read';

export const aMotorFuncion = (f: FilaMotorFuncion): MotorFuncion => ({
  funcion: f.function, principal: f.primary_engine_id, respaldo: f.fallback_engine_id, tiempoMaximoMs: Number(f.timeout_ms), dobleLectura: !!f.double_read,
});

export const ordenarFunciones = (xs: MotorFuncion[]) => [...xs].sort((a, b) => FUNCIONES.indexOf(a.funcion) - FUNCIONES.indexOf(b.funcion));

export interface FilaGasto { bot_id: string; day: string; use: UsoMotor; cost_usd: number | string; calls: number }

export const aGasto = (f: FilaGasto): GastoDia => ({
  botId: f.bot_id, dia: String(f.day).slice(0, 10), uso: f.use, costoUsd: Number(f.cost_usd), llamadas: Number(f.calls),
});

export const COLUMNAS_LLAMADA = 'id, bot_id, campaign_id, use, function, engine_id, model, provider, is_fallback, ok, error, latency_ms, tokens_in, tokens_out, tokens_cached, tokens_reasoning, cost_usd, generation_id, profile_id, created_at';

export interface FilaLlamada {
  id: number | string; bot_id: string; campaign_id: string; use: UsoMotor; function: FuncionMotor; engine_id: string; model: string; provider: string;
  is_fallback: boolean; ok: boolean; error: string | null; latency_ms: number | null; tokens_in: number | null; tokens_out: number | null;
  tokens_cached: number | null; tokens_reasoning: number | null; cost_usd: number | string; generation_id: string | null; profile_id: string | null; created_at: string;
}

export const aLlamada = (f: FilaLlamada): LlamadaMotor => ({
  id: Number(f.id), botId: f.bot_id, campanaId: f.campaign_id, uso: f.use, funcion: f.function, motorId: f.engine_id, modelo: f.model,
  proveedor: f.provider, respaldo: f.is_fallback, ok: f.ok, error: f.error, demoraMs: f.latency_ms, tokensEntrada: f.tokens_in,
  tokensSalida: f.tokens_out, tokensCache: f.tokens_cached, tokensRazonamiento: f.tokens_reasoning, costoUsd: Number(f.cost_usd),
  idGeneracion: f.generation_id, personaId: f.profile_id, fecha: new Date(f.created_at).toISOString(),
});

/** Una llamada nueva como fila de bots.engine_calls. organization_id lo completa la base desde la campaña. */
export const haciaLlamada = (l: NuevaLlamada) => ({
  campaign_id: l.campanaId, bot_id: l.botId, use: l.uso, function: l.funcion, engine_id: l.motorId, model: l.modelo, provider: l.proveedor,
  is_fallback: l.respaldo, ok: l.ok, error: l.error, latency_ms: l.demoraMs == null ? null : Math.round(l.demoraMs), tokens_in: l.tokensEntrada,
  tokens_out: l.tokensSalida, tokens_cached: l.tokensCache, tokens_reasoning: l.tokensRazonamiento, cost_usd: l.costoUsd,
  generation_id: l.idGeneracion, profile_id: l.personaId, ...(l.fecha ? { created_at: l.fecha } : {}),
});
