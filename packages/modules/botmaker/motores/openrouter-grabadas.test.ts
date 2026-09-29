import { describe, expect, it } from 'vitest';
import { fichaMotor } from '../dominio/motores';
import { contratoInterpretar, extraerJson } from './contratos';
import { AdaptadorOpenRouter } from './openrouter';
import { ENTRADA_PRUEBA } from './prueba';
import { errorDeRed, GRABADAS, type RespuestaGrabada } from './respuestas-openrouter';
import type { PedidoAdaptador } from './tipos';

/**
 * El adaptador contra las respuestas de la prueba de motores (1.07): éxito de cada proveedor, límites (429), sin saldo
 * (402), un cuerpo que no es JSON, JSON cortado, respuesta vacía, corte a mitad y la red caída.
 */
const ENTORNO = { BOTS_OPENROUTER_API_KEY_VIVO: 'clave-de-prueba', BOTS_OPENROUTER_API_KEY_COPILOTO: 'clave-de-prueba', BOTS_OPENROUTER_API_KEY_FONDO: 'clave-de-prueba' };
const sinEspera = async () => {};

function servir(lista: (RespuestaGrabada | Error)[]) {
  const pedidos: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    pedidos.push(JSON.parse(String(init.body)));
    const r = lista.shift();
    if (!r) throw new Error('No hay más respuestas grabadas');
    if (r instanceof Error) throw r;
    return new Response(r.cuerpo, { status: r.status, headers: r.encabezados });
  }) as unknown as typeof fetch;
  return { adaptador: new AdaptadorOpenRouter({ fetch: f, entorno: ENTORNO, dormir: sinEspera }), pedidos };
}

const contrato = contratoInterpretar(ENTRADA_PRUEBA.interpretar);
function pedido(motor = 'gpt-oss-120b', extra: Partial<PedidoAdaptador> = {}): PedidoAdaptador {
  return {
    ficha: fichaMotor(motor)!, funcion: 'interpretar', uso: 'en_vivo', sistema: 'S', usuario: 'U', esquema: contrato.esquema,
    maxTokens: 800, tiempoMaximoMs: 10_000, entrada: ENTRADA_PRUEBA.interpretar, ...extra,
  };
}

describe('OpenRouter con las respuestas de la prueba de motores', () => {
  it('éxito de Groq, Google y Anthropic: costo, tokens, caché, razonamiento y proveedor', async () => {
    const g = await servir([GRABADAS.exitoGroq]).adaptador.llamar(pedido());
    expect(g).toMatchObject({ ok: true, costoUsd: 0.000392, tokensEntrada: 2318, tokensRazonamiento: 38, proveedor: 'Groq', idGeneracion: 'gen-1790001001-a1b2c3' });
    expect(contrato.zod.safeParse(extraerJson(g.contenido!)).success).toBe(true);
    const gem = await servir([GRABADAS.exitoGemini]).adaptador.llamar(pedido('gemini-3.1-flash-lite'));
    expect(gem.ok).toBe(true);
    // El contenido en partes y con cerco de código se junta y se lee igual.
    expect(contrato.zod.safeParse(extraerJson(gem.contenido!))).toMatchObject({ success: true, data: { intencion: 'propuesta', tema: 'empleo' } });
    const h = await servir([GRABADAS.exitoHaikuConCache]).adaptador.llamar(pedido('claude-haiku-4.5', { funcion: 'responder' }));
    expect(h).toMatchObject({ ok: true, tokensCache: 8704, proveedor: 'Anthropic' });
  });

  it('el límite de las cuentas nuevas (429): reintenta si alcanza el tiempo; en vivo, pasa al respaldo con el motivo', async () => {
    const x = servir([GRABADAS.limiteCuentaNueva, GRABADAS.exitoHaikuConCache]);
    expect((await x.adaptador.llamar(pedido('claude-haiku-4.5'))).ok).toBe(true);
    expect(x.pedidos).toHaveLength(2);
    const y = servir([GRABADAS.limiteCuentaNueva]);
    const r = await y.adaptador.llamar(pedido('claude-haiku-4.5', { tiempoMaximoMs: 2500 }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('HTTP 429: new accounts are limited to 20 requests per minute for this model');
  });

  it('el freno de Mistral: el motivo sale de metadata.raw, sin la dirección', async () => {
    const r = await servir([GRABADAS.limiteMistral, GRABADAS.limiteMistral, GRABADAS.limiteMistral, GRABADAS.limiteMistral]).adaptador.llamar(pedido('gpt-oss-120b', { tiempoMaximoMs: 2500 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^HTTP 429: Mistral: mistralai\/mistral-small-4 is temporarily rate-limited upstream/);
    expect(r.error).not.toContain('https://');
  });

  it('sin saldo (402) no se reintenta; el presupuesto en vuelo sí', async () => {
    const x = servir([GRABADAS.sinSaldo]);
    const r = await x.adaptador.llamar(pedido());
    expect(r.error).toMatch(/^Sin saldo o tope de la clave alcanzado en OpenRouter \(402\)/);
    expect(x.pedidos).toHaveLength(1);
    const y = servir([GRABADAS.presupuestoEnVuelo, GRABADAS.exitoGroq]);
    expect((await y.adaptador.llamar(pedido())).ok).toBe(true);
    expect(y.pedidos).toHaveLength(2);
  });

  it('un cuerpo que no es JSON (502 con HTML) se reintenta y, si sigue, dice qué pasó sin la página', async () => {
    const x = servir([GRABADAS.puertaDeEnlace, GRABADAS.exitoGroq]);
    expect((await x.adaptador.llamar(pedido())).ok).toBe(true);
    const y = servir([GRABADAS.puertaDeEnlace, GRABADAS.puertaDeEnlace, GRABADAS.puertaDeEnlace, GRABADAS.puertaDeEnlace]);
    const r = await y.adaptador.llamar(pedido());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^HTTP 502: /);
    expect(r.error!.length).toBeLessThanOrEqual(170);
  });

  it('JSON cortado: el adaptador lo entrega con su costo y la capa no lo acepta', async () => {
    const r = await servir([GRABADAS.jsonCortado]).adaptador.llamar(pedido('gemini-3.1-flash-lite'));
    expect(r).toMatchObject({ ok: true, costoUsd: 0.0005665 });
    expect(() => extraerJson(r.contenido!)).toThrow();
  });

  it('vacía por razonar, cortada a mitad y la red caída', async () => {
    const v = await servir([GRABADAS.vaciaRazonando]).adaptador.llamar(pedido('gpt-oss-20b'));
    expect(v).toMatchObject({ ok: false, error: 'Respuesta vacía: se agotaron los tokens (probablemente razonando).', tokensRazonamiento: 800 });
    const c = await servir([GRABADAS.cortadaAMitad]).adaptador.llamar(pedido());
    expect(c).toMatchObject({ ok: false, error: 'El proveedor cortó la respuesta.' });
    const x = servir([errorDeRed(), GRABADAS.exitoGroq]);
    expect((await x.adaptador.llamar(pedido())).ok).toBe(true);
    const y = servir([errorDeRed(), errorDeRed(), errorDeRed(), errorDeRed()]);
    expect((await y.adaptador.llamar(pedido())).error).toBe('Error de red: fetch failed');
  });

  it('las respuestas no tienen textos de personas ni claves', () => {
    const todo = JSON.stringify(GRABADAS);
    expect(todo).not.toMatch(/sk-or-|Bearer|@[a-z]+\.[a-z]/i);
  });
});
