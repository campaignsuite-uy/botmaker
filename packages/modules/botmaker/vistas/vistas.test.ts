import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { rolEfectivo } from '../acciones/comun';
import type { ContextoPantalla } from '../ui/contexto';
import { vistaBot } from './bot';
import { vistaBots } from './bots';
import { vistaCostos } from './costos';
import { vistaEquipo } from './equipo';
import { datosMarco } from './marco';
import { vistaMotores } from './motores';
import { vistaNuevoBot } from './nuevo';
import { mensajeDe } from './mensajes';

let repo: RepositorioDemo;
beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
});

function ctx(personaId: string, parametros: Record<string, string> = {}, demo = false): ContextoPantalla {
  const n = nucleoMemoria();
  const p = n.personas.find((x) => x.id === personaId)!;
  return {
    persona: { id: p.id, nombre: p.nombre, iniciales: p.iniciales },
    organizacion: { slug: 'otro-camino', nombre: 'Movimiento Otro Camino', demo },
    campana: { id: 'c-pa-2029', organizacionId: 'org-moca', slug: 'pa-2029', nombre: 'Generales 2029', paisIso: 'PA', pais: 'Panamá', zonaHoraria: 'America/Panama', fechaEleccion: '2029-05-06' },
    rol: demo ? 'observador' : rolEfectivo(n, personaId, 'c-pa-2029')!,
    base: '/otro-camino/pa-2029/bots',
    plataforma: { inicio: '/otro-camino/pa-2029', configuracion: null },
    nucleo: n,
    parametros,
  };
}

describe('menú', () => {
  it('cada rol ve lo suyo', async () => {
    const items = async (p: string, demo = false) => (await datosMarco(repo, ctx(p, {}, demo))).grupos.flatMap((g) => g.items.map((i) => i.id));
    expect(await items('p-joaquin')).toEqual(['bots', 'nuevo', 'motores', 'costos', 'equipo']);
    expect(await items('p-lucia')).toEqual(['bots', 'nuevo', 'motores', 'equipo']);
    expect(await items('p-andres')).toEqual(['bots', 'motores', 'equipo']);
    expect(await items('p-equipo')).toEqual(['bots', 'motores', 'equipo']);
    expect(await items('p-joaquin', true)).toEqual(['bots', 'motores', 'costos', 'equipo']);
  });
});

describe('bots y nuevo bot', () => {
  it('lista con motores; crear solo editor y administrador, nunca en una demo', async () => {
    const v = await vistaBots(repo, ctx('p-lucia'));
    expect(v.filas.map((f) => f.nombre)).toEqual(['Consultas del partido', 'Asistente de la campaña']);
    expect(v.filas[0]!.motores[1]).toEqual({ funcion: 'Responder', texto: 'Claude Haiku 4.5' });
    expect(v.puedeCrear).toBe(true);
    expect((await vistaBots(repo, ctx('p-equipo'))).puedeCrear).toBe(false);
    expect((await vistaBots(repo, ctx('p-joaquin', {}, true))).puedeCrear).toBe(false);
    expect(vistaNuevoBot(ctx('p-lucia')).mercadoInicial).toBe('PA');
    expect(vistaNuevoBot(ctx('p-lucia')).clave).not.toBe(vistaNuevoBot(ctx('p-lucia')).clave);
  });
  it('los mensajes salen de un código, nunca de texto de la dirección', () => {
    expect(mensajeDe({ ok: 'bot_creado' })?.texto).toMatch(/creado/);
    expect(mensajeDe({ error: '<script>' })?.texto).toMatch(/No se pudo/);
  });
});

describe('ajustes del bot', () => {
  it('qué puede cambiar cada rol', async () => {
    const v = async (p: string, demo = false) => (await vistaBot(repo, ctx(p, {}, demo), 'bot-demo-2'))!;
    const admin = await v('p-joaquin');
    expect([admin.datos.editable, admin.motores.editable, admin.datosPersonales.editable, admin.puedeArchivar, !!admin.motores.gasto, !!admin.motores.probar]).toEqual([true, true, true, true, true, true]);
    const editor = await v('p-lucia');
    expect([editor.datos.editable, editor.motores.editable, editor.datosPersonales.editable, editor.puedeArchivar, !!editor.motores.gasto]).toEqual([true, false, false, false, false]);
    const lector = await v('p-equipo');
    expect([lector.datos.editable, lector.motores.editable, lector.datosPersonales.editable, lector.puedeArchivar]).toEqual([false, false, false, false]);
    const observador = await v('p-joaquin', true);
    expect([observador.datos.editable, observador.motores.editable, !!observador.motores.gasto]).toEqual([false, false, true]);
  });
  it('avisos de la ficha y aviso de IA exigido', async () => {
    const v = (await vistaBot(repo, ctx('p-joaquin'), 'bot-demo-2'))!;
    expect(v.datos.avisoIaExigido).toBe(true);
    expect(v.motores.avisos.some((a) => /menores de 18/.test(a.texto))).toBe(true);
  });
  it('un bot que no es de la campaña no se ve', async () => {
    const c = ctx('p-joaquin');
    expect(await vistaBot(repo, { ...c, campana: { ...c.campana, id: 'otra' } }, 'bot-demo-1')).toBeNull();
  });
  it('el resultado de probar un motor viene de la dirección, recortado', async () => {
    const v = (await vistaBot(repo, ctx('p-joaquin', { prueba: 'ok', motor: 'gpt-oss-120b', funcion: 'interpretar', ms: '812', usd: '0.00025', detalle: 'x'.repeat(500) }), 'bot-demo-1'))!;
    expect(v.motores.prueba).toMatchObject({ ok: true, motor: 'gpt-oss-120b (Groq)', demora: '812 ms' });
    expect(v.motores.prueba!.detalle.length).toBe(160);
  });
});

describe('motores, costos y equipo', () => {
  it('fichas y por defecto', async () => {
    const v = await vistaMotores(repo, ctx('p-equipo'));
    expect(v.porDefecto[0]).toMatchObject({ funcion: 'Interpretar', principal: 'Gemini 3.1 Flash-Lite', respaldo: 'gpt-oss-120b (Groq), en doble lectura' });
    expect(v.fichas.some((f) => f.id === 'mistral-small-4')).toBe(false);
    expect(v.fichas.find((f) => f.id === 'claude-haiku-4.5')?.avisoIa).toBe('Lo exige');
  });
  it('costos: 30 días, totales que cuadran', async () => {
    const v = await vistaCostos(repo, ctx('p-joaquin'));
    expect(v.porDia.length).toBe(30);
    const suma = (await repo.llamadas('c-pa-2029', { limite: 9999 })).reduce((a, l) => a + l.costoUsd, 0);
    expect(v.total).toBe(new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: suma < 1 ? 4 : 2 }).format(suma).replace(/^/, 'USD '));
    expect(v.ultimas.length).toBeLessThanOrEqual(25);
  });
  it('equipo: filas de la campaña, el Dueño fijo, editar solo el administrador', () => {
    const v = vistaEquipo(ctx('p-joaquin'));
    expect(v.filas.map((f) => [f.nombre, f.rolTexto])).toEqual([
      ['Joaquín Vázquez', 'Administrador, por administrar la organización'],
      ['Andrés Castillo', 'Agente'],
      ['Equipo del candidato', 'Lector'],
      ['Lucía Pérez', 'Editor'],
      ['Mariana Díaz', 'Sin acceso'],
    ]);
    expect(v.puedeEditar).toBe(true);
    expect(vistaEquipo(ctx('p-lucia')).puedeEditar).toBe(false);
    expect(v.matriz.length).toBe(12);
  });
});
