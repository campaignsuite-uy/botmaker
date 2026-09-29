import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { BOT_PUBLICADO, ID_PUBLICO_DEMO } from '../datos/demo/semilla-canal';
import { ErrorDatos } from '../datos/errores';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { idOpcion, type MensajeWhatsapp } from '../dominio/whatsapp';
import type { Cliente360 } from './d360';
import { CLAVE_DEMO, SECRETO_DEMO } from './demo';
import { enviarPendientes, recibirWebhook, sincronizarPlantillas, tareasWhatsapp, type EntornoWhatsapp } from './nucleo';
import { Simulador360 } from './simulado';
import { sha256 } from './webhook';

const MIERCOLES = new Date('2026-09-30T20:00:00Z');
const CAMPANA = 'c-pa-2029';
const TELEFONO = '50760001111';
const URL_AVISO = `/publico/api/whatsapp/${ID_PUBLICO_DEMO}`;

let repo: RepositorioDemo;
let sim: Simulador360;
let entorno: EntornoWhatsapp;

const hash = (t: string) => createHmac('sha256', 'clave-de-prueba').update(t).digest('hex');

function conectar(cliente: Cliente360 = sim) {
  entorno = {
    ahora: () => MIERCOLES, hash, cliente, urlPublica: '/publico',
    capa: new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true, ahora: () => MIERCOLES }),
  };
  // El simulado entrega los avisos a la misma función que atiende la ruta del webhook.
  sim.entregar = async (url, encabezados, cuerpo) => {
    const r = await recibirWebhook(repo, entorno, url.split('/').pop()!, new Headers(encabezados), cuerpo, Date.now());
    if (r.procesar) await r.procesar();
    return r.status;
  };
}

beforeEach(async () => {
  // Los avisos de estado que quedaron en camino de la prueba anterior no tienen que llegar a esta.
  await sim?.esperar();
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo({ ahora: MIERCOLES });
  sim = new Simulador360({ demo: { urlAviso: URL_AVISO } });
  conectar();
});

const escribir = async (texto: string, telefono = TELEFONO) => {
  const s = await sim.escribir(CLAVE_DEMO, telefono, 'Pedro del Teléfono', { tipo: 'texto', texto });
  await sim.esperar();
  return s;
};
const conversacionDe = async (telefono = TELEFONO) => {
  const filas = await repo.conversaciones(CAMPANA, { botId: BOT_PUBLICADO, canal: 'whatsapp' });
  for (const f of filas) {
    const c = await repo.conversacion(f.conversacion.id);
    if (c?.contacto.telefono === telefono) return c;
  }
  throw new Error('No está la conversación');
};
const textos = (ms: { mensaje: MensajeWhatsapp | { type: 'entrante'; texto: string } }[]) =>
  ms.map((m) => (m.mensaje.type === 'entrante' ? `> ${m.mensaje.texto}` : m.mensaje.type === 'text' ? m.mensaje.text.body : m.mensaje.type === 'interactive' ? m.mensaje.interactive.body.text : `[plantilla ${m.mensaje.template.name}]`));

describe('WhatsApp: el aviso de 360dialog', () => {
  it('sin el secreto del canal no entra; un bot que no existe tampoco; un cuerpo roto es 400', async () => {
    const cuerpo = JSON.stringify({ entry: [] });
    expect((await recibirWebhook(repo, entorno, ID_PUBLICO_DEMO, new Headers({ 'x-botmaker-secreto': 'otro' }), cuerpo, Date.now())).status).toBe(401);
    expect((await recibirWebhook(repo, entorno, ID_PUBLICO_DEMO, new Headers(), cuerpo, Date.now())).status).toBe(401);
    expect((await recibirWebhook(repo, entorno, 'noexiste01', new Headers({ 'x-botmaker-secreto': SECRETO_DEMO }), cuerpo, Date.now())).status).toBe(404);
    expect((await recibirWebhook(repo, entorno, ID_PUBLICO_DEMO, new Headers({ 'x-botmaker-secreto': SECRETO_DEMO }), '{roto', Date.now())).status).toBe(400);
    expect((await recibirWebhook(repo, entorno, ID_PUBLICO_DEMO, new Headers({ 'x-botmaker-secreto': SECRETO_DEMO }), cuerpo, Date.now())).status).toBe(200);
  });

  it('con el canal apagado contesta que llegó y no guarda nada', async () => {
    await repo.prenderWhatsapp(BOT_PUBLICADO, false, 'p-joaquin');
    expect(await escribir('Hola')).toBe(200);
    expect(await repo.conversaciones(CAMPANA, { canal: 'whatsapp', botId: BOT_PUBLICADO })).toHaveLength(1); // solo la de la semilla
    expect(sim.conversacion(CLAVE_DEMO, TELEFONO).filter((m) => m.sentido === 'para')).toHaveLength(0);
  });
});

