import { beforeEach, describe, expect, it } from 'vitest';
import { reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CapaMotores, type PedidoCapa } from './capa';
import { ENTRADA_PRUEBA } from './prueba';
import { AdaptadorSimulado } from './simulado';
import type { Adaptador, LlamadaCruda, PedidoAdaptador } from './tipos';

const CTX = { nombreBot: 'Asistente', campana: 'Generales 2029', mercado: 'PA', caso: 'electoral' as const, trato: 'usted' as const };

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

const BIEN = { ok: true, contenido: '{"intencion":"tramite_electoral","tema":"ninguno","confianza":0.9,"alternativas":[]}' };

function pedido(extra: Partial<PedidoCapa<'interpretar'>> = {}): PedidoCapa<'interpretar'> {
  return { funcion: 'interpretar', uso: 'en_vivo', bot: { id: 'bot-demo-1', campanaId: 'c-pa-2029' }, contexto: CTX, entrada: ENTRADA_PRUEBA.interpretar, personaId: null, ...extra };
}

describe('capa de motores', () => {
  let repo: RepositorioDemo;
  beforeEach(() => {
    reiniciarNucleoMemoria();
    repo = new RepositorioDemo({ vacio: false });
  });

  it('usa el principal (gpt-oss-120b) y registra la llamada', async () => {
    const falso = new AdaptadorFalso({ 'gpt-oss-120b': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const antes = (await repo.llamadas('c-pa-2029', { botId: 'bot-demo-1', limite: 9999 })).length;
    const r = await capa.llamar(pedido());
    expect(r.salida?.intencion).toBe('tramite_electoral');
    expect(r.motorId).toBe('gpt-oss-120b');
    expect(r.respaldo).toBe(false);
    const despues = await repo.llamadas('c-pa-2029', { botId: 'bot-demo-1', limite: 9999 });
    expect(despues.length).toBe(antes + 1);
    expect(despues[0]).toMatchObject({ uso: 'en_vivo', funcion: 'interpretar', motorId: 'gpt-oss-120b', ok: true, costoUsd: 0.001 });
  });

  it('si el principal falla, responde el respaldo; se registran los dos intentos', async () => {
    const falso = new AdaptadorFalso({ 'claude-haiku-4.5': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido());
    expect(r.motorId).toBe('claude-haiku-4.5');
    expect(r.respaldo).toBe(true);
    expect(r.intentos.map((i) => i.ok)).toEqual([false, true]);
    const ult = await repo.llamadas('c-pa-2029', { botId: 'bot-demo-1', limite: 2 });
    expect(ult.map((l) => [l.motorId, l.ok, l.respaldo])).toEqual([['claude-haiku-4.5', true, true], ['gpt-oss-120b', false, false]]);
  });

  it('una salida fuera del catálogo cuenta como falla', async () => {
    const falso = new AdaptadorFalso({ 'gpt-oss-120b': { ok: true, contenido: '{"intencion":"inventada","tema":"ninguno","confianza":0.9,"alternativas":[]}' }, 'claude-haiku-4.5': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido());
    expect(r.intentos[0]?.error).toMatch(/contrato/);
    expect(r.respaldo).toBe(true);
  });

  it('si fallan los dos, no hay salida: el bot sigue con menús', async () => {
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorFalso({}), simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido());
    expect(r.salida).toBeNull();
    expect(r.motivo).toBe('fallaron');
    expect(r.intentos.length).toBe(2);
  });

  it('con el tope diario alcanzado no llama a nadie', async () => {
    const falso = new AdaptadorFalso({ 'gpt-oss-120b': BIEN });
    await repo.registrarLlamada({ botId: 'bot-demo-1', campanaId: 'c-pa-2029', uso: 'en_vivo', funcion: 'responder', motorId: 'gpt-oss-120b', modelo: 'm', proveedor: 'p', respaldo: false, ok: true, error: null, demoraMs: 1, tokensEntrada: 1, tokensSalida: 1, tokensCache: 0, tokensRazonamiento: 0, costoUsd: 5, idGeneracion: null, personaId: null });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido());
    expect(r.motivo).toBe('tope_diario');
    expect(falso.recibidos.length).toBe(0);
    // El tope es del uso en vivo: el simulador sigue andando.
    expect((await capa.llamar(pedido({ uso: 'simulador' }))).salida).not.toBeNull();
  });

  it('cambia los datos personales por marcas antes de mandar', async () => {
    const falso = new AdaptadorFalso({ 'gpt-oss-120b': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    await capa.llamar(pedido({ entrada: { ...ENTRADA_PRUEBA.interpretar, mensaje: 'Soy Ana, 6123-4567, ana@correo.com' } }));
    expect(falso.recibidos[0]!.usuario).toContain('Soy Ana, [TELÉFONO], [CORREO]');
    expect(falso.recibidos[0]!.usuario).not.toContain('6123');
  });

  it('en modo simulado todo va al simulado y queda registrado como tal', async () => {
    const falso = new AdaptadorFalso({ 'gpt-oss-120b': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: true });
    const r = await capa.llamar(pedido());
    expect(r.motorId).toBe('simulado');
    expect(r.simulado).toBe(true);
    expect(falso.recibidos.length).toBe(0);
    expect((await repo.llamadas('c-pa-2029', { limite: 1 }))[0]?.motorId).toBe('simulado');
  });

  it('probar un motor puntual salta la elección del bot y el respaldo', async () => {
    const falso = new AdaptadorFalso({ 'mistral-small-4': BIEN });
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: falso, simulado: new AdaptadorSimulado() }, simular: false });
    const r = await capa.llamar(pedido({ uso: 'pruebas', soloMotor: 'mistral-small-4' }));
    expect(r.motorId).toBe('mistral-small-4');
    expect(falso.recibidos.map((p) => p.ficha.id)).toEqual(['mistral-small-4']);
  });
});
