import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { BOT_PUBLICADO, ID_PUBLICO_DEMO } from '../datos/demo/semilla-canal';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { atenderMensaje, consultarMensajes, datosPagina, datosWidget, inicialesDe, type EntornoWeb, type RespuestaWeb } from './nucleo';

// Un miércoles a las 15 de Panamá: dentro del horario de atención por defecto.
const MIERCOLES = new Date('2026-09-30T20:00:00Z');
let repo: RepositorioDemo;
let entorno: EntornoWeb;
let ahora: Date;
let n = 0;

const hash = (t: string) => createHmac('sha256', 'clave-de-prueba').update(t).digest('hex');
const pedir = (x: Record<string, unknown>, e: Partial<EntornoWeb> = {}) => atenderMensaje(repo, { ...entorno, ...e }, { bot: ID_PUBLICO_DEMO, contacto: 'contacto-de-prueba-0001', canal: 'landing', id: `m-${String(++n).padStart(6, '0')}`, ...x });
type Ok = Extract<RespuestaWeb, { ok: true }>;
const ok = (r: RespuestaWeb): Ok => {
  if (!r.ok) throw new Error(`${r.codigo} (${r.status})`);
  return r;
};
const llamadasEnVivo = async () => (await repo.llamadas('c-pa-pruebas', { limite: 10000 })).filter((l) => l.uso === 'en_vivo').length;

beforeEach(() => {
  reiniciarNucleoMemoria();
  ahora = MIERCOLES;
  repo = new RepositorioDemo({ ahora: MIERCOLES });
  entorno = {
    ahora: () => ahora, ip: '203.0.113.7', hash, verificar: async () => true, verificacionConfigurada: true,
    capa: new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true, ahora: () => ahora }),
  };
});