describe('WhatsApp: una conversación', () => {
  it('una persona escribe: el bot contesta por WhatsApp con el aviso, guarda su número y su nombre de perfil, y abre la ventana', async () => {
    expect(await escribir('Hola')).toBe(200);
    const recibido = textos(sim.conversacion(CLAVE_DEMO, TELEFONO));
    expect(recibido[0]).toBe('> Hola');
    expect(recibido[1]).toMatch(/^Está conversando con un asistente virtual[\s\S]*Condiciones del asistente: \/publico\/b\/p5v9c3h7pa\/condiciones/);
    expect(recibido.length).toBeGreaterThan(2);
    const c = await conversacionDe();
    expect(c.conversacion.canal).toBe('whatsapp');
    expect(c.contacto).toMatchObject({ telefono: TELEFONO, nombrePerfil: 'Pedro del Teléfono', condicionesVersion: 1 });
    expect(new Date(c.conversacion.ventanaHasta!).getTime()).toBeGreaterThan(Date.now() + 23 * 36e5);
    // Lo que salió: enviado, y al mirarlo el teléfono, leído (Meta avisa los estados).
    await sim.esperar();
    const leidos = (await conversacionDe()).mensajes.filter((m) => m.autor !== 'contacto');
    expect(leidos.every((m) => m.envio === 'leido')).toBe(true);
    const salud = (await repo.canalWhatsapp(BOT_PUBLICADO))!.salud;
    expect(salud).toMatchObject({ recibidos: 1, repetidos: 0, fallidos: 0, pendientes: 0 });
    expect(salud.enviados).toBe(recibido.length - 1);
    expect(salud.leidos).toBe(recibido.length - 1);
    expect(repo.analiticaGuardada().filter((e) => e.nombre === 'estado_mensaje').length).toBeGreaterThan(0);
  });

  it('tocar un botón o una fila de lista sigue la ruta de esa opción', async () => {
    await escribir('Hola');
    const lista = sim.conversacion(CLAVE_DEMO, TELEFONO).map((m) => m.mensaje).find((m): m is Extract<MensajeWhatsapp, { type: 'interactive' }> => m.type === 'interactive' && m.interactive.type === 'list');
    expect(lista).toBeTruthy();
    const filas = lista!.interactive.type === 'list' ? lista!.interactive.action.sections[0]!.rows : [];
    const quien = filas.find((f) => /Quién es/.test(f.title))!;
    expect(quien.id).toBe(idOpcion('n_menu', quien.id.split('|')[1]!));
    await sim.escribir(CLAVE_DEMO, TELEFONO, null, { tipo: 'fila', id: quien.id, titulo: quien.title });
    await sim.esperar();
    const c = await conversacionDe();
    const tocado = c.mensajes.find((m) => m.autor === 'contacto' && m.tipo === 'opcion');
    expect(tocado).toMatchObject({ texto: quien.title, datos: { opcionesDe: 'n_menu' } });
  });

  it('un reintento de 360dialog (el mismo mensaje dos veces) se descarta y cuenta como repetido', async () => {
    await escribir('¿Qué propone para el transporte?');
    const antes = (await conversacionDe()).mensajes.length;
    expect(await sim.reintentarUltimo(CLAVE_DEMO, TELEFONO)).toBe(200);
    await sim.esperar();
    expect((await conversacionDe()).mensajes.length).toBe(antes);
    expect((await repo.canalWhatsapp(BOT_PUBLICADO))!.salud).toMatchObject({ recibidos: 1, repetidos: 1 });
  });

  it('un audio no se interpreta: lo resuelve la regla de adjuntos, sin motor', async () => {
    await sim.escribir(CLAVE_DEMO, TELEFONO, null, { tipo: 'audio' });
    await sim.esperar();
    const c = await conversacionDe();
    const audio = c.mensajes.find((m) => m.autor === 'contacto');
    expect(audio?.texto).toBe('[audio]');
    const respuesta = c.mensajes.find((m) => m.n > audio!.n && m.decision);
    expect(respuesta?.decision).toMatchObject({ regla: 'adjunto' });
  });

  it('con el bot en pausa avisa una vez y todo va a la bandeja', async () => {
    await repo.pausarBot(BOT_PUBLICADO, true, 'p-joaquin');
    await escribir('Hola');
    await escribir('¿Hay alguien?');
    const recibido = textos(sim.conversacion(CLAVE_DEMO, TELEFONO)).filter((t) => !t.startsWith('> '));
    expect(recibido).toEqual(['El asistente está en pausa en este momento. El equipo de la campaña recibe este mensaje.']);
    expect((await conversacionDe()).conversacion.estado).toBe('derivada');
  });

  it('con condiciones «Acepto», primero el botón; al tocarlo empieza la conversación', async () => {
    await repo.guardarCanalWeb(BOT_PUBLICADO, { activo: true, modoCondiciones: 'acepto' }, 'p-joaquin');
    await escribir('Hola');
    const primero = sim.conversacion(CLAVE_DEMO, TELEFONO).map((m) => m.mensaje).filter((m) => m.type !== 'entrante');
    expect(primero).toHaveLength(1);
    expect(primero[0]).toMatchObject({ type: 'interactive', interactive: { type: 'button', action: { buttons: [{ reply: { id: 'condiciones|A', title: 'Acepto' } }] } } });
    await sim.escribir(CLAVE_DEMO, TELEFONO, null, { tipo: 'boton', id: 'condiciones|A', titulo: 'Acepto' });
    await sim.esperar();
    expect((await conversacionDe()).contacto.condicionesVersion).toBe(1);
    expect(textos(sim.conversacion(CLAVE_DEMO, TELEFONO)).some((t) => /asistente virtual de Ana Lucía Ríos/.test(t))).toBe(true);
  });
});

