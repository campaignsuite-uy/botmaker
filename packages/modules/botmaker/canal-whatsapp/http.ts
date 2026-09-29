/**
 * Las rutas de WhatsApp como funciones de Request → Response (sin Next): el aviso de 360dialog y, solo en la demo, el
 * teléfono de prueba. Las montan apps/bots-publico y, en la demo, la app del equipo en /publico.
 */
import { modoDatos } from '@campaignsuite/platform/entorno';
import { z } from 'zod';
import { obtenerRepositorioPublico } from '../datos/publico';
import type { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { hashConClave } from '../canal-web/servidor';
import { completarPlantilla } from '../dominio/whatsapp';
import { recibirWebhook } from './nucleo';
import { entornoWhatsapp, simuladorDelServidor, whatsappSimulado } from './servidor';

const SIN_CACHE = { 'Cache-Control': 'no-store' };

/** Algo para correr después de contestar (after() de Next). Sin él, se corre antes de contestar. */
export type Despues = (fn: () => Promise<void>) => void;

/**
 * El aviso de 360dialog: contesta enseguida (lo que exige 360dialog: menos de 5 segundos; la meta es 0,5) y procesa
 * después. `base`: dónde están montadas las rutas públicas en este servidor.
 */
export async function manejarWebhookWhatsapp(req: Request, idPublico: string, base: string, despues?: Despues): Promise<Response> {
  const inicio = Date.now();
  const texto = await req.text();
  if (texto.length > 512_000) return new Response('Demasiado grande.', { status: 413 });
  const repo = obtenerRepositorioPublico();
  prepararSimulado(base);
  try {
    const r = await recibirWebhook(repo, entornoWhatsapp(repo, base), idPublico, req.headers, texto, inicio);
    if (r.procesar) {
      const procesar = r.procesar;
      const correr = () => procesar().catch((e) => console.error('[whatsapp] proceso', e instanceof Error ? e.message : e));
      if (despues) despues(correr);
      else await correr();
    }
    return new Response(r.status === 200 ? 'ok' : 'no', { status: r.status, headers: SIN_CACHE });
  } catch (e) {
    // Un 500 hace que 360dialog reintente: bien, porque no se guardó.
    console.error('[whatsapp] aviso', e instanceof Error ? e.message : e);
    return new Response('no se pudo', { status: 500, headers: SIN_CACHE });
  }
}

/**
 * En la demo, el 360dialog simulado entrega sus avisos directo a la misma función del webhook (sin red): el mismo
 * código que con 360dialog, procesando antes de devolver.
 */
export function prepararSimulado(base: string): void {
  if (!whatsappSimulado()) return;
  const sim = simuladorDelServidor(base);
  sim.entregar ??= async (url, encabezados, cuerpo) => {
    const id = url.split('/').pop() ?? '';
    const r = await manejarWebhookWhatsapp(new Request(`http://simulado.local${url}`, { method: 'POST', headers: { ...encabezados, 'content-type': 'application/json' }, body: cuerpo }), id, base);
    return r.status;
  };
}

// ── El teléfono de prueba (solo la demo) ────────────────────────────────────────────────────────

const telefono = z.string().transform((x) => x.replace(/\D/g, '')).pipe(z.string().regex(/^\d{7,15}$/));
const idPublico = z.string().regex(/^[a-z0-9]{6,20}$/);

const esquemaPedidoTelefono = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('escribir'), bot: idPublico, telefono, nombre: z.string().max(60).optional(),
    contenido: z.discriminatedUnion('tipo', [
      z.object({ tipo: z.literal('texto'), texto: z.string().trim().min(1).max(2000) }),
      z.object({ tipo: z.literal('boton'), id: z.string().max(80), titulo: z.string().max(40) }),
      z.object({ tipo: z.literal('fila'), id: z.string().max(80), titulo: z.string().max(40) }),
      z.object({ tipo: z.literal('audio') }),
      z.object({ tipo: z.literal('imagen'), pie: z.string().max(200).optional() }),
    ]),
  }),
  z.object({ accion: z.literal('reintentar'), bot: idPublico, telefono }),
  z.object({ accion: z.literal('revocar'), bot: idPublico, revocada: z.boolean() }),
  z.object({ accion: z.literal('cerrar_ventana'), bot: idPublico, telefono }),
  z.object({ accion: z.literal('decidir_plantillas'), bot: idPublico }),
]);

