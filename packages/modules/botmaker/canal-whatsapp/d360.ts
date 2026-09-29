/**
 * El cliente de 360dialog (WhatsApp Cloud API por 360dialog). SOLO SERVIDOR: recibe la clave del canal, que sale de
 * Vault, y nunca la escribe en un registro ni la devuelve.
 *
 * Lo que usa BotMaker (documentación de 360dialog consultada el 29/9/2026; base https://waba-v2.360dialog.io, clave
 * en el encabezado D360-API-KEY):
 *  - GET  /v1/configs/webhook   → validar la clave (401 si no vale);
 *  - POST /v1/configs/webhook   → la dirección del aviso con un encabezado propio: {"url", "headers"};
 *  - POST /messages             → mandar un mensaje (texto, botones, lista o plantilla);
 *  - GET  /message_templates    → las plantillas de la cuenta, con su estado.
 *
 * El cliente simulado (simulado.ts) tiene la misma forma: la demo y las pruebas no llaman a 360dialog.
 */
import { leerPlantilla, type MensajeWhatsapp, type Plantilla, type PlantillaMeta } from '../dominio/whatsapp';

export type ResultadoCliente<T> =
  | { ok: true; valor: T }
  /** clave_invalida: 401/403. reintentar: 429, 5xx o sin respuesta. rechazado: 360dialog o Meta no lo aceptan (no se reintenta). */
  | { ok: false; error: 'clave_invalida' | 'reintentar' | 'rechazado'; detalle: string };

export interface Cliente360 {
  /** true si es el cliente simulado (la demo): la pantalla lo dice. */
  readonly simulado: boolean;
  validarClave(clave: string): Promise<ResultadoCliente<true>>;
  configurarWebhook(clave: string, url: string, encabezados: Record<string, string>): Promise<ResultadoCliente<true>>;
  /** Manda un mensaje a un número (solo dígitos). Devuelve el id de WhatsApp del mensaje (wamid…). */
  enviar(clave: string, para: string, mensaje: MensajeWhatsapp): Promise<ResultadoCliente<string>>;
  plantillas(clave: string): Promise<ResultadoCliente<Plantilla[]>>;
}

export const BASE_360 = 'https://waba-v2.360dialog.io';

/** El encabezado que BotMaker le pide a 360dialog que mande en cada aviso, con el secreto del canal. */
export const ENCABEZADO_SECRETO = 'x-botmaker-secreto';

function detalleDe(cuerpo: unknown, status: number): string {
  const c = cuerpo as { error?: { message?: string; code?: number; error_data?: { details?: string } }; meta?: { developer_message?: string }; message?: string } | null;
  const m = c?.error?.error_data?.details ?? c?.error?.message ?? c?.meta?.developer_message ?? c?.message ?? '';
  const codigo = c?.error?.code ? ` (${c.error.code})` : '';
  return `HTTP ${status}${codigo}${m ? `: ${String(m).slice(0, 200)}` : ''}`;
}

async function pedir<T>(clave: string, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<ResultadoCliente<T>> {
  let r: Response;
  try {
    r = await fetch(`${BASE_360}${ruta}`, {
      method: metodo,
      headers: { 'D360-API-KEY': clave, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: 'reintentar', detalle: `Sin respuesta de 360dialog: ${e instanceof Error ? e.name : 'error'}` };
  }
  let j: unknown = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  if (r.ok) return { ok: true, valor: j as T };
  if (r.status === 401 || r.status === 403) return { ok: false, error: 'clave_invalida', detalle: detalleDe(j, r.status) };
  if (r.status === 429 || r.status >= 500) return { ok: false, error: 'reintentar', detalle: detalleDe(j, r.status) };
  return { ok: false, error: 'rechazado', detalle: detalleDe(j, r.status) };
}

export function cliente360Real(): Cliente360 {
  return {
    simulado: false,
    async validarClave(clave) {
      const r = await pedir<unknown>(clave, 'GET', '/v1/configs/webhook');
      return r.ok ? { ok: true, valor: true } : r;
    },
    async configurarWebhook(clave, url, encabezados) {
      const r = await pedir<unknown>(clave, 'POST', '/v1/configs/webhook', { url, headers: encabezados });
      return r.ok ? { ok: true, valor: true } : r;
    },
    async enviar(clave, para, mensaje) {
      const r = await pedir<{ messages?: { id?: string }[] }>(clave, 'POST', '/messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...mensaje });
      if (!r.ok) return r;
      const id = r.valor?.messages?.[0]?.id;
      return id ? { ok: true, valor: String(id) } : { ok: false, error: 'rechazado', detalle: 'La respuesta de 360dialog no trae el id del mensaje.' };
    },
    async plantillas(clave) {
      const r = await pedir<{ data?: PlantillaMeta[]; waba_templates?: PlantillaMeta[] }>(clave, 'GET', '/message_templates?limit=200');
      if (!r.ok) return r;
      const lista = (r.valor?.data ?? r.valor?.waba_templates ?? []).map(leerPlantilla).filter((p): p is Plantilla => !!p);
      return { ok: true, valor: lista.sort((a, b) => Number(b.usable) - Number(a.usable) || a.nombre.localeCompare(b.nombre)) };
    },
  };
}
