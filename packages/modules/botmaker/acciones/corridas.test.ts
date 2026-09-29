import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { compararCorridas } from '../dominio/corridas';
import { diferencias } from '../dominio/diferencias';
import { validarDefinicion, type Definicion } from '../dominio/definicion';
import type { MotorFuncion } from '../dominio/tipos';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { rolEfectivo } from './comun';
import type { ContextoNucleo } from './ejecutar-bots';
import { ejecutarCambio } from './ejecutar-borrador';
import { ejecutarAvanzarCorrida, ejecutarCancelarCorrida, ejecutarIniciarCorrida } from './ejecutar-corridas';
import { ejecutarAprobarPublicacion, ejecutarDevolverPublicacion, ejecutarPedirPublicacion } from './ejecutar-publicacion';

const CAMPANA = 'c-pa-2029';
let repo: RepositorioDemo;
const como = (p: string): ContextoNucleo & { campana: { nombre: string } } => ({ repo, rol: rolEfectivo(nucleoMemoria(), p, CAMPANA), personaId: p, campanaId: CAMPANA, campana: { nombre: 'Generales 2029' } });
const fabrica = (motores?: MotorFuncion[]) => new CapaMotores({
  repo: motores ? { ...repo, fichas: () => repo.fichas(), topesBot: (id) => repo.topesBot(id), gastoBot: (a, b, c) => repo.gastoBot(a, b, c), registrarLlamada: (l) => repo.registrarLlamada(l), motoresDeBot: async () => motores } : repo,
  adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true,
});

async function correrTodo(p: string, botId: string, motores?: Parameters<typeof ejecutarIniciarCorrida>[1]['motores']) {
  const i = await ejecutarIniciarCorrida(como(p), { botId, motores });
  if (i.tipo !== 'ok') throw new Error(i.codigo);
  let vueltas = 0;
  for (;;) {
    const a = await ejecutarAvanzarCorrida(como(p), fabrica, { corridaId: i.corridaId! });
    if (a.tipo !== 'ok') throw new Error(a.codigo);
    if (a.terminada) break;
    if (++vueltas > 100) throw new Error('no termina');
  }
  return (await repo.corrida(i.corridaId!))!;
}

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
});

describe('corridas de prueba', () => {
  it('una corrida sobre la plantilla termina con el resultado de cada caso y su costo', async () => {
    const r = await correrTodo('p-lucia', 'bot-demo-1');
    expect(r.estado).toBe('terminada');
    expect(r.resultados).toHaveLength(46);
    expect(r.resumen).toMatchObject({ casos: 46, intencion: expect.objectContaining({ casos: 46 }) });
    expect(r.resumen!.intencion.porReglas).toBeGreaterThan(0);
    expect(r.etiqueta).toMatch(/^Motores del bot · Interpretar: Gemini 3.1 Flash-Lite \+ gpt-oss-120b \(Groq\) \(doble lectura\)/);
    expect(typeof r.resumen!.costoUsd).toBe('number');
  });

  it('el set de la prueba de motores en el bot 2: intenciones y preguntas con base', async () => {
    const r = await correrTodo('p-joaquin', 'bot-demo-2');
    expect(r.resumen!.intencion.casos).toBe(218);
    expect(r.resumen!.base.casos).toBe(72);
    const base = r.resultados.find((x) => x.tipo === 'base' && x.ok !== null)!;
    expect(base.resultado).toHaveProperty('secciones');
  });

  it('la misma corrida con otros motores se compara caso por caso', async () => {
    const a = await correrTodo('p-lucia', 'bot-demo-1');
    const b = await correrTodo('p-lucia', 'bot-demo-1', { interpretar: { principal: 'gpt-oss-120b', respaldo: null, dobleLectura: false } });
    expect(b.etiqueta).toBe('Interpretar: gpt-oss-120b (Groq) · Responder: Gemini 3.1 Flash-Lite > Claude Haiku 4.5');
    const c = compararCorridas(a.resultados, b.resultados);
    expect(c.enComun).toBe(46);
    expect(c.mejoran.length + c.empeoran.length).toBeLessThanOrEqual(46);
  });

  it('solo editor y administrador; un motor que no sirve se rechaza; sin casos no corre', async () => {
    expect((await ejecutarIniciarCorrida(como('p-equipo'), { botId: 'bot-demo-1' })).codigo).toBe('sin_permiso');
    expect((await ejecutarIniciarCorrida(como('p-lucia'), { botId: 'bot-demo-1', motores: { responder: { principal: 'gpt-oss-20b', respaldo: null } } })).codigo).toBe('motor_funcion');
    await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: [{ tipo: 'cargar_casos', texto: 'Hola | cortesia', reemplazar: true }, ...Array.from({ length: 1 }, () => ({ tipo: 'quitar_caso', caso: 'c047' }))], origen: 'editor' });
    expect((await ejecutarIniciarCorrida(como('p-lucia'), { botId: 'bot-demo-1' })).codigo).toBe('sin_casos');
  });

  it('si el borrador cambia en el medio, la corrida se cancela; también se puede cancelar a mano', async () => {
    const i = await ejecutarIniciarCorrida(como('p-lucia'), { botId: 'bot-demo-1' });
    await ejecutarAvanzarCorrida(como('p-lucia'), fabrica, { corridaId: i.corridaId! });
    await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: [{ tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre: 'X' } }], origen: 'editor' });
    expect((await ejecutarAvanzarCorrida(como('p-lucia'), fabrica, { corridaId: i.corridaId! })).codigo).toBe('corrida_vieja');
    expect((await repo.corrida(i.corridaId!))!.estado).toBe('cancelada');
    const j = await ejecutarIniciarCorrida(como('p-lucia'), { botId: 'bot-demo-1' });
    expect((await ejecutarCancelarCorrida(como('p-lucia'), { corridaId: j.corridaId! })).tipo).toBe('ok');
  });
});