function demo(): RepositorioDemo | null {
  if (modoDatos() !== 'demo' || !whatsappSimulado()) return null;
  return obtenerRepositorioPublico() as unknown as RepositorioDemo;
}

async function conversacionDe(repo: RepositorioDemo, bot: string, tel: string) {
  const bp = await repo.botPublico(bot);
  if (!bp) return null;
  const x = await repo.buscarConversacion(bp.bot.id, hashConClave()(`contacto:${bp.bot.id}:wa:${tel}`));
  return x?.conversacion ?? null;
}

/** GET: las cuentas conectadas y la conversación del teléfono. POST: escribir, reintentar, revocar la clave, pasar 24 horas. */
export async function manejarTelefono(req: Request, base: string): Promise<Response> {
  const repo = demo();
  if (!repo) return new Response('Solo en la demo.', { status: 404 });
  prepararSimulado(base);
  const sim = simuladorDelServidor(base);
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const cuentas = repo.canalesWhatsappDemo().map((c) => {
      const clave = sim.claveDeBot(c.idPublico);
      return { ...c, simulada: !!clave, revocada: clave ? sim.estaRevocada(clave) : false };
    });
    const bot = idPublico.safeParse(u.searchParams.get('bot'));
    const tel = telefono.safeParse(u.searchParams.get('telefono') ?? '');
    const clave = bot.success ? sim.claveDeBot(bot.data) : null;
    const crudos = clave && tel.success ? sim.conversacion(clave, tel.data) : [];
    // Las plantillas llegan con su texto completo, como las ve la persona.
    const bp = bot.success ? await repo.botPublico(bot.data) : null;
    const plantillas = bp ? await repo.plantillas(bp.bot.id) : [];
    const mensajes = crudos.map((m) => {
      if (m.mensaje.type !== 'template') return m;
      const t = m.mensaje.template;
      const pl = plantillas.find((x) => x.nombre === t.name && x.idioma === t.language.code);
      const valores = Object.fromEntries((t.components?.[0]?.parameters ?? []).map((x, i) => [x.parameter_name ?? pl?.variables[i] ?? String(i + 1), x.text]));
      return { ...m, textoPlantilla: pl ? completarPlantilla(pl.texto, valores) : `[plantilla ${t.name}]` };
    });
    const c = bot.success && tel.success ? await conversacionDe(repo, bot.data, tel.data) : null;
    return Response.json({ cuentas, mensajes, conversacion: c ? { estado: c.estado, ventanaHasta: c.ventanaHasta ?? null } : null }, { headers: SIN_CACHE });
  }
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'datos' }, { status: 400 });
  }
  const p = esquemaPedidoTelefono.safeParse(cuerpo);
  if (!p.success) return Response.json({ ok: false, error: 'datos' }, { status: 400 });
  const x = p.data;
  const clave = sim.claveDeBot(x.bot);
  if (!clave) return Response.json({ ok: false, error: 'sin_cuenta' }, { status: 404 });
  switch (x.accion) {
    case 'escribir':
      return Response.json({ ok: true, aviso: await sim.escribir(clave, x.telefono, x.nombre?.trim() || null, x.contenido) }, { headers: SIN_CACHE });
    case 'reintentar':
      return Response.json({ ok: true, aviso: await sim.reintentarUltimo(clave, x.telefono) }, { headers: SIN_CACHE });
    case 'revocar':
      sim.revocar(clave, x.revocada);
      return Response.json({ ok: true }, { headers: SIN_CACHE });
    case 'cerrar_ventana': {
      const c = await conversacionDe(repo, x.bot, x.telefono);
      if (c) repo.cerrarVentana(c.id);
      return Response.json({ ok: !!c }, { headers: SIN_CACHE });
    }
    case 'decidir_plantillas':
      sim.decidirYa(clave);
      return Response.json({ ok: true }, { headers: SIN_CACHE });
  }
}
