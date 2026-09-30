import { beforeEach, describe, expect, it } from 'vitest';
import { reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CapaMotores, type PedidoCapa } from './capa';
import { ENTRADA_PRUEBA } from './prueba';
import { AdaptadorSimulado } from './simulado';
import type { Adaptador, LlamadaCruda, PedidoAdaptador } from './tipos';

const CTX = { nombreBot: 'Asistente', campana: 'Panamá · Pruebas', mercado: 'PA', caso: 'electoral' as const, trato: 'usted' as const };
const BOT = { id: 'bot-demo-1', campanaId: 'c-pa-pruebas' };

/** Adaptador que responde lo que le digan por motor y guarda lo que recibió. */
class AdaptadorFalso implements Adaptador {
  readonly ruta = 'openrouter' as const;
  recibidos: PedidoAdaptador[] = [];
  constructor(private readonly respuestas: Record<string, Partial<LlamadaCruda>>) {}
  async llamar(p: PedidoAdaptador): Promise<LlamadaCruda> {
    this.recibidos.push(p);
    const r = this.respuestas[p.ficha.id] ?? { ok: false, error: 'HTTP 503: caído' };
    return { ok: false, contenido: null, error: null, demoraMs: 100, costoUsd: 0.001, tokensEntrada: 10, tokensSalida: 5, tokensCache: 0, tokensRazonamiento: 0, proveedor: 'X', idGeneracion: 'g', ...r };
  }
}

const lee = (intencion: string, extra: Partial<LlamadaCruda> = {}) => ({ ok: true, contenido: JSON.stringify({ intencion, tema: 'ninguno', confianza: 0.95, alternativas: [] }), ...extra });
const BIEN = lee('tramite_electoral');
const RESPONDE = { ok: true, contenido: JSON.stringify({ respuesta: 'Un programa de primer empleo.', secciones: ['S01'], tiene_respuesta: 'si' }) };

function pedido(extra: Partial<PedidoCapa<'interpretar'>> = {}): PedidoCapa<'interpretar'> {
  return { funcion: 'interpretar', uso: 'en_vivo', bot: BOT, contexto: CTX, entrada: ENTRADA_PRUEBA.interpretar, personaId: null, ...extra };
}
const pedidoResponder = (): PedidoCapa<'responder'> => ({ funcion: 'responder', uso: 'en_vivo', bot: BOT, contexto: CTX, entrada: ENTRADA_PRUEBA.responder, personaId: null });

describe('capa de motores: interpretar en doble lectura (así nacen los bots)', () => {
  let repo: RepositorioDemo;
  beforeEach(() => {
    reiniciarNucleoMemoria();
    repo = new RepositorioDemo({ vacio: false });
  });
  const capaCon = (falso: Adaptador) => new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });

  it('los dos leen el mismo mensaje a la vez; si coinciden, sigue con la del principal', async () => {
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': BIEN, 'gpt-oss-120b': lee('tramite_electoral', { demoraMs: 300 }) });
    const antes = (await repo.llamadas('c-pa-pruebas', { botId: 'bot-demo-1', limite: 9999 })).length;
    const r = await capaCon(falso).llamar(pedido());
    expect(falso.recibidos.map((x) => x.ficha.id).sort()).toEqual(['gemini-3.1-flash-lite', 'gpt-oss-120b']);
    expect(r.lectura).toEqual({ principal: 'tramite_electoral', respaldo: 'tramite_electoral', resultado: 'coinciden' });
    expect(r.salida?.intencion).toBe('tramite_electoral');
    expect([r.motorId, r.respaldo]).toEqual(['gemini-3.1-flash-lite', false]);
    // La persona espera al más lento, no la suma; se pagan las dos.
    expect(r.demoraMs).toBe(300);
    expect(r.costoUsd).toBeCloseTo(0.002);
    const despues = await repo.llamadas('c-pa-pruebas', { botId: 'bot-demo-1', limite: 9999 });
    expect(despues.length).toBe(antes + 2);
  });

  it('si no coinciden, la del respaldo pasa a ser la primera alternativa', async () => {
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': BIEN, 'gpt-oss-120b': lee('propuesta') });
    const r = await capaCon(falso).llamar(pedido());
    expect(r.lectura).toEqual({ principal: 'tramite_electoral', respaldo: 'propuesta', resultado: 'distintas' });
    expect(r.salida?.intencion).toBe('tramite_electoral');
    expect(r.salida?.alternativas[0]?.intencion).toBe('propuesta');
    expect(r.motivo).toBeNull();
  });

  it('si responde uno solo, sigue con ese; una salida fuera del catálogo cuenta como falla', async () => {
    const r = await capaCon(new AdaptadorFalso({ 'gemini-3.1-flash-lite': lee('inventada'), 'gpt-oss-120b': BIEN })).llamar(pedido());
    expect(r.lectura?.resultado).toBe('una');
    expect([r.motorId, r.respaldo, r.salida?.intencion]).toEqual(['gpt-oss-120b', true, 'tramite_electoral']);
    expect(r.intentos.find((i) => i.motorId === 'gemini-3.1-flash-lite')?.error).toMatch(/contrato/);
  });

  it('si no responde ninguno, no hay salida: el bot sigue con menús', async () => {
    const r = await capaCon(new AdaptadorFalso({})).llamar(pedido());
    expect(r.salida).toBeNull();
    expect(r.motivo).toBe('fallaron');
    expect(r.lectura?.resultado).toBe('ninguna');
    expect(r.intentos.length).toBe(2);
  });

  it('con la doble lectura apagada, interpretar vuelve a principal y después respaldo', async () => {
    await repo.guardarMotores('bot-demo-1', { interpretar: { principal: 'gemini-3.1-flash-lite', respaldo: 'gpt-oss-120b', dobleLectura: false } }, null, 'p-joaquin');
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': BIEN, 'gpt-oss-120b': BIEN });
    const r = await capaCon(falso).llamar(pedido());
    expect(falso.recibidos.map((x) => x.ficha.id)).toEqual(['gemini-3.1-flash-lite']);
    expect(r.lectura).toBeNull();
  });

  it('cambia los datos personales por marcas antes de mandar, en las dos lecturas', async () => {
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': BIEN, 'gpt-oss-120b': BIEN });
    await capaCon(falso).llamar(pedido({ entrada: { ...ENTRADA_PRUEBA.interpretar, mensaje: 'Soy Ana, 6123-4567, ana@correo.com' } }));
    expect(falso.recibidos.length).toBe(2);
    for (const r of falso.recibidos) {
      expect(r.usuario).toContain('Soy Ana, [TELÉFONO], [CORREO]');
      expect(r.usuario).not.toContain('6123');
    }
  });

  it('en modo simulado los dos van al simulado; dos motores simulados pueden no coincidir en un empate', async () => {
    const falso = new AdaptadorFalso({});
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: true });
    const r = await capa.llamar(pedido());
    expect(r.motorId).toBe('simulado');
    expect(r.simulado).toBe(true);
    expect(falso.recibidos.length).toBe(0);
    expect(r.lectura?.resultado).toBe('coinciden');
    // "quiero saber" empata entre dos intenciones con una palabra cada una: cada motor desempata distinto.
    const empate = { ...ENTRADA_PRUEBA.interpretar, mensaje: 'propone algo para sumarse', intenciones: [
      { id: 'propuesta', descripcion: 'propone' }, { id: 'voluntariado', descripcion: 'sumarse' }, { id: 'otra', descripcion: 'otra' },
    ] };
    const d = await capa.llamar(pedido({ entrada: empate }));
    expect(d.lectura?.resultado).toBe('distintas');
  });
});

