/**
 * Respuestas de OpenRouter para probar el adaptador (1.07), sin red y sin clave.
 *
 * De dónde salen: los casos son los que aparecieron en la prueba de motores del 28/9/2026 (informe «BotMaker · resultado
 * de la prueba de motores»). Los mensajes de error son los que quedaron registrados ahí, palabra por palabra: el límite
 * de 20 pedidos por minuto de las cuentas nuevas con los modelos de Anthropic, el freno «temporarily rate-limited
 * upstream» de Mistral y el «fetch failed» de la red. Los cuerpos completos no se guardaron en la corrida (el registro
 * tenía estado, error, tokens y costo), así que tienen la forma documentada de la API de OpenRouter, con los
 * proveedores, tokens y costos de esa prueba. Los casos de 402 (sin saldo y presupuesto en vuelo) y el error a mitad de
 * respuesta no pasaron en la prueba: son los que documenta OpenRouter.
 *
 * Nada de acá tiene textos de personas: el contenido es la salida del motor (una intención) o una respuesta inventada
 * sobre el material de prueba.
 */

export interface RespuestaGrabada {
  /** Qué caso es y de dónde sale. */
  caso: string;
  status: number;
  /** El cuerpo como texto (así se prueba también un cuerpo que no es JSON). */
  cuerpo: string;
  encabezados?: Record<string, string>;
}

const json = (x: unknown) => JSON.stringify(x);

const INTERPRETACION = json({ intencion: 'propuesta', tema: 'empleo', confianza: 0.96, alternativas: [] });

export const GRABADAS = {
  exitoGroq: {
    caso: 'gpt-oss-120b por Groq: interpretar con razonamiento bajo',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001001-a1b2c3', provider: 'Groq', model: 'openai/gpt-oss-120b', object: 'chat.completion', created: 1790001001,
      choices: [{ index: 0, finish_reason: 'stop', native_finish_reason: 'stop', message: { role: 'assistant', content: INTERPRETACION } }],
      usage: { prompt_tokens: 2318, completion_tokens: 71, total_tokens: 2389, cost: 0.000392, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 38 } },
    }),
  },
  exitoGemini: {
    caso: 'Gemini 3.1 Flash-Lite por Google AI Studio: interpretar, contenido en partes',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001002-d4e5f6', provider: 'Google AI Studio', model: 'google/gemini-3.1-flash-lite',
      choices: [{ index: 0, finish_reason: 'stop', native_finish_reason: 'STOP', message: { role: 'assistant', content: [{ type: 'text', text: '```json\n' }, { type: 'text', text: `${INTERPRETACION}\n\`\`\`` }] } }],
      usage: { prompt_tokens: 2290, completion_tokens: 42, total_tokens: 2332, cost: 0.0002416, prompt_tokens_details: { cached_tokens: 0 } },
    }),
  },
  exitoHaikuConCache: {
    caso: 'Claude Haiku 4.5 por Anthropic: responder con base, con las instrucciones en caché',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001003-g7h8i9', provider: 'Anthropic', model: 'anthropic/claude-haiku-4.5',
      choices: [{ index: 0, finish_reason: 'stop', native_finish_reason: 'end_turn', message: { role: 'assistant', content: json({ tiene_respuesta: 'si', respuesta: 'Propone extender las rutas de buses nocturnos.', secciones: ['S02'] }) } }],
      usage: { prompt_tokens: 10412, completion_tokens: 164, total_tokens: 10576, cost: 0.0023911, prompt_tokens_details: { cached_tokens: 8704 } },
    }),
  },
  limiteCuentaNueva: {
    caso: 'Anthropic por OpenRouter con una cuenta nueva: 20 pedidos por minuto por modelo (visto con Haiku 4.5 y Sonnet 5)',
    status: 429,
    cuerpo: json({ error: { message: 'new accounts are limited to 20 requests per minute for this model', code: 429 } }),
    encabezados: { 'retry-after': '3' },
  },
  limiteMistral: {
    caso: 'Mistral Small 4: OpenRouter llega con una cuenta compartida y Mistral la frena',
    status: 429,
    cuerpo: json({
      error: {
        message: 'Provider returned error', code: 429,
        metadata: {
          raw: 'mistralai/mistral-small-4 is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations',
          provider_name: 'Mistral',
        },
      },
    }),
  },
  sinSaldo: {
    caso: 'Sin saldo en OpenRouter (documentado)',
    status: 402,
    cuerpo: json({ error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } }),
  },
  presupuestoEnVuelo: {
    caso: 'Presupuesto en vuelo de OpenRouter: muchos pedidos caros a la vez (documentado; se reintenta)',
    status: 402,
    cuerpo: json({ error: { message: 'Request exceeds in-flight budget', code: 402, metadata: { limit_source: 'openrouter_in_flight_budget' } } }),
  },
  puertaDeEnlace: {
    caso: 'Un 502 con una página HTML en lugar de JSON (la puerta de enlace antes de OpenRouter)',
    status: 502,
    cuerpo: '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html>',
  },
  jsonCortado: {
    caso: 'El motor cortó el JSON por los tokens: el adaptador lo entrega y la capa no lo acepta',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001004-j1k2l3', provider: 'Google AI Studio', model: 'google/gemini-3.1-flash-lite',
      choices: [{ index: 0, finish_reason: 'length', native_finish_reason: 'MAX_TOKENS', message: { role: 'assistant', content: '{"intencion": "propuesta", "tema": "empl' } }],
      usage: { prompt_tokens: 2290, completion_tokens: 800, total_tokens: 3090, cost: 0.0005665 },
    }),
  },
  vaciaRazonando: {
    caso: 'Respuesta vacía: se le fueron los tokens razonando',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001005-m4n5o6', provider: 'Groq', model: 'openai/gpt-oss-20b',
      choices: [{ index: 0, finish_reason: 'length', native_finish_reason: 'length', message: { role: 'assistant', content: '' } }],
      usage: { prompt_tokens: 2318, completion_tokens: 800, total_tokens: 3118, cost: 0.0001848, completion_tokens_details: { reasoning_tokens: 800 } },
    }),
  },
  cortadaAMitad: {
    caso: 'El proveedor falla después de aceptar el pedido (documentado)',
    status: 200,
    cuerpo: json({
      id: 'gen-1790001006-p7q8r9', provider: 'Groq',
      choices: [{ index: 0, finish_reason: 'error', message: { role: 'assistant', content: '' }, error: { code: 502, message: 'Upstream error' } }],
      usage: { prompt_tokens: 2318, completion_tokens: 0, total_tokens: 2318, cost: 0 },
    }),
  },
} satisfies Record<string, RespuestaGrabada>;

/** El error de red que dio la prueba (Node): «fetch failed», siempre después de un rato sin red. */
export function errorDeRed(): TypeError {
  return new TypeError('fetch failed');
}
