/**
 * Lo que el canal web necesita del servidor donde corre: la IP de quien escribe, el HMAC con BOTS_HASH_SECRET y la
 * verificación de Cloudflare Turnstile. SOLO SERVIDOR.
 *
 * Sin TURNSTILE_SECRET_KEY la verificación pasa sola (desarrollo y demo) y Ajustes › Canales lo avisa. Sin
 * BOTS_HASH_SECRET, la demo usa una clave fija de desarrollo; con Supabase es obligatoria.
 */
import { createHmac } from 'node:crypto';

export function ipDe(h: Headers): string {
  const x = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || '';
  return x.slice(0, 64) || 'sin-ip';
}

export function turnstileConfigurado(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

export function hashConClave(): (texto: string) => string {
  let clave = process.env.BOTS_HASH_SECRET;
  if (!clave) {
    if ((process.env.CAMPAIGNSUITE_DATOS || 'demo') === 'supabase') throw new Error('Falta BOTS_HASH_SECRET: el canal web la necesita para guardar contactos sin identificarlos (ver .env.ejemplo).');
    clave = 'solo-desarrollo-sin-clave';
  }
  const k = clave;
  return (texto: string) => createHmac('sha256', k).update(texto).digest('hex');
}

/** Verifica un token de Turnstile con Cloudflare (siteverify). Sin clave configurada, pasa. */
export async function verificarTurnstile(token: string, ip: string): Promise<boolean> {
  const secreto = process.env.TURNSTILE_SECRET_KEY;
  if (!secreto) return true;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secreto, response: token, ...(ip !== 'sin-ip' ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(4000),
    });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    // Si Cloudflare no contesta, la conversación sigue en solo menús (no verificada) en lugar de cortarse.
    return false;
  }
}
