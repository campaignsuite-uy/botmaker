import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { rolEfectivo, rutaVolver } from './comun';
import {
  ejecutarArchivarBot, ejecutarCrearBot, ejecutarGuardarBot, ejecutarGuardarDatosPersonales, ejecutarGuardarMotores, ejecutarProbarMotor, type ContextoNucleo,
} from './ejecutar-bots';
import { ejecutarRolEquipo } from './ejecutar-equipo';

const CAMPANA = 'c-pa-2029';
const fd = (x: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(x)) f.set(k, v);
  return f;
};

let repo: RepositorioDemo;
const como = (personaId: string): ContextoNucleo => ({ repo, rol: rolEfectivo(nucleoMemoria(), personaId, CAMPANA), personaId, campanaId: CAMPANA, campana: { nombre: 'Generales 2029' } });
const nuevo = (extra: Record<string, string> = {}) => fd({ nombre: 'Bot nuevo', caso: 'electoral', mercado: 'PA', trato: 'usted', candidato: 'Candidata', partido: '', clave: randomUUID(), ...extra });

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
});

describe('roles de la demo', () => {
  it('cascada y accesos', () => {
    expect(como('p-joaquin').rol).toBe('administrador');
    expect(como('p-lucia').rol).toBe('editor');
    expect(como('p-andres').rol).toBe('agente');
    expect(como('p-equipo').rol).toBe('lector');
    expect(como('p-mariana').rol).toBeNull();
  });
});

describe('crear bot', () => {
  it('lo crean el editor y el administrador; los demás no', async () => {
    expect((await ejecutarCrearBot(como('p-lucia'), nuevo())).tipo).toBe('ok');
    expect((await ejecutarCrearBot(como('p-joaquin'), nuevo())).tipo).toBe('ok');
    for (const p of ['p-andres', 'p-equipo', 'p-mariana']) expect((await ejecutarCrearBot(como(p), nuevo())).codigo).toBe('sin_permiso');
  });
  it('el repositorio vuelve a exigir el permiso aunque el servidor se equivoque (tercera capa)', async () => {
    const trucho = { ...como('p-andres'), rol: 'editor' as const };
    expect((await ejecutarCrearBot(trucho, nuevo())).codigo).toBe('sin_permiso');
  });
  it('con la misma clave no crea dos bots', async () => {
    const clave = randomUUID();
    const a = await ejecutarCrearBot(como('p-lucia'), nuevo({ clave }));
    const b = await ejecutarCrearBot(como('p-lucia'), nuevo({ clave }));
    expect(a.botId).toBe(b.botId);
    expect((await repo.bots(CAMPANA)).filter((x) => x.nombre === 'Bot nuevo').length).toBe(1);
  });
  it('valida los datos y copia los motores por defecto', async () => {
    expect((await ejecutarCrearBot(como('p-lucia'), nuevo({ nombre: '' }))).codigo).toBe('nombre_vacio');
    expect((await ejecutarCrearBot(como('p-lucia'), nuevo({ mercado: 'AR' }))).codigo).toBe('mercado');
    expect((await ejecutarCrearBot(como('p-lucia'), nuevo({ clave: 'x' }))).codigo).toBe('datos');
    const s = await ejecutarCrearBot(como('p-lucia'), nuevo());
    const m = await repo.motoresDeBot(s.botId!);
    expect(m.map((x) => [x.funcion, x.principal, x.respaldo, x.dobleLectura])).toEqual([
      ['interpretar', 'gemini-3.1-flash-lite', 'gpt-oss-120b', true], ['responder', 'gemini-3.1-flash-lite', 'claude-haiku-4.5', false], ['copiloto', 'claude-sonnet-5', 'gpt-oss-120b', false],
    ]);
  });
});

