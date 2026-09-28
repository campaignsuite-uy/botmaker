import { describe, expect, it } from 'vitest';
import { avisosMotores, exigeAvisoIa } from './avisos';
import { esquemaNuevoBot, esquemaTopes } from './bots';
import { costoEstimado, fichaMotor, FICHAS_MOTORES, MOTORES_POR_DEFECTO, motoresPara } from './motores';
import { ACCIONES, ACCIONES_DE_LECTURA, MATRIZ, puede } from './permisos';
import { usd, fechaHoraUtc, sumarDias } from './formato';

describe('matriz de permisos', () => {
  it('el administrador puede todo', () => {
    for (const a of ACCIONES) expect(puede('administrador', a)).toBe(true);
  });
  it('el observador de una demo solo lee', () => {
    for (const a of ACCIONES) expect(puede('observador', a)).toBe(ACCIONES_DE_LECTURA.includes(a));
  });
  it('el lector solo ve', () => {
    expect(ACCIONES.filter((a) => puede('lector', a))).toEqual(['ver']);
  });
  it('coincide con la definición: agente atiende, editor arma, nadie más que el administrador publica', () => {
    expect(MATRIZ.responder_conversaciones).toEqual(['administrador', 'agente']);
    expect(MATRIZ.editar_borrador).toEqual(['administrador', 'editor']);
    expect(MATRIZ.publicar).toEqual(['administrador']);
    expect(puede('editor', 'leer_conversaciones')).toBe(true);
    expect(puede('editor', 'ver_costos')).toBe(false);
  });
  it('sin rol no se puede nada', () => {
    for (const a of ACCIONES) expect(puede(null, a)).toBe(false);
  });
});

describe('motores', () => {
  it('los por defecto existen, están activos y sirven para su función', () => {
    for (const m of MOTORES_POR_DEFECTO) {
      for (const id of [m.principal, m.respaldo]) {
        const f = fichaMotor(id!);
        expect(f?.activo).toBe(true);
        expect(f?.funciones).toContain(m.funcion);
      }
      expect(fichaMotor(m.principal)!.empresa).not.toBe(fichaMotor(m.respaldo!)!.empresa);
    }
  });
  it('no hay modelos de OpenAI por API ni ids repetidos', () => {
    expect(FICHAS_MOTORES.some((f) => f.modelo.startsWith('openai/gpt-') && !f.modelo.includes('oss'))).toBe(false);
    expect(new Set(FICHAS_MOTORES.map((f) => f.id)).size).toBe(FICHAS_MOTORES.length);
  });
  it('motoresPara incluye el simulado', () => {
    expect(motoresPara('copiloto').map((f) => f.id)).toContain('simulado');
  });
  it('costo estimado con caché', () => {
    const haiku = fichaMotor('claude-haiku-4.5')!;
    expect(costoEstimado(haiku, { entrada: 1_000_000, salida: 0 })).toBeCloseTo(1);
    expect(costoEstimado(haiku, { entrada: 1_000_000, salida: 0, cache: 1_000_000 })).toBeCloseTo(0.1);
  });
});

describe('avisos de motores', () => {
  const defecto = MOTORES_POR_DEFECTO.map((m) => ({ ...m }));
  it('Claude exige aviso de IA y lo dice', () => {
    const a = avisosMotores({ caso: 'electoral', personalizacion: false }, defecto);
    expect(a.some((x) => /Claude Haiku 4.5 exige avisar/.test(x.texto))).toBe(true);
    expect(exigeAvisoIa(defecto)).toBe(true);
  });
  it('el copiloto no cuenta para el aviso de IA', () => {
    const soloCopiloto = [{ funcion: 'interpretar' as const, principal: 'gpt-oss-120b', respaldo: null, tiempoMaximoMs: 2500 }, { funcion: 'copiloto' as const, principal: 'claude-sonnet-5', respaldo: null, tiempoMaximoMs: 60000 }];
    expect(exigeAvisoIa(soloCopiloto)).toBe(false);
  });
  it('personalización encendida con Claude: aviso de atención, nunca bloqueo', () => {
    const a = avisosMotores({ caso: 'electoral', personalizacion: true }, defecto);
    expect(a.find((x) => /no permite personalizar/.test(x.texto))?.nivel).toBe('atencion');
  });
  it('respaldo de la misma empresa y sin respaldo', () => {
    const m = [
      { funcion: 'interpretar' as const, principal: 'claude-haiku-4.5', respaldo: 'claude-sonnet-5', tiempoMaximoMs: 2500 },
      { funcion: 'responder' as const, principal: 'gpt-oss-120b', respaldo: null, tiempoMaximoMs: 4000 },
    ];
    const a = avisosMotores({ caso: 'politico', personalizacion: false }, m);
    expect(a.some((x) => /misma empresa/.test(x.texto))).toBe(true);
    expect(a.some((x) => /no tiene motor de respaldo/.test(x.texto))).toBe(true);
  });
  it('Mistral entrena por defecto; Gemini y los menores de 18', () => {
    const m = [{ funcion: 'responder' as const, principal: 'mistral-small-4', respaldo: 'gemini-3.1-flash-lite', tiempoMaximoMs: 4000 }];
    const a = avisosMotores({ caso: 'electoral', personalizacion: false }, m);
    expect(a.some((x) => /entrenar por defecto/.test(x.texto))).toBe(true);
    expect(a.some((x) => /menores de 18/.test(x.texto))).toBe(true);
  });
});

describe('validaciones y formato', () => {
  it('nuevo bot', () => {
    expect(esquemaNuevoBot.safeParse({ nombre: ' Bot ', caso: 'electoral', mercado: 'pa', trato: 'usted' }).data).toEqual({ nombre: 'Bot', caso: 'electoral', mercado: 'PA', trato: 'usted' });
    expect(esquemaNuevoBot.safeParse({ nombre: '', caso: 'electoral', mercado: 'PA', trato: 'usted' }).error?.issues[0]?.message).toBe('nombre_vacio');
    expect(esquemaNuevoBot.safeParse({ nombre: 'x', caso: 'otro', mercado: 'PA', trato: 'usted' }).error?.issues[0]?.message).toBe('caso');
    expect(esquemaNuevoBot.safeParse({ nombre: 'x', caso: 'electoral', mercado: 'AR', trato: 'usted' }).error?.issues[0]?.message).toBe('mercado');
  });
  it('topes', () => {
    expect(esquemaTopes.safeParse({ diarioUsd: 5, mensualUsd: 100 }).success).toBe(true);
    expect(esquemaTopes.safeParse({ diarioUsd: 50, mensualUsd: 10 }).error?.issues[0]?.message).toBe('tope_diario_mayor');
    expect(esquemaTopes.safeParse({ diarioUsd: Number.NaN, mensualUsd: 10 }).success).toBe(false);
  });
  it('formato', () => {
    expect(usd(0.0123)).toBe('USD 0,0123');
    expect(usd(12.5)).toBe('USD 12,50');
    expect(fechaHoraUtc('2026-09-28T14:05:00Z')).toBe('28/9/2026 14:05 UTC');
    expect(sumarDias('2026-09-28', -30)).toBe('2026-08-29');
  });
});
