import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { rolEfectivo } from './comun';
import type { ContextoNucleo } from './ejecutar-bots';
import { ejecutarCambio } from './ejecutar-borrador';
import { ejecutarTurnoSimulador, type ResultadoSimulador } from './ejecutar-simulador';

const CAMPANA = 'c-pa-2029';
const BOT = 'bot-demo-1';
let repo: RepositorioDemo;
let capa: CapaMotores;
const como = (p: string): ContextoNucleo & { campana: { nombre: string } } => ({ repo, rol: rolEfectivo(nucleoMemoria(), p, CAMPANA), personaId: p, campanaId: CAMPANA, campana: { nombre: 'Generales 2029' } });

type Ok = Extract<ResultadoSimulador, { ok: true }>;
async function conversar(pasos: (string | { letra: string } | 'inicio')[], opciones: { horario?: 'dentro' | 'fuera'; persona?: string } = {}) {
  let sesion: unknown = null;
  let ultimo: Ok | null = null;
  const todos: Ok[] = [];
  for (const p of pasos) {
    let entrada: unknown;
    if (p === 'inicio') entrada = { tipo: 'inicio' };
    else if (typeof p === 'string') entrada = { tipo: 'texto', texto: p };
    else {
      const m = [...(ultimo?.mensajes ?? [])].reverse().find((x) => x.opciones?.length)!;
      entrada = { tipo: 'opcion', cajaId: m.opcionesDe, letra: p.letra, titulo: m.opciones!.find((o) => o.letra === p.letra)!.texto };
    }
    const r = await ejecutarTurnoSimulador(como(opciones.persona ?? 'p-lucia'), capa, { botId: BOT, sesion, entrada, horario: opciones.horario ?? 'dentro' });
    if (!r.ok) throw new Error(r.codigo);
    sesion = r.sesion;
    ultimo = r;
    todos.push(r);
  }
  return todos;
}

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
  capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
});

describe('simulador', () => {
  it('arranca con la bienvenida y el menú, y cada respuesta dice por qué salió', async () => {
    const [r] = await conversar(['inicio']);
    expect(r!.mensajes.map((m) => m.cajaId)).toEqual(['n_bienvenida', 'n_menu']);
    expect(r!.mensajes[0]!.texto).toContain('Ana Lucía Ríos');
    expect(r!.mensajes[1]!.modo).toBe('lista');
    expect(r!.decision.recorrido).toEqual(['n_bienvenida', 'n_menu']);
  });

  it('botones y texto: del menú a pedir la pregunta, y la pregunta pasa por interpretar', async () => {
    const t = await conversar(['inicio', { letra: 'A' }, '¿Qué propone para la Caja de Seguro Social?']);
    expect(t[1]!.mensajes.map((m) => m.cajaId)).toEqual(['n_preguntar']);
    const d = t[2]!.decision;
    expect(d.recorrido[0]).toBe('n_interpretar');
    expect(d.intencion).toBe('propuesta');
    expect(d.lectura?.resultado).toBeDefined();
    expect(d.motor).toBeTruthy();
    // Sin material todavía (etapa 3): dice que no tiene el dato y ofrece seguir.
    expect(t[2]!.mensajes.map((m) => m.cajaId)).toEqual(['n_sindato', 'n_masayuda']);
  });

  it('las reglas contestan lo obvio sin motor', async () => {
    const t = await conversar(['inicio', 'Hola, buenas tardes']);
    expect(t[1]!.decision.regla).toBe('cortesia');
    expect(t[1]!.decision.costoUsd).toBe(0);
  });

  it('el horario fijado cambia la condición: fuera de horario no deriva al equipo', async () => {
    const dentro = await conversar(['inicio', { letra: 'E' }], { horario: 'dentro' });
    expect(dentro[1]!.decision.recorrido).toContain('n_derivar');
    expect(dentro[1]!.sesion.estado).toBe('derivada');
    const fuera = await conversar(['inicio', { letra: 'E' }], { horario: 'fuera' });
    expect(fuera[1]!.decision.recorrido).toContain('n_fuerahor');
  });

  it('cambiar el destino de una intención se nota en el mensaje siguiente', async () => {
    const antes = await conversar(['inicio', 'Quiero aportar: ¿cómo hago una donación?']);
    expect(antes[1]!.decision.intencion).toBe('aporte');
    expect(antes[1]!.decision.recorrido).toContain('n_aporte');
    await ejecutarCambio(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [{ tipo: 'editar_intencion', intencion: 'aporte', cambios: { destino: 'n_noentendi' } }], origen: 'editor' });
    const despues = await conversar(['inicio', 'Quiero aportar: ¿cómo hago una donación?']);
    expect(despues[1]!.decision.recorrido).toContain('n_noentendi');
  });

  it('cada llamada a un motor queda registrada como uso del simulador', async () => {
    await conversar(['inicio', { letra: 'A' }, '¿Qué propone para la Caja de Seguro Social?']);
    const ll = await repo.llamadas(CAMPANA, { botId: BOT, desde: new Date(Date.now() - 60_000).toISOString() });
    expect(ll.length).toBeGreaterThanOrEqual(1);
    expect(ll.every((l) => l.uso === 'simulador' && l.personaId === 'p-lucia')).toBe(true);
  });

  it('solo editor y administrador; una sesión rota empieza de nuevo', async () => {
    for (const p of ['p-andres', 'p-equipo']) {
      expect(await ejecutarTurnoSimulador(como(p), capa, { botId: BOT, sesion: null, entrada: { tipo: 'inicio' }, horario: 'dentro' })).toEqual({ ok: false, codigo: 'sin_permiso' });
    }
    const r = await ejecutarTurnoSimulador(como('p-joaquin'), capa, { botId: BOT, sesion: { roto: true }, entrada: { tipo: 'texto', texto: 'hola' }, horario: 'dentro' });
    expect(r.ok).toBe(true);
    expect(await ejecutarTurnoSimulador(como('p-joaquin'), capa, { botId: BOT, sesion: null, entrada: { tipo: 'volar' }, horario: 'dentro' })).toEqual({ ok: false, codigo: 'datos' });
  });
});

describe('simulador con material (etapa 3)', () => {
  const BOT2 = 'bot-demo-2';
  const turnoEn = async (sesion: unknown, entrada: unknown) => {
    const r = await ejecutarTurnoSimulador(como('p-lucia'), capa, { botId: BOT2, sesion, entrada, horario: 'dentro' });
    if (!r.ok) throw new Error(r.codigo);
    return r;
  };

  it('contesta con el material y cita la sección', async () => {
    const a = await turnoEn(null, { tipo: 'inicio' });
    const r = await turnoEn(a.sesion, { tipo: 'texto', texto: '¿Cuántos votos sacó Lombana en la elección de 2019?' });
    expect(r.decision.secciones).toEqual(['S02']);
    expect(r.mensajes[0]!.texto).toMatch(/Otro Camino|2019|independiente/);
    expect(r.decision.corte).toBeUndefined();
  });

  it('"Si tengo la cédula vencida, ¿puedo votar?" termina en la derivación al Tribunal Electoral', async () => {
    const a = await turnoEn(null, { tipo: 'inicio' });
    const r = await turnoEn(a.sesion, { tipo: 'texto', texto: 'Si tengo la cédula vencida, ¿puedo votar?' });
    expect(r.decision.intencion).toBe('tramite_electoral');
    expect(r.mensajes[0]!.texto).toMatch(/la información oficial la da el Tribunal Electoral/);
    expect(r.eventos.map((e) => e.nombre)).toContain('tramite_electoral');
  });
});
