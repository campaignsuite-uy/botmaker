/**
 * Prueba de carga del canal web (tarea 5.07): 100 conversaciones de prueba contra /api/conversar, cada una con un
 * inicio, un botón y un texto libre, y la demora de cada mensaje. La meta de la definición: p95 menor a 3 s con
 * botones y a 6 s con IA. Con la demo mide lo que agrega BotMaker (motor simulado); con la app pública de verdad y los
 * motores reales, la demora completa.
 *
 * Uso: node scripts/probar-carga.mjs [URL de las rutas públicas] [conversaciones]
 *   node scripts/probar-carga.mjs http://localhost:3000/publico 100     (la demo de la app del equipo)
 *   node scripts/probar-carga.mjs https://<app pública>.vercel.app 100   (la app pública)
 * Cada conversación sale de una "IP" distinta solo si el servidor la toma de x-forwarded-for (Vercel no lo deja
 * cambiar): contra Vercel, los límites por IP van a dejar parte en solo menús, y eso también se informa.
 */
const BASE = (process.argv[2] || 'http://localhost:3000/publico').replace(/\/$/, '');
const N = Number(process.argv[3] || 100);
const BOT = process.env.BOT || 'p5v9c3h7pa';
const PARALELO = Number(process.env.PARALELO || 10);

const azar = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
const p = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

const demoras = { botones: [], texto: [] };
let soloMenus = 0;
let fallas = 0;

async function mandar(contacto, ip, entrada) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/conversar`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ bot: BOT, contacto, canal: 'web', id: azar(20), entrada }),
  });
  const ms = performance.now() - t0;
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) fallas++;
  else if (j.soloMenus) soloMenus++;
  return { ms, j };
}

async function conversacion(i) {
  const contacto = `carga-${azar(16)}`;
  const ip = `198.51.${Math.floor(i / 250)}.${i % 250}`;
  const a = await mandar(contacto, ip, { tipo: 'inicio' });
  demoras.botones.push(a.ms);
  const menu = a.j.mensajes?.find((m) => m.opcionesDe === 'n_menu');
  if (menu) {
    const b = await mandar(contacto, ip, { tipo: 'opcion', cajaId: 'n_menu', letra: 'B', titulo: 'Quién es' });
    demoras.botones.push(b.ms);
  }
  const c = await mandar(contacto, ip, { tipo: 'texto', texto: '¿Qué propone para el transporte?' });
  demoras.texto.push(c.ms);
}

const inicio = Date.now();
for (let i = 0; i < N; i += PARALELO) await Promise.all(Array.from({ length: Math.min(PARALELO, N - i) }, (_, k) => conversacion(i + k)));
const f = (x) => (x === null ? '—' : `${(x / 1000).toFixed(2)} s`);
console.log(`\n${N} conversaciones contra ${BASE} (${PARALELO} a la vez), ${((Date.now() - inicio) / 1000).toFixed(1)} s en total`);
console.log(`  Con botones: ${demoras.botones.length} mensajes · p50 ${f(p(demoras.botones, 0.5))} · p95 ${f(p(demoras.botones, 0.95))} (meta: menos de 3 s)`);
console.log(`  Con texto (IA): ${demoras.texto.length} mensajes · p50 ${f(p(demoras.texto, 0.5))} · p95 ${f(p(demoras.texto, 0.95))} (meta: menos de 6 s)`);
console.log(`  Solo menús: ${soloMenus} · fallas: ${fallas}\n`);
const ok = (p(demoras.botones, 0.95) ?? 0) < 3000 && (p(demoras.texto, 0.95) ?? 0) < 6000 && fallas === 0;
process.exit(ok ? 0 : 1);
