/**
 * El aviso (webhook) de 360dialog: el formato de Meta, leído sin confiar en nada. De cada aviso salen entradas para la
 * cola del canal: los mensajes de las personas (con su nombre de perfil) y los estados de los mensajes que salieron.
 *
 *   {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
 *     "metadata": {"display_phone_number": "…"}, "contacts": [{"profile": {"name": "…"}, "wa_id": "…"}],
 *     "messages": [{"from", "id", "timestamp", "type", …}], "statuses": [{"id", "status", "timestamp", "errors": […]}]}}]}]}
 *
 * La clave de cada entrada descarta los reintentos: 360dialog reintenta hasta 7 días un aviso que no recibió respuesta.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { EntradaWebhook } from '../datos/repositorio';
import { estadoDeMeta, leerMensaje, type MensajeMeta } from '../dominio/whatsapp';

const texto = z.string().max(4096);

const esquemaAviso = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      field: z.string().optional(),
      value: z.object({
        metadata: z.object({ display_phone_number: texto.optional() }).passthrough().optional(),
        contacts: z.array(z.object({ wa_id: texto.optional(), profile: z.object({ name: texto.optional() }).passthrough().optional() }).passthrough()).max(100).optional(),
        messages: z.array(z.object({ from: texto, id: texto, timestamp: texto, type: texto }).passthrough()).max(100).optional(),
        statuses: z.array(z.object({
          id: texto, status: texto, timestamp: texto.optional(),
          errors: z.array(z.object({ code: z.number().optional(), title: texto.optional(), message: texto.optional() }).passthrough()).optional(),
        }).passthrough()).max(200).optional(),
      }).passthrough(),
    }).passthrough()).max(50),
  }).passthrough()).max(50),
}).passthrough();

export interface AvisoLeido {
  entradas: EntradaWebhook[];
  /** El número del canal, como lo muestra WhatsApp. */
  numero: string | null;
}

/** null si el cuerpo no tiene la forma de un aviso de Meta. */
export function leerAviso(cuerpo: unknown): AvisoLeido | null {
  const p = esquemaAviso.safeParse(cuerpo);
  if (!p.success) return null;
  const entradas: EntradaWebhook[] = [];
  let numero: string | null = null;
  for (const e of p.data.entry) {
    for (const c of e.changes) {
      if (c.field && c.field !== 'messages') continue;
      const v = c.value;
      numero ??= v.metadata?.display_phone_number?.slice(0, 30) ?? null;
      const perfiles = new Map((v.contacts ?? []).map((x) => [String(x.wa_id ?? '').replace(/\D/g, ''), x.profile?.name?.trim().slice(0, 120) || null]));
      for (const m of v.messages ?? []) {
        const leido = leerMensaje(m as unknown as MensajeMeta);
        if (!leido) continue;
        entradas.push({ clave: `m:${leido.id}`.slice(0, 300), tipo: 'mensaje', hora: leido.hora, mensaje: { ...leido, nombrePerfil: perfiles.get(leido.de) ?? null } });
      }
      for (const s of v.statuses ?? []) {
        const estado = estadoDeMeta(s.status);
        if (!estado) continue;
        const segundos = Number(s.timestamp);
        const err = s.errors?.[0];
        entradas.push({
          clave: `e:${s.id}:${estado}`.slice(0, 300), tipo: 'estado', idProveedor: s.id.slice(0, 256), estado,
          hora: new Date(Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : Date.now()).toISOString(),
          error: err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim().slice(0, 200) || 'Error sin detalle' : null,
        });
      }
    }
  }
  return { entradas, numero };
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/** Compara el secreto que trae el aviso con el hash guardado, en tiempo constante. */
export function secretoValido(recibido: string | null, hashGuardado: string | null): boolean {
  if (!recibido || !hashGuardado || !/^[0-9a-f]{64}$/.test(hashGuardado)) return false;
  const a = Buffer.from(sha256(recibido), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** El id de un mensaje de WhatsApp como id del canal en la conversación (el wamid puede traer caracteres que no van). */
export function idCanalDe(wamid: string): string {
  return `wa.${sha256(wamid).slice(0, 40)}`;
}
