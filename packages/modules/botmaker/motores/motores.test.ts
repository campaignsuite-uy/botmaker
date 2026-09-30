import { describe, expect, it } from 'vitest';
import { contratoInterpretar, contratoResponder, contratoCopiloto, extraerJson } from './contratos';
import { marcarDatosPersonales } from './marcas';
import { interpretarSimulado, responderSimulado } from './simulado';
import { ENTRADA_PRUEBA } from './prueba';
import { claveOpenRouter, simularMotores } from './claves';
import { instruccionesInterpretar, instruccionesResponder } from './prompts';

describe('marcas de datos personales', () => {
  it('teléfonos, correos y cédulas', () => {
    const t = marcarDatosPersonales('Soy Ana, mi cel es 6123-4567 o +507 6123 4567, correo ana.p@correo.com.pa, cédula 8-123-4567. En Uruguay 1.234.567-8.');
    expect(t.texto).toBe('Soy Ana, mi cel es [TELÉFONO] o [TELÉFONO], correo [CORREO], cédula [DOCUMENTO]. En Uruguay [DOCUMENTO].');
    expect(t.marcas).toEqual({ correo: 1, telefono: 2, documento: 2 });
  });
  it('no toca años, montos cortos ni horas', () => {
    const t = marcarDatosPersonales('En 2029 voto a las 10:30, me cobraron B/. 1.500 y vivo en la calle 50');
    expect(t.texto).toBe('En 2029 voto a las 10:30, me cobraron B/. 1.500 y vivo en la calle 50');
  });
});

describe('contratos', () => {
  const c = contratoInterpretar(ENTRADA_PRUEBA.interpretar);
  it('interpretar normaliza y valida contra el catálogo', () => {
    const v = c.zod.safeParse({ intencion: ' Tramite_Electoral ', tema: 'ninguno', confianza: '0.8', alternativas: [{ intencion: 'saludo', tema: 'ninguno', confianza: 0.1 }, { intencion: 'inventada', tema: 'x', confianza: 1 }, { intencion: 'otra', tema: 'ninguno', confianza: 0.1 }, { intencion: 'propuesta', tema: 'empleo', confianza: 0.1 }] });
    expect(v.success).toBe(true);
    expect(v.data?.intencion).toBe('tramite_electoral');
    expect(v.data?.confianza).toBe(0.8);
    expect(v.data?.alternativas.map((a) => a.intencion)).toEqual(['saludo', 'otra']);
  });
  it('interpretar rechaza una intención fuera del catálogo o una confianza fuera de rango', () => {
    expect(c.zod.safeParse({ intencion: 'nada', tema: 'ninguno', confianza: 0.5, alternativas: [] }).success).toBe(false);
    expect(c.zod.safeParse({ intencion: 'saludo', tema: 'ninguno', confianza: 3, alternativas: [] }).success).toBe(false);
  });
  it('responder y copiloto', () => {
    expect(contratoResponder.zod.parse({ respuesta: 'Hola', secciones: ['s01 '], tiene_respuesta: 'Sí' })).toEqual({ respuesta: 'Hola', secciones: ['S01'], tiene_respuesta: 'si' });
    const p = contratoCopiloto.zod.parse({ operaciones: [{ tipo: 'agregar_caja', datos_json: '{"texto":"Hola"}', explicacion: 'x' }], explicacion: 'e', dudas: [] });
    expect(p.operaciones[0]!.datos).toEqual({ texto: 'Hola' });
  });
  it('extraerJson saca cercos y texto alrededor', () => {
    expect(extraerJson('Acá va:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => extraerJson('sin json')).toThrow();
  });
  it('el esquema JSON es estricto (additionalProperties false, todo requerido)', () => {
    const s = c.esquema.schema as { additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['intencion', 'tema', 'confianza', 'alternativas']);
  });
});

describe('motor simulado', () => {
  it('interpreta por palabras y es determinista', () => {
    const a = interpretarSimulado(ENTRADA_PRUEBA.interpretar);
    expect(a.intencion).toBe('tramite_electoral');
    expect(interpretarSimulado(ENTRADA_PRUEBA.interpretar)).toEqual(a);
  });
  it('responde con la sección que más coincide o dice que no tiene el dato', () => {
    expect(responderSimulado(ENTRADA_PRUEBA.responder).secciones).toEqual(['S01']);
    expect(responderSimulado({ ...ENTRADA_PRUEBA.responder, pregunta: 'zzzz qqqq' }).tiene_respuesta).toBe('no');
  });
});

describe('claves e instrucciones', () => {
  it('una clave por uso; el simulador y el copiloto comparten', () => {
    const e = { BOTS_OPENROUTER_API_KEY_VIVO: 'a', BOTS_OPENROUTER_API_KEY_COPILOTO: 'b', BOTS_OPENROUTER_API_KEY_FONDO: ' ' };
    expect(claveOpenRouter('en_vivo', e)).toBe('a');
    expect(claveOpenRouter('simulador', e)).toBe('b');
    expect(claveOpenRouter('pruebas', e)).toBeNull();
  });
  it('simular: por defecto en la demo, nunca con BOTS_SIMULAR=0', () => {
    expect(simularMotores({})).toBe(true);
    expect(simularMotores({ CAMPAIGNSUITE_DATOS: 'supabase' })).toBe(false);
    expect(simularMotores({ CAMPAIGNSUITE_DATOS: 'demo', BOTS_SIMULAR: '0' })).toBe(false);
    expect(simularMotores({ CAMPAIGNSUITE_DATOS: 'supabase', BOTS_SIMULAR: '1' })).toBe(true);
  });
  it('las instrucciones llevan el catálogo, los modismos del mercado y el material primero', () => {
    const ctx = { nombreBot: 'Asistente', campana: 'Panamá · Pruebas', mercado: 'PA', caso: 'electoral' as const, trato: 'usted' as const };
    const i = instruccionesInterpretar(ctx, ENTRADA_PRUEBA.interpretar);
    expect(i.sistema).toContain('- tramite_electoral:');
    expect(i.sistema).toContain('xopá');
    expect(i.usuario).toContain('MENSAJE A CLASIFICAR');
    const r = instruccionesResponder(ctx, ENTRADA_PRUEBA.responder);
    expect(r.sistema.startsWith('## MATERIAL')).toBe(true);
    expect(r.sistema).toContain('### S01');
    expect(i.sistema).not.toContain('Quién es quién');
  });
  it('interpretar sabe cómo le dice la gente al partido y los límites de cada intención', () => {
    const ctx = {
      nombreBot: 'Asistente', campana: 'Panamá · Pruebas', mercado: 'PA', caso: 'electoral' as const, trato: 'usted' as const,
      identidad: { candidato: { nombre: 'Ricardo Lombana', alias: [] }, partido: { nombre: 'Movimiento Otro Camino', alias: ['MOCA', 'Otro Camino'] } },
    };
    const entrada = { ...ENTRADA_PRUEBA.interpretar, intenciones: [{ id: 'partido', descripcion: 'El partido.', limite: 'Trámites del organismo electoral van en tramite_electoral.' }, { id: 'otra', descripcion: 'Otra cosa.' }] };
    const i = instruccionesInterpretar(ctx, entrada);
    expect(i.sistema).toContain('El partido es Movimiento Otro Camino (también le dicen «MOCA», «Otro Camino»)');
    expect(i.sistema).toContain('- partido: El partido. Trámites del organismo electoral van en tramite_electoral.');
  });
});