describe('canal web: una conversación', () => {
  it('el primer mensaje trae el aviso de IA con las condiciones, la bienvenida y el menú; queda guardada con su decisión', async () => {
    const r = ok(await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' }));
    expect(r.estado).toBe('bot');
    expect(r.soloMenus).toBe(false);
    expect(r.mensajes[0]).toMatchObject({ autor: 'sistema', enlace: 'condiciones' });
    expect(r.mensajes[0]!.texto).toMatch(/^Está conversando con un asistente virtual con inteligencia artificial/);
    expect(r.mensajes[1]!.texto).toMatch(/asistente virtual de Ana Lucía Ríos/);
    expect(r.mensajes[2]).toMatchObject({ opcionesDe: 'n_menu', modo: 'lista' });
    const t = ok(await pedir({ entrada: { tipo: 'texto', texto: 'Quiero ser voluntario, ¿cómo me sumo?' } }));
    expect(t.mensajes.map((m) => m.texto).join(' ')).toMatch(/¿Cómo se llama\?/);
    const lista = await repo.conversaciones('c-pa-pruebas', { botId: BOT_PUBLICADO });
    const c = (await repo.conversacion(lista[0]!.conversacion.id))!;
    expect(c.mensajes.map((m) => m.autor)).toEqual(['sistema', 'bot', 'bot', 'contacto', 'bot']);
    expect(c.mensajes[4]!.decision).toMatchObject({ intencion: 'voluntariado' });
    expect(c.contacto.condicionesVersion).toBe(1);
    // Los eventos no llevan lo que escribió la persona.
    const eventos = repo.analiticaGuardada();
    expect(eventos.map((e) => e.nombre)).toEqual(expect.arrayContaining(['sesion_iniciada', 'caja_mostrada', 'texto_recibido', 'interpretado']));
    expect(JSON.stringify(eventos)).not.toMatch(/voluntario, ¿cómo/);
    expect(await llamadasEnVivo()).toBeGreaterThan(0);
  });

  it('el dato que da la persona queda en su contacto; un reintento no duplica; volver a abrir muestra lo último', async () => {
    await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' });
    await pedir({ entrada: { tipo: 'texto', texto: 'Quiero ser voluntario, ¿cómo me sumo?' } });
    const id = 'mensaje-repetido-01';
    const a = ok(await pedir({ id, entrada: { tipo: 'texto', texto: 'Rosa' } }));
    const b = ok(await pedir({ id, entrada: { tipo: 'texto', texto: 'Rosa' } }));
    expect(b.mensajes).toEqual(a.mensajes);
    const c = (await repo.conversaciones('c-pa-pruebas', { botId: BOT_PUBLICADO }))[0]!;
    expect(c.contacto.nombre).toBe('Rosa');
    expect((await repo.conversacion(c.conversacion.id))!.mensajes.filter((m) => m.texto === 'Rosa')).toHaveLength(1);
    const otra = ok(await pedir({ entrada: { tipo: 'inicio' } }));
    expect(otra.mensajes.length).toBeGreaterThan(3);
    expect(otra.ultimo).toBe(c.conversacion.seq);
  });

  it('pedir hablar con alguien en horario deriva: el bot no contesta más, el equipo responde y el navegador lo recibe', async () => {
    await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' });
    const d = ok(await pedir({ entrada: { tipo: 'texto', texto: 'Quiero hablar con una persona del equipo' } }));
    expect(d.estado).toBe('derivada');
    const s = ok(await pedir({ entrada: { tipo: 'texto', texto: '¿Hay alguien?' } }));
    expect(s.mensajes).toEqual([]);
    const conv = (await repo.conversaciones('c-pa-pruebas', { estado: 'derivada', botId: BOT_PUBLICADO }))[0]!;
    expect(conv.conversacion.motivoDerivacion).toBe('Pidió hablar con el equipo');
    await repo.responderConversacion(conv.conversacion.id, 'Hola, soy Andrés del equipo.', 'p-andres');
    const nuevos = ok(await consultarMensajes(repo, entorno, { bot: ID_PUBLICO_DEMO, contacto: 'contacto-de-prueba-0001', desde: s.ultimo }));
    expect(nuevos.mensajes).toEqual([expect.objectContaining({ autor: 'agente', texto: 'Hola, soy Andrés del equipo.' })]);
    expect(nuevos.estado).toBe('en_atencion');
  });

  it('al publicar otra versión, la conversación en curso sigue donde estaba y contesta la versión nueva', async () => {
    await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' });
    await pedir({ entrada: { tipo: 'texto', texto: 'Quiero ser voluntario, ¿cómo me sumo?' } });
    const antes = (await repo.conversaciones('c-pa-pruebas', { botId: BOT_PUBLICADO }))[0]!.conversacion;
    expect(antes.versionId).toBe('ver-demo-3');
    // Versión 2: mismo bot, otro texto para pedir la zona.
    const v2 = await repo.crearBorrador(BOT_PUBLICADO, null, 'p-lucia');
    const b = (await repo.borrador(BOT_PUBLICADO))!;
    const def = structuredClone(b.definicion) as { contenidos: { id: string; texto: string }[] };
    def.contenidos.find((c) => c.id === 'c_zona')!.texto = '¿De qué barrio es?';
    await repo.guardarCambio(v2, 0, { origen: 'editor', operaciones: [{ tipo: 'editar_contenido', contenido: 'c_zona', cambios: { texto: '¿De qué barrio es?' } }], inversa: { tipo: 'restaurar', partes: {} } as never, resumen: 'Editó el contenido', objetivo: null }, def as never, 'p-lucia');
    const corrida = await repo.crearCorrida(v2, {}, 'x', 1, 'p-lucia');
    await repo.cerrarCorrida(corrida, { acierto: 100 } as never, 'terminada', 'p-lucia');
    await repo.pedirPublicacion(v2, 1, '', 'p-lucia');
    await repo.aprobarPublicacion(v2, '', 'p-joaquin');
    const r = ok(await pedir({ entrada: { tipo: 'texto', texto: 'Rosa' } }));
    expect(r.mensajes.map((m) => m.texto)).toContain('¿De qué barrio es?');
    const despues = (await repo.conversacion(antes.id))!;
    expect(despues.conversacion.id).toBe(antes.id);
    expect(despues.conversacion.versionId).toBe(v2);
  });

  it('una ráfaga de 200 mensajes desde una IP queda en solo menús, sin llamar a ningún motor', async () => {
    await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' });
    const antes = await llamadasEnVivo();
    let soloMenus = 0;
    for (let i = 0; i < 200; i++) {
      const r = ok(await pedir({ contacto: `rafaga-${String(i % 5).padStart(3, '0')}-abcdefghij`, entrada: { tipo: 'texto', texto: `¿Qué propone para el transporte? ${i}` }, verificacion: 'token' }));
      if (r.soloMenus) soloMenus++;
    }
    const llamadas = (await llamadasEnVivo()) - antes;
    // Los primeros 20 del minuto (menos el inicio) pueden ir a los motores; los otros 180, no.
    expect(soloMenus).toBeGreaterThanOrEqual(180);
    expect(llamadas).toBeLessThanOrEqual(19 * 3);
    // El límite duro por IP y hora corta con 429.
    await repo.contar(Array.from({ length: 1200 }, () => ({ clave: `ip:${hash('ip:203.0.113.7')}:h`, ventanaSegundos: 3600 })), ahora);
    const r = await pedir({ entrada: { tipo: 'texto', texto: 'hola' } });
    expect(r).toEqual({ ok: false, codigo: 'demasiados', status: 429 });
  });

  it('sin pasar la verificación anti-robots, solo menús', async () => {
    const r = ok(await pedir({ contacto: 'sin-verificar-00000001', entrada: { tipo: 'inicio' }, verificacion: 'malo' }, { verificar: async () => false }));
    expect(r.soloMenus).toBe(true);
    const antes = await llamadasEnVivo();
    const t = ok(await pedir({ contacto: 'sin-verificar-00000001', entrada: { tipo: 'texto', texto: '¿Qué propone para el agua?' } }));
    expect(t.soloMenus).toBe(true);
    expect(await llamadasEnVivo()).toBe(antes);
  });
});

describe('canal web: sin verificación configurada', () => {
  it('sin Turnstile configurado (desarrollo, demo), la conversación cuenta como verificada', async () => {
    const r = ok(await pedir({ contacto: 'sin-turnstile-000001', entrada: { tipo: 'inicio' } }, { verificacionConfigurada: false, verificar: async () => false }));
    expect(r.soloMenus).toBe(false);
  });
});

describe('canal web: disponibilidad, pausa y condiciones', () => {
  it('solo bots publicados con el canal prendido', async () => {
    expect(await pedir({ bot: 'noexiste123', entrada: { tipo: 'inicio' } })).toMatchObject({ ok: false, status: 404 });
    expect(await pedir({ bot: 'k7m2q9x4pa', entrada: { tipo: 'inicio' } })).toMatchObject({ ok: false, status: 404 });
    await repo.guardarCanalWeb(BOT_PUBLICADO, { activo: false, modoCondiciones: 'aviso' }, 'p-joaquin');
    expect(await pedir({ entrada: { tipo: 'inicio' } })).toMatchObject({ ok: false, status: 404 });
    expect(await datosPagina(repo, ID_PUBLICO_DEMO)).toBeNull();
    expect(await pedir({ entrada: { tipo: 'texto', texto: '' } })).toMatchObject({ ok: false, status: 400 });
  });

  it('con el bot en pausa, el mensaje va a la bandeja y el bot no contesta', async () => {
    await repo.pausarBot(BOT_PUBLICADO, true, 'p-joaquin');
    const i = ok(await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' }));
    expect(i.mensajes[0]!.texto).toMatch(/en pausa/);
    const r = ok(await pedir({ entrada: { tipo: 'texto', texto: 'Hola' } }));
    expect(r.estado).toBe('derivada');
    const c = (await repo.conversaciones('c-pa-pruebas', { estado: 'derivada', botId: BOT_PUBLICADO }))[0]!;
    expect(c.conversacion.motivoDerivacion).toBe('Bot en pausa');
    await expect(repo.pausarBot(BOT_PUBLICADO, false, 'p-lucia')).rejects.toThrow(/no permite/);
  });

  it('con "acepto", hay que aceptar las condiciones antes de empezar; queda la versión aceptada', async () => {
    await repo.guardarCanalWeb(BOT_PUBLICADO, { activo: true, modoCondiciones: 'acepto' }, 'p-joaquin');
    const r = ok(await pedir({ entrada: { tipo: 'inicio' }, verificacion: 'token' }));
    expect(r.pedirCondiciones).toBe(1);
    expect(r.mensajes[0]).toMatchObject({ opcionesDe: 'condiciones', enlace: 'condiciones' });
    const a = ok(await pedir({ entrada: { tipo: 'aceptar', numero: 1 } }));
    expect(a.pedirCondiciones).toBeNull();
    expect(a.mensajes.some((m) => m.opcionesDe === 'n_menu')).toBe(true);
    const c = (await repo.conversaciones('c-pa-pruebas', { botId: BOT_PUBLICADO }))[0]!;
    expect((await repo.conversacion(c.conversacion.id))!.contacto.condicionesVersion).toBe(1);
    // Condiciones nuevas: hay que aceptarlas otra vez.
    await repo.publicarCondiciones(BOT_PUBLICADO, 'Condiciones nuevas.', 'p-joaquin');
    expect(ok(await pedir({ entrada: { tipo: 'texto', texto: 'hola' } })).pedirCondiciones).toBe(2);
  });

  it('la página del bot muestra su nombre, el candidato y las condiciones', async () => {
    expect(await datosPagina(repo, ID_PUBLICO_DEMO)).toMatchObject({ nombre: 'Asistente publicado', candidato: 'Ana Lucía Ríos', condiciones: { numero: 1 } });
  });

  it('el botón del widget: iniciales y saludo con el trato del bot; sin saludo en pausa; nada si no está publicado', async () => {
    expect(await datosWidget(repo, ID_PUBLICO_DEMO)).toEqual({
      candidato: 'Ana Lucía Ríos', iniciales: 'AR', titulo: 'Asistente virtual de Ana Lucía Ríos', saludo: 'Hola, ¿en qué le puedo ayudar?',
    });
    await repo.pausarBot(BOT_PUBLICADO, true, 'p-joaquin');
    expect((await datosWidget(repo, ID_PUBLICO_DEMO))?.saludo).toBeNull();
    expect(await datosWidget(repo, 'k7m2q9x4pa')).toBeNull();
    expect(await datosWidget(repo, 'no válido')).toBeNull();
  });

  it('las iniciales: primera y última palabra, en mayúscula', () => {
    expect(inicialesDe('Ana Lucía Ríos')).toBe('AR');
    expect(inicialesDe('  ángel  ')).toBe('Á');
    expect(inicialesDe('Ricardo Lombana')).toBe('RL');
    expect(inicialesDe('')).toBe('');
  });
});