describe('ajustes del bot', () => {
  it('datos generales: editor sí, agente no', async () => {
    expect((await ejecutarGuardarBot(como('p-lucia'), fd({ botId: 'bot-demo-1', nombre: 'Renombrado', caso: 'politico', mercado: 'UY', trato: 'tu', avisoIa: '' }))).tipo).toBe('ok');
    expect((await repo.bot('bot-demo-1'))?.mercado).toBe('UY');
    expect((await ejecutarGuardarBot(como('p-andres'), fd({ botId: 'bot-demo-1', nombre: 'X', caso: 'politico', mercado: 'UY', trato: 'tu' }))).codigo).toBe('sin_permiso');
  });
  it('un bot de otra campaña no existe para esta', async () => {
    expect((await ejecutarGuardarBot({ ...como('p-lucia'), campanaId: 'otra' }, fd({ botId: 'bot-demo-1', nombre: 'X', caso: 'politico', mercado: 'UY', trato: 'tu' }))).codigo).toBe('no_existe');
    expect((await ejecutarGuardarBot(como('p-lucia'), fd({ botId: 'no-existe', nombre: 'X', caso: 'politico', mercado: 'UY', trato: 'tu' }))).codigo).toBe('no_existe');
  });
  it('motores y topes: solo el administrador; valida función, respaldo y topes', async () => {
    const base = { botId: 'bot-demo-1', principal_interpretar: 'claude-haiku-4.5', respaldo_interpretar: 'gpt-oss-120b', topeDiario: '3,5', topeMensual: '50' };
    expect((await ejecutarGuardarMotores(como('p-lucia'), fd(base))).codigo).toBe('sin_permiso');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd(base))).tipo).toBe('ok');
    const b = await repo.bot('bot-demo-1');
    expect([b?.topeDiarioUsd, b?.topeMensualUsd]).toEqual([3.5, 50]);
    expect((await repo.motoresDeBot('bot-demo-1'))[0]).toMatchObject({ principal: 'claude-haiku-4.5', respaldo: 'gpt-oss-120b' });
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, principal_copiloto: 'gemini-3.1-flash-lite' }))).codigo).toBe('motor_funcion');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, principal_copiloto: 'ministral-8b' }))).codigo).toBe('motor');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, respaldo_interpretar: '', doble_interpretar: 'si' }))).codigo).toBe('doble_lectura');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, doble_interpretar: 'si' }))).tipo).toBe('ok');
    expect((await repo.motoresDeBot('bot-demo-1'))[0]).toMatchObject({ funcion: 'interpretar', dobleLectura: true });
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd(base))).tipo).toBe('ok');
    expect((await repo.motoresDeBot('bot-demo-1'))[0]).toMatchObject({ dobleLectura: false });
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, respaldo_interpretar: 'claude-haiku-4.5' }))).codigo).toBe('respaldo_igual');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, topeDiario: '80' }))).codigo).toBe('tope_diario_mayor');
    expect((await ejecutarGuardarMotores(como('p-joaquin'), fd({ ...base, topeDiario: 'mucho' }))).codigo).toBe('tope');
  });
  it('datos personales: solo el administrador', async () => {
    expect((await ejecutarGuardarDatosPersonales(como('p-lucia'), fd({ botId: 'bot-demo-1', personalizacion: 'si', dias: '30' }))).codigo).toBe('sin_permiso');
    expect((await ejecutarGuardarDatosPersonales(como('p-joaquin'), fd({ botId: 'bot-demo-1', personalizacion: 'si', dias: '30' }))).tipo).toBe('ok');
    expect((await ejecutarGuardarDatosPersonales(como('p-joaquin'), fd({ botId: 'bot-demo-1', dias: '900' }))).codigo).toBe('dias');
    expect((await repo.bot('bot-demo-1'))).toMatchObject({ personalizacion: true, diasGuardado: 30 });
  });
  it('archivar: solo el administrador, con confirmación; archivado no se cambia', async () => {
    expect((await ejecutarArchivarBot(como('p-lucia'), fd({ botId: 'bot-demo-1', confirmar: 'si' }))).codigo).toBe('sin_permiso');
    expect((await ejecutarArchivarBot(como('p-joaquin'), fd({ botId: 'bot-demo-1' }))).codigo).toBe('datos');
    expect((await ejecutarArchivarBot(como('p-joaquin'), fd({ botId: 'bot-demo-1', confirmar: 'si' }))).tipo).toBe('ok');
    expect((await ejecutarGuardarBot(como('p-lucia'), fd({ botId: 'bot-demo-1', nombre: 'X', caso: 'politico', mercado: 'UY', trato: 'tu' }))).codigo).toBe('archivado');
    expect((await repo.bots(CAMPANA)).some((b) => b.id === 'bot-demo-1')).toBe(false);
  });
  it('probar un motor: solo el administrador; queda como uso pruebas', async () => {
    const capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
    expect((await ejecutarProbarMotor(como('p-lucia'), capa, fd({ botId: 'bot-demo-1', funcion: 'interpretar', motor: 'gpt-oss-120b' }))).codigo).toBe('sin_permiso');
    const s = await ejecutarProbarMotor(como('p-joaquin'), capa, fd({ botId: 'bot-demo-1', funcion: 'interpretar', motor: 'gpt-oss-120b' }));
    expect(s.tipo).toBe('ok');
    expect(s.extra?.detalle).toMatch(/Intención: tramite_electoral/);
    expect((await repo.llamadas(CAMPANA, { limite: 1 }))[0]).toMatchObject({ uso: 'pruebas', personaId: 'p-joaquin' });
    expect((await ejecutarProbarMotor(como('p-joaquin'), capa, fd({ botId: 'bot-demo-1', funcion: 'copiloto', motor: 'gemini-3.1-flash-lite' }))).codigo).toBe('motor_funcion');
    expect((await ejecutarProbarMotor(como('p-joaquin'), capa, fd({ botId: 'bot-demo-1', funcion: 'interpretar', motor: 'ministral-8b' }))).codigo).toBe('motor');
  });
});