describe('capa de motores: en serie (responder, copiloto y probar un motor)', () => {
  let repo: RepositorioDemo;
  beforeEach(() => {
    reiniciarNucleoMemoria();
    repo = new RepositorioDemo({ vacio: false });
  });

  it('responder usa el principal (Gemini 3.1 Flash-Lite) y registra la llamada', async () => {
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': RESPONDE });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedidoResponder());
    expect([r.motorId, r.respaldo, r.lectura]).toEqual(['gemini-3.1-flash-lite', false, null]);
    expect((await repo.llamadas('c-pa-pruebas', { botId: 'bot-demo-1', limite: 1 }))[0]).toMatchObject({ uso: 'en_vivo', funcion: 'responder', motorId: 'gemini-3.1-flash-lite', ok: true, costoUsd: 0.001 });
  });

  it('si el principal falla, responde el respaldo; se registran los dos intentos y la demora se suma', async () => {
    const falso = new AdaptadorFalso({ 'claude-haiku-4.5': RESPONDE });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedidoResponder());
    expect([r.motorId, r.respaldo]).toEqual(['claude-haiku-4.5', true]);
    expect(r.intentos.map((i) => i.ok)).toEqual([false, true]);
    expect(r.demoraMs).toBe(200);
    const ult = await repo.llamadas('c-pa-pruebas', { botId: 'bot-demo-1', limite: 2 });
    expect(ult.map((l) => [l.motorId, l.ok, l.respaldo])).toEqual([['claude-haiku-4.5', true, true], ['gemini-3.1-flash-lite', false, false]]);
  });

  it('con el tope diario alcanzado no llama a nadie; el simulador sigue andando', async () => {
    const falso = new AdaptadorFalso({ 'gemini-3.1-flash-lite': BIEN, 'gpt-oss-120b': BIEN });
    await repo.registrarLlamada({ botId: 'bot-demo-1', campanaId: 'c-pa-pruebas', uso: 'en_vivo', funcion: 'responder', motorId: 'gpt-oss-120b', modelo: 'm', proveedor: 'p', respaldo: false, ok: true, error: null, demoraMs: 1, tokensEntrada: 1, tokensSalida: 1, tokensCache: 0, tokensRazonamiento: 0, costoUsd: 5, idGeneracion: null, personaId: null });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido());
    expect(r.motivo).toBe('tope_diario');
    expect(falso.recibidos.length).toBe(0);
    expect((await capa.llamar(pedido({ uso: 'simulador' }))).salida).not.toBeNull();
  });

  it('probar un motor puntual salta la elección del bot, el respaldo y la doble lectura', async () => {
    const falso = new AdaptadorFalso({ 'claude-haiku-4.5': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido({ uso: 'pruebas', soloMotor: 'claude-haiku-4.5' }));
    expect(r.motorId).toBe('claude-haiku-4.5');
    expect(r.lectura).toBeNull();
    expect(falso.recibidos.map((p) => p.ficha.id)).toEqual(['claude-haiku-4.5']);
  });
});