describe('WhatsApp: la bandeja', () => {
  it('el agente responde con la ventana abierta y le llega por WhatsApp', async () => {
    await escribir('Quiero hablar con alguien del equipo');
    const c = await conversacionDe();
    await repo.tomarConversacion(c.conversacion.id, 'p-andres');
    await repo.responderConversacion(c.conversacion.id, 'Hola, soy Andrés, del equipo.', 'p-andres');
    await enviarPendientes(repo, entorno, { conversacionId: c.conversacion.id });
    await sim.esperar();
    expect(textos(sim.conversacion(CLAVE_DEMO, TELEFONO)).at(-1)).toBe('Hola, soy Andrés, del equipo.');
  });

  it('con la ventana cerrada solo sale una plantilla aprobada, con sus espacios completos', async () => {
    await escribir('Quiero hablar con alguien del equipo');
    const c = await conversacionDe();
    await repo.tomarConversacion(c.conversacion.id, 'p-andres');
    repo.cerrarVentana(c.conversacion.id);
    await expect(repo.responderConversacion(c.conversacion.id, 'Hola', 'p-andres')).rejects.toMatchObject({ codigo: 'ventana_cerrada' });
    const pl = (await repo.plantillas(BOT_PUBLICADO)).find((p) => p.nombre === 'retomar_consulta')!;
    expect(pl.usable).toBe(true);
    await expect(repo.responderConPlantilla(c.conversacion.id, { nombre: 'novedades_semana', idioma: 'es', formato: 'nombre', variables: ['nombre', 'barrio'], valores: { nombre: 'x', barrio: 'y' }, texto: 'x' }, 'p-andres'))
      .rejects.toMatchObject({ codigo: 'plantilla_no_usable' });
    await repo.responderConPlantilla(c.conversacion.id, { nombre: pl.nombre, idioma: pl.idioma, formato: pl.formato, variables: pl.variables, valores: { 1: 'Pedro', 2: 'la reunión' }, texto: 'Hola Pedro, …' }, 'p-andres');
    await enviarPendientes(repo, entorno, { conversacionId: c.conversacion.id });
    await sim.esperar();
    const ultimo = sim.conversacion(CLAVE_DEMO, TELEFONO).at(-1)!;
    await sim.esperar();
    expect(ultimo.mensaje).toEqual({ type: 'template', template: { name: 'retomar_consulta', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Pedro' }, { type: 'text', text: 'la reunión' }] }] } });
    expect((await conversacionDe()).mensajes.at(-1)).toMatchObject({ autor: 'agente', envio: 'leido' });
  });

  it('la conversación de la semilla (Marta) tiene la ventana cerrada', async () => {
    repo = new RepositorioDemo(); // la semilla con la hora de ahora (la ventana se mide con el reloj real)
    const c = (await repo.conversacion('conv-demo-5'))!;
    expect(c.contacto).toMatchObject({ telefono: '50761234567', nombrePerfil: 'Marta G.' });
    await repo.tomarConversacion('conv-demo-5', 'p-andres');
    await expect(repo.responderConversacion('conv-demo-5', 'Hola', 'p-andres')).rejects.toBeInstanceOf(ErrorDatos);
  });
});

describe('WhatsApp: envíos, reintentos y salud', () => {
  it('una clave que dejó de valer desconecta el canal, abre la alerta y el mensaje queda «No se envió»; al reconectar se cierra', async () => {
    sim.revocar(CLAVE_DEMO, true);
    await escribir('Hola');
    expect((await repo.canalWhatsapp(BOT_PUBLICADO))!.estado).toBe('desconectado');
    const alertas = await repo.alertas(CAMPANA, { abiertas: true });
    expect(alertas.some((a) => a.tipo === 'canal_desconectado')).toBe(true);
    const c = await conversacionDe();
    expect(c.mensajes.filter((m) => m.autor !== 'contacto').every((m) => m.envio === 'fallido')).toBe(true);
    await repo.conectarWhatsapp(BOT_PUBLICADO, { clave: 'otra-clave-de-prueba-que-funciona', numero: null, secretoHash: sha256('otro-secreto'), webhookUrl: URL_AVISO }, 'p-joaquin');
    expect((await repo.alertas(CAMPANA, { abiertas: true })).some((a) => a.tipo === 'canal_desconectado')).toBe(false);
  });

  it('si 360dialog no contesta, reintenta más tarde con espera creciente y no rompe el orden', async () => {
    let fallar = 2;
    const intermitente: Cliente360 = {
      ...sim, simulado: true,
      validarClave: (c) => sim.validarClave(c), configurarWebhook: (c, u, e) => sim.configurarWebhook(c, u, e), plantillas: (c) => sim.plantillas(c),
      crearPlantilla: (c, p) => sim.crearPlantilla(c, p), borrarPlantilla: (c, n) => sim.borrarPlantilla(c, n),
      enviar: async (c, para, m) => (fallar-- > 0 ? { ok: false, error: 'reintentar', detalle: 'HTTP 503 (simulado)' } : sim.enviar(c, para, m)),
    };
    conectar(intermitente);
    await escribir('Hola');
    let c = await conversacionDe();
    expect(c.mensajes.filter((m) => m.autor !== 'contacto').every((m) => m.envio === 'pendiente')).toBe(true);
    expect(sim.conversacion(CLAVE_DEMO, TELEFONO).filter((m) => m.sentido === 'para')).toHaveLength(0);
    // La tarea programada (cada minuto) todavía no reintenta: la espera es de 30 segundos.
    await tareasWhatsapp(repo, entorno);
    expect(sim.conversacion(CLAVE_DEMO, TELEFONO, false).filter((m) => m.sentido === 'para')).toHaveLength(0);
    // Un minuto después, la tarea los manda en orden.
    const despues = new Date(MIERCOLES.getTime() + 60_000);
    entorno = { ...entorno, ahora: () => despues };
    await tareasWhatsapp(repo, entorno); // el segundo intento falla (503)
    entorno = { ...entorno, ahora: () => new Date(MIERCOLES.getTime() + 10 * 60_000) };
    await tareasWhatsapp(repo, entorno);
    await sim.esperar();
    c = await conversacionDe();
    expect(c.mensajes.filter((m) => m.autor !== 'contacto').every((m) => m.envio === 'leido' || m.envio === 'enviado')).toBe(true);
    const salidos = textos(sim.conversacion(CLAVE_DEMO, TELEFONO)).filter((t) => !t.startsWith('> '));
    expect(salidos[0]).toMatch(/^Está conversando/);
  });

  it('lo recibido que quedó sin procesar lo retoma la tarea programada', async () => {
    const perdido = sim.entregar!;
    sim.entregar = async (url, enc, cuerpo) => (await recibirWebhook(repo, entorno, url.split('/').pop()!, new Headers(enc), cuerpo, Date.now())).status; // sin procesar
    await sim.escribir(CLAVE_DEMO, TELEFONO, null, { tipo: 'texto', texto: 'Hola' });
    expect(sim.conversacion(CLAVE_DEMO, TELEFONO).filter((m) => m.sentido === 'para')).toHaveLength(0);
    sim.entregar = perdido;
    const r = await tareasWhatsapp(repo, entorno);
    expect(r.procesadas).toBe(1);
    await sim.esperar();
    expect(sim.conversacion(CLAVE_DEMO, TELEFONO).filter((m) => m.sentido === 'para').length).toBeGreaterThan(0);
  });
});

describe('WhatsApp: gestor de plantillas', () => {
  it('se crea en 360dialog, queda en revisión y Meta la aprueba (o la rechaza); la tarea actualiza el estado', async () => {
    let reloj = Date.now();
    sim.reloj = () => reloj;
    const nueva = { nombre: 'seguimiento', categoria: 'utility' as const, idioma: 'es', texto: 'Hola {{1}}, ¿pudimos resolver tu consulta?', ejemplos: { 1: 'Rosa' } };
    const r = await sim.crearPlantilla(CLAVE_DEMO, nueva);
    expect(r).toMatchObject({ ok: true, valor: { estado: 'en_revision' } });
    await sim.crearPlantilla(CLAVE_DEMO, { ...nueva, nombre: 'rechazar_esta' });
    await sincronizarPlantillas(repo, entorno, 'wa-demo-1');
    expect((await repo.plantillas(BOT_PUBLICADO)).find((p) => p.nombre === 'seguimiento')).toMatchObject({ estado: 'en_revision', usable: false });
    expect(await repo.canalesParaRevisarPlantillas(MIERCOLES)).toContain('wa-demo-1');
    reloj += 20_000;
    await tareasWhatsapp(repo, entorno);
    const ps = await repo.plantillas(BOT_PUBLICADO);
    expect(ps.find((p) => p.nombre === 'seguimiento')).toMatchObject({ estado: 'aprobada', usable: true, variables: ['1'] });
    expect(ps.find((p) => p.nombre === 'rechazar_esta')).toMatchObject({ estado: 'rechazada', motivo: 'INVALID_FORMAT' });
  });

  it('solo el administrador anota y quita plantillas', async () => {
    const p = { id: 'x', nombre: 'otra', idioma: 'es', categoria: 'utility', estado: 'en_revision' as const, motivo: null, texto: 'Hola', formato: 'posicional' as const, variables: [], usable: false, aviso: null };
    await expect(repo.guardarPlantillaCreada(BOT_PUBLICADO, p, 'p-lucia')).rejects.toMatchObject({ codigo: 'sin_permiso' });
    await repo.guardarPlantillaCreada(BOT_PUBLICADO, p, 'p-joaquin');
    expect((await repo.plantillas(BOT_PUBLICADO)).find((x) => x.nombre === 'otra')).toMatchObject({ creadaPor: 'p-joaquin' });
    await repo.quitarPlantilla(BOT_PUBLICADO, 'otra', 'p-joaquin');
    expect((await repo.plantillas(BOT_PUBLICADO)).some((x) => x.nombre === 'otra')).toBe(false);
  });
});