describe('equipo y roles', () => {
  it('el administrador da un rol a una integrante sin acceso; entra con ese rol', async () => {
    expect((await ejecutarRolEquipo(como('p-joaquin'), nucleoMemoria(), fd({ personaId: 'p-mariana', rol: 'lector' }))).codigo).toBe('rol_guardado');
    expect(como('p-mariana').rol).toBe('lector');
    expect((await ejecutarRolEquipo(como('p-joaquin'), nucleoMemoria(), fd({ personaId: 'p-mariana', rol: '' }))).codigo).toBe('sin_acceso');
    expect(como('p-mariana').rol).toBeNull();
  });
  it('el editor no arma el equipo; el rol del Dueño no se cambia; roles desconocidos no', async () => {
    expect((await ejecutarRolEquipo(como('p-lucia'), nucleoMemoria(), fd({ personaId: 'p-mariana', rol: 'lector' }))).codigo).toBe('sin_permiso');
    expect((await ejecutarRolEquipo(como('p-joaquin'), nucleoMemoria(), fd({ personaId: 'p-joaquin', rol: 'lector' }))).codigo).toBe('admin_campana');
    expect((await ejecutarRolEquipo(como('p-joaquin'), nucleoMemoria(), fd({ personaId: 'p-mariana', rol: 'revisor' }))).codigo).toBe('rol');
    expect((await ejecutarRolEquipo(como('p-joaquin'), nucleoMemoria(), fd({ personaId: 'nadie', rol: 'lector' }))).codigo).toBe('no_integrante');
  });
});

describe('ruta de vuelta', () => {
  it('solo rutas internas', () => {
    const v = (x: string) => rutaVolver(fd({ volver: x }));
    expect(v('/otro-camino/pa-2029/bots?ok=1#datos')).toBe('/otro-camino/pa-2029/bots?ok=1#datos');
    for (const mala of ['//evil.com', '/\\evil.com', '/\tevil.com', 'https://evil.com', 'evil', '/a\u0000b']) expect(v(mala)).toBe('/');
  });
});
