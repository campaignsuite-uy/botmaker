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
import { descargaContactos, vistaContactos, vistaFichaContacto } from './contactos';
import { numerosDiagrama, periodoDe, vistaAnalitica } from './analitica';
import { vistaEditor } from './editor';

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
    expect(await items('p-joaquin')).toEqual(['bots', 'nuevo', 'bandeja', 'contactos', 'analitica', 'motores', 'costos', 'equipo']);
    expect(await items('p-lucia')).toEqual(['bots', 'nuevo', 'bandeja', 'contactos', 'analitica', 'motores', 'equipo']);
    expect(await items('p-andres')).toEqual(['bots', 'bandeja', 'contactos', 'analitica', 'motores', 'equipo']);
    expect(await items('p-equipo')).toEqual(['bots', 'analitica', 'motores', 'equipo']);
    expect(await items('p-joaquin', true)).toEqual(['bots', 'bandeja', 'contactos', 'analitica', 'motores', 'costos', 'equipo']);
  });
});

describe('bots y nuevo bot', () => {
  it('lista con motores; crear solo editor y administrador, nunca en una demo', async () => {
    const v = await vistaBots(repo, ctx('p-lucia'));
    expect(v.filas.map((f) => f.nombre)).toEqual(['Consultas del partido', 'Asistente de la campaña', 'Asistente publicado']);
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

describe('base de contactos', () => {
  it('la lista con lo que consultó cada uno, los más recientes primero; un filtro que no es de la campaña no filtra', async () => {
    const v = await vistaContactos(repo, ctx('p-andres', { bot: 'bot-de-otra-campana', canal: 'fax' }));
    expect(v.resumen).toBe('5 contactos.');
    expect(v.hayFiltro).toBe(false);
    expect(v.filas.map((f) => f.nombre)).toEqual(['Contacto EMO2', 'Rosa', 'Marta G.', 'Contacto EMO1', 'Marcos']);
    const marcos = v.filas.find((f) => f.nombre === 'Marcos')!;
    expect(marcos.consultas.map((c) => c.texto)).toEqual(['Propuesta', 'Agua']);
    expect(marcos.consultas[1]!.href).toBe('/otro-camino/pa-2029/bots/contactos?consulta=tema%3Aagua');
    expect(marcos.datos).toBe('zona: Arraiján');
    expect(v.filas[2]).toMatchObject({ numero: '+50761234567', canal: 'WhatsApp' });
    expect(v.descarga).toBeNull();
    expect(v.opcionesConsulta.map((g) => g.grupo)).toEqual(['Consultas', 'Temas']);
    expect(v.opcionesConsulta[0]!.opciones.some((o) => o.valor === 'intencion:cortesia')).toBe(false);
  });

  it('el editor no ve el número ni busca por él', async () => {
    const v = await vistaContactos(repo, ctx('p-lucia'));
    expect(v.filas.every((f) => f.numero === null)).toBe(true);
    expect((await vistaContactos(repo, ctx('p-lucia', { buscar: '61234567' }))).resumen).toBe('0 contactos con este filtro.');
    expect((await vistaContactos(repo, ctx('p-andres', { buscar: '61234567' }))).filas.map((f) => f.nombre)).toEqual(['Marta G.']);
  });

  it('la ficha: lo que consultó con enlace al filtro y sus conversaciones con enlace a la bandeja', async () => {
    const f = (await vistaFichaContacto(repo, ctx('p-joaquin'), 'ct-demo-4'))!;
    expect(f.consultas.map((g) => [g.tipo, g.items.map((i) => i.texto)])).toEqual([['Consultas', ['Propuesta']], ['Temas', ['Agua']]]);
    expect(f.conversaciones[0]).toMatchObject({ href: '/otro-camino/pa-2029/bots/bandeja/conv-demo-4', estado: 'cerrada' });
    expect(f.pedidos).toMatchObject({ puedeBorrar: true });
    expect(await vistaFichaContacto(repo, ctx('p-equipo'), 'ct-demo-4')).toBeNull();
  });

  it('descargar: solo el administrador, con el filtro, y queda en el registro', async () => {
    await expect(descargaContactos(repo, ctx('p-andres'))).rejects.toMatchObject({ codigo: 'sin_permiso' });
    const d = await descargaContactos(repo, ctx('p-joaquin', { canal: 'whatsapp' }));
    expect(d.cantidad).toBe(1);
    expect(d.archivo).toMatch(/^contactos-generales-2029-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(d.csv.startsWith('\uFEFFBot,Canal,Nombre')).toBe(true);
    expect(d.csv).toContain('Asistente publicado,WhatsApp,,Marta G.,+50761234567,');
    expect(d.csv).toContain(',Agenda,');
    const v = await vistaContactos(repo, ctx('p-joaquin'));
    expect(v.descarga?.registro).toEqual([expect.objectContaining({ bot: 'Todos', filtro: 'WhatsApp', cantidad: '1' })]);
    expect(v.descarga?.href).toBe('/otro-camino/pa-2029/bots/contactos/descargar');
  });
});

describe('analítica', () => {
  it('arranca con el bot publicado y 30 días: conversaciones, cómo terminaron, consultas sin saludos y el embudo', async () => {
    const v = await vistaAnalitica(repo, ctx('p-joaquin'));
    expect(v.filtros).toMatchObject({ bot: 'bot-demo-3', periodo: '30' });
    expect(v.vacia).toBe(false);
    expect(v.kpis.map((k) => k.etiqueta)).toEqual(['Conversaciones', 'Resueltas', 'Derivadas al equipo', 'No entendidas']);
    expect(Number(v.kpis[0]!.valor.replace(/\D/g, ''))).toBeGreaterThan(100);
    expect(v.porDia).toHaveLength(30);
    expect(v.consultas.map((c) => c.texto)).not.toContain('Cortesía');
    expect(v.consultas[0]).toMatchObject({ texto: 'Propuesta', href: expect.stringContaining('/contactos?bot=bot-demo-3&consulta=intencion%3Apropuesta') });
    expect(v.temas.length).toBeGreaterThan(5);
    const menu = v.bot!.embudo[0]!.cajas.find((c) => c.direccion === '1.2')!;
    expect(menu.nombre).toBe('Menú principal');
    expect(menu.opciones).toMatch(/^A Propuestas: \d+ %/);
    expect(v.bot!.recorridos[0]!.texto).toMatch(/^Bienvenida › Menú principal/);
    expect(v.costos?.filas.length).toBeGreaterThan(0);
  });

  it('el lector la ve sin costos ni enlaces a la base de contactos; con todos los bots no hay embudo', async () => {
    const v = await vistaAnalitica(repo, ctx('p-equipo', { bot: 'todos', periodo: '7' }));
    expect(v.costos).toBeNull();
    expect(v.bot).toBeNull();
    expect(v.consultas.every((c) => !c.href)).toBe(true);
    expect(v.porDia).toHaveLength(7);
  });

  it('fechas elegidas (días en UTC, incluido el último) y un filtro que no es de la campaña no filtra', async () => {
    const ahora = new Date('2026-09-29T15:00:00Z');
    expect(periodoDe({ desde: '2026-09-01', hasta: '2026-09-02' }, ahora)).toMatchObject({ desde: '2026-09-01T00:00:00.000Z', hasta: '2026-09-03T00:00:00.000Z', periodo: '' });
    expect(periodoDe({ desde: '2026-09-05', hasta: '2026-09-02' }, ahora).periodo).toBe('30');
    expect(periodoDe({ periodo: 'hoy' }, ahora).desde).toBe('2026-09-29T00:00:00.000Z');
    const v = await vistaAnalitica(repo, ctx('p-lucia', { bot: 'bot-de-otra-campana', canal: 'fax' }));
    expect(v.filtros).toMatchObject({ bot: 'bot-demo-3', canal: '' });
  });

  it('los números sobre el diagrama: visitas, abandono y opciones por caja', async () => {
    const bot = (await repo.bot('bot-demo-3'))!;
    const n = (await numerosDiagrama(repo, ctx('p-lucia'), bot))!;
    expect(n.porCaja.n_menu!.opciones.A).toMatch(/^\d+ %$/);
    expect(Number(n.porCaja.n_bienvenida!.visitas.replace(/\D/g, ''))).toBeGreaterThan(100);
    expect(await numerosDiagrama(repo, ctx('p-lucia'), (await repo.bot('bot-demo-1'))!)).toBeNull();
    const ed = await vistaEditor(repo, ctx('p-lucia', { numeros: 'si' }), 'bot-demo-1');
    expect(ed?.editor).toMatchObject({ numeros: null, numerosVisibles: false });
  });
});

