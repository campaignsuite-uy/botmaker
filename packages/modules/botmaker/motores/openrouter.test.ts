import { describe, expect, it } from 'vitest';
import { fichaMotor } from '../dominio/motores';
import { contratoInterpretar } from './contratos';
import { AdaptadorOpenRouter } from './openrouter';
import { ENTRADA_PRUEBA } from './prueba';
import type { PedidoAdaptador } from './tipos';

const ENTORNO = { BOTS_OPENROUTER_API_KEY_VIVO: 'clave-de-prueba', BOTS_OPENROUTER_API_KEY_COPILOTO: 'clave-de-prueba', BOTS_OPENROUTER_API_KEY_FONDO: 'clave-de-prueba' };
const EXITO = {
  id: 'gen-123', provider: 'Groq',
  choices: [{ finish_reason: 'stop', message: { content: '{"intencion":"saludo","tema":"ninguno","confianza":0.9,"alternativas":[]}' } }],
  usage: { prompt_tokens: 1500, completion_tokens: 40, cost: 0.000249, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 12 } },
};

/** fetch simulado: responde en orden la lista y guarda los cuerpos pedidos. */
function fetchSimulado(respuestas: { status: number; cuerpo: unknown; headers?: Record<string, string> }[]) {
  const pedidos: any[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    pedidos.push(JSON.parse(String(init.body)));
    const r = respuestas.shift();
    if (!r) throw new Error('No hay más respuestas simuladas');
    return new Response(JSON.stringify(r.cuerpo), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

function pedido(extra: Partial<PedidoAdaptador> = {}): PedidoAdaptador {
  const c = contratoInterpretar(ENTRADA_PRUEBA.interpretar);
  return {
    ficha: fichaMotor('gpt-oss-120b')!, funcion: 'interpretar', uso: 'en_vivo', sistema: 'S', usuario: 'U', esquema: c.esquema,
    maxTokens: 800, tiempoMaximoMs: 10_000, entrada: ENTRADA_PRUEBA.interpretar, ...extra,
  };
}

const sinEspera = async () => {};

describe('adaptador de OpenRouter', () => {
  it('pide esquema estricto, proveedor y razonamiento de la ficha, y lee costo y tokens', async () => {
    const { f, pedidos } = fetchSimulado([{ status: 200, cuerpo: EXITO }]);
    const r = await new AdaptadorOpenRouter({ fetch: f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido());
    expect(r.ok).toBe(true);
    expect(r.costoUsd).toBe(0.000249);
    expect(r.tokensEntrada).toBe(1500);
    expect(r.tokensRazonamiento).toBe(12);
    expect(r.proveedor).toBe('Groq');
    expect(pedidos[0].response_format.type).toBe('json_schema');
    expect(pedidos[0].response_format.json_schema.strict).toBe(true);
    expect(pedidos[0].provider).toEqual({ only: ['groq'], allow_fallbacks: false, require_parameters: true });
    expect(pedidos[0].reasoning).toEqual({ effort: 'low', exclude: true });
    expect(pedidos[0].temperature).toBe(0);
  });

  it('sin clave no llama y dice qué variable falta', async () => {
    const { f, pedidos } = fetchSimulado([]);
    const r = await new AdaptadorOpenRouter({ fetch: f, entorno: {}, dormir: sinEspera }).llamar(pedido());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('BOTS_OPENROUTER_API_KEY_VIVO');
    expect(pedidos.length).toBe(0);
  });

  it('si el proveedor no acepta el esquema, baja a JSON simple y lo recuerda', async () => {
    const rechazo = { status: 400, cuerpo: { error: { message: 'response_format json_schema not supported' } } };
    const { f, pedidos } = fetchSimulado([rechazo, rechazo, { status: 200, cuerpo: EXITO }, { status: 200, cuerpo: EXITO }]);
    const a = new AdaptadorOpenRouter({ fetch: f, entorno: ENTORNO, dormir: sinEspera });
    expect((await a.llamar(pedido())).ok).toBe(true);
    // 1: esquema con temperatura; 2: esquema sin temperatura; 3: JSON simple.
    expect(pedidos.map((p) => p.response_format?.type)).toEqual(['json_schema', 'json_schema', 'json_object']);
    expect(pedidos[1].temperature).toBeUndefined();
    await a.llamar(pedido());
    expect(pedidos[3].response_format.type).toBe('json_object');
  });

  it('reintenta un 429 si el tiempo alcanza, y no si no alcanza', async () => {
    const limite = { status: 429, cuerpo: { error: { message: 'rate limited' } } };
    let x = fetchSimulado([limite, { status: 200, cuerpo: EXITO }]);
    expect((await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido())).ok).toBe(true);
    x = fetchSimulado([limite, { status: 200, cuerpo: EXITO }]);
    const r = await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido({ tiempoMaximoMs: 800 }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('429');
    expect(x.pedidos.length).toBe(1);
  });

  it('401 y 402 no se reintentan', async () => {
    let x = fetchSimulado([{ status: 401, cuerpo: { error: { message: 'no auth' } } }]);
    let r = await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido());
    expect(r.error).toContain('401');
    x = fetchSimulado([{ status: 402, cuerpo: { error: { message: 'Insufficient credits' } } }]);
    r = await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido());
    expect(r.error).toContain('402');
    expect(x.pedidos.length).toBe(1);
  });

  it('respuesta vacía por tokens agotados y caché de Anthropic', async () => {
    const vacia = { ...EXITO, choices: [{ finish_reason: 'length', message: { content: '' } }] };
    const x = fetchSimulado([{ status: 200, cuerpo: vacia }]);
    const r = await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido({ ficha: fichaMotor('claude-haiku-4.5')! }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('tokens');
    expect(x.pedidos[0].messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('Claude Sonnet 5 va sin temperatura desde el principio', async () => {
    const x = fetchSimulado([{ status: 200, cuerpo: EXITO }]);
    await new AdaptadorOpenRouter({ fetch: x.f, entorno: ENTORNO, dormir: sinEspera }).llamar(pedido({ ficha: fichaMotor('claude-sonnet-5')! }));
    expect(x.pedidos[0].temperature).toBeUndefined();
  });
});