describe('publicación', () => {
  it('pedir sin correr las pruebas no se puede; con la corrida, sí; el administrador aprueba', async () => {
    expect((await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, nota: '' })).codigo).toBe('sin_corrida');
    await correrTodo('p-lucia', 'bot-demo-1');
    expect((await ejecutarPedirPublicacion(como('p-andres'), { botId: 'bot-demo-1', seq: 0, nota: '' })).codigo).toBe('sin_permiso');
    expect(await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, nota: 'Primera versión' })).toEqual({ tipo: 'ok', codigo: 'publicacion_pedida' });
    const v = (await repo.versiones('bot-demo-1'))[0]!;
    expect(v.estado).toBe('pedida');
    expect((await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: [{ tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre: 'X' } }], origen: 'editor' }) as { codigo: string }).codigo).toBe('sin_borrador');
    expect((await ejecutarAprobarPublicacion(como('p-lucia'), { botId: 'bot-demo-1', versionId: v.id, nota: '' })).codigo).toBe('sin_permiso');
    expect(await ejecutarAprobarPublicacion(como('p-joaquin'), { botId: 'bot-demo-1', versionId: v.id, nota: 'Bien' })).toEqual({ tipo: 'ok', codigo: 'publicacion_aprobada' });
    const bot = (await repo.bot('bot-demo-1'))!;
    expect(bot).toMatchObject({ estado: 'publicado', versionPublicadaId: v.id });
    expect((await repo.eventosPublicacion('bot-demo-1')).map((x) => x.accion)).toEqual(['aprobado', 'pedido']);
  });

  it('devolver pide un comentario y deja la versión otra vez en borrador', async () => {
    await correrTodo('p-lucia', 'bot-demo-1');
    await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, nota: '' });
    const v = (await repo.versiones('bot-demo-1'))[0]!;
    expect((await ejecutarDevolverPublicacion(como('p-joaquin'), { botId: 'bot-demo-1', versionId: v.id, nota: ' ' })).codigo).toBe('falta_comentario');
    expect((await ejecutarDevolverPublicacion(como('p-joaquin'), { botId: 'bot-demo-1', versionId: v.id, nota: 'Falta el horario' })).tipo).toBe('ok');
    expect((await repo.versiones('bot-demo-1'))[0]!.estado).toBe('borrador');
  });

  it('una versión que baja 2 puntos de acierto contra la publicada no se puede pedir', async () => {
    await correrTodo('p-lucia', 'bot-demo-1');
    await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, nota: '' });
    const v1 = (await repo.versiones('bot-demo-1'))[0]!;
    await ejecutarAprobarPublicacion(como('p-joaquin'), { botId: 'bot-demo-1', versionId: v1.id, nota: '' });
    // Borrador nuevo (v2) que manda a otro lado varias intenciones: sus casos van a fallar.
    await repo.crearBorrador('bot-demo-1', null, 'p-lucia');
    const d = (await repo.borrador('bot-demo-1'))!.definicion as Definicion;
    const ops = d.intenciones.slice(1, 12).map((i) => ({ tipo: 'quitar_intencion', intencion: i.id }));
    const x = await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: ops, origen: 'editor' });
    expect(x.ok).toBe(true);
    // Casos que el motor no puede acertar: el acierto cae muy por debajo del de la v1.
    await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 1, operaciones: [{ tipo: 'cargar_casos', texto: 'Hola | fuera_de_tema\nMuchas gracias | fuera_de_tema\nBuenas tardes | fuera_de_tema', reemplazar: true }], origen: 'editor' });
    await correrTodo('p-lucia', 'bot-demo-1');
    const seq = (await repo.borrador('bot-demo-1'))!.seq;
    expect((await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq, nota: '' })).codigo).toBe('baja_acierto');
  });

  it('el validador con errores no deja pedir', async () => {
    await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: [{ tipo: 'editar_intencion', intencion: 'agenda', cambios: { destino: null } }], origen: 'editor' });
    await correrTodo('p-lucia', 'bot-demo-1');
    expect((await ejecutarPedirPublicacion(como('p-lucia'), { botId: 'bot-demo-1', seq: 1, nota: '' })).codigo).toBe('errores_validador');
  });

  it('las diferencias contra la publicada llevan las direcciones', async () => {
    const d = (await repo.borrador('bot-demo-1'))!.definicion as Definicion;
    const r = await ejecutarCambio(como('p-lucia'), { botId: 'bot-demo-1', seq: 0, operaciones: [
      { tipo: 'agregar_opcion', caja: 'n_masayuda', texto: 'Opinar', destino: null },
      { tipo: 'editar_contenido', contenido: 'c_menu', cambios: { texto: '¿Qué necesita?' } },
      { tipo: 'editar_intencion', intencion: 'agenda', cambios: { destino: 'n_masayuda' } },
    ], origen: 'editor' });
    if (!r.ok) throw new Error(r.codigo);
    const dif = diferencias(validarDefinicion(d).ok ? d : null, r.definicion).map((x) => `${x.tipo} ${x.parte} ${x.donde}: ${x.detalle}`);
    expect(dif).toEqual(expect.arrayContaining([
      'cambiado caja 2.2: Algo más: opciones nuevas: 2.2 › C',
      'cambiado contenido Menú principal: "¿Qué necesita?"',
      'cambiado intención Agenda: ahora va a 2.2',
    ]));
    expect(diferencias(null, r.definicion).filter((x) => x.parte === 'caja').every((x) => x.tipo === 'agregado')).toBe(true);
  });
});
