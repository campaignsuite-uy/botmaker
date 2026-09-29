import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { BOT_PUBLICADO } from '../datos/demo/semilla-canal';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { rolEfectivo } from './comun';
import type { ContextoNucleo } from './ejecutar-bots';
import {
  ejecutarBorrarContacto, ejecutarCerrar, ejecutarDevolver, ejecutarExportarContacto, ejecutarGuardarCanal, ejecutarPausar, ejecutarPublicarCondiciones,
  ejecutarResponder, ejecutarRevisar, ejecutarTareas, ejecutarTomar,
} from './ejecutar-bandeja';

const CAMPANA = 'c-pa-2029';
let repo: RepositorioDemo;
let capa: CapaMotores;
const como = (p: string): ContextoNucleo & { campana: { nombre: string; zonaHoraria: string } } => ({ repo, rol: rolEfectivo(nucleoMemoria(), p, CAMPANA), personaId: p, campanaId: CAMPANA, campana: { nombre: 'Generales 2029', zonaHoraria: 'America/Panama' } });

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
  capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
});

describe('bandeja: atender una derivada', () => {
  it('el agente la toma, responde como la campaña, la devuelve al bot y la cierra; la alerta se abre y se cierra', async () => {
    expect((await repo.alertas(CAMPANA, { abiertas: true })).map((a) => [a.tipo, a.ref])).toEqual([['derivada_sin_respuesta', 'conv-demo-2']]);
    expect(await ejecutarTomar(como('p-lucia'), { conversacionId: 'conv-demo-2' })).toEqual({ tipo: 'error', codigo: 'sin_permiso' });
    expect(await ejecutarTomar(como('p-andres'), { conversacionId: 'conv-demo-2' })).toEqual({ tipo: 'ok', codigo: 'conversacion_tomada' });
    expect((await repo.conversacion('conv-demo-2'))!.conversacion).toMatchObject({ estado: 'en_atencion', asignadaA: 'p-andres' });
    expect((await ejecutarResponder(como('p-andres'), { conversacionId: 'conv-demo-2', texto: '  ' })).codigo).toBe('respuesta_vacia');
    expect(await ejecutarResponder(como('p-andres'), { conversacionId: 'conv-demo-2', texto: 'Hola, soy Andrés. ¿En qué barrio es la reunión?' })).toEqual({ tipo: 'ok', codigo: 'respuesta_enviada' });
    const c = (await repo.conversacion('conv-demo-2'))!;
    expect(c.mensajes.at(-1)).toMatchObject({ autor: 'agente', personaId: 'p-andres' });
    expect(await repo.alertas(CAMPANA, { abiertas: true })).toEqual([]);
    expect(await ejecutarDevolver(como('p-andres'), capa, { conversacionId: 'conv-demo-2' })).toEqual({ tipo: 'ok', codigo: 'conversacion_devuelta' });
    expect((await repo.conversacion('conv-demo-2'))!.conversacion).toMatchObject({ estado: 'bot', asignadaA: null });
    expect((await ejecutarDevolver(como('p-andres'), capa, { conversacionId: 'conv-demo-2' })).codigo).toBe('no_derivada');
    expect(await ejecutarCerrar(como('p-joaquin'), { conversacionId: 'conv-demo-2' })).toEqual({ tipo: 'ok', codigo: 'conversacion_cerrada' });
    expect((await ejecutarTomar(como('p-andres'), { conversacionId: 'otra' })).codigo).toBe('no_existe');
  });

  it('una derivada sin respuesta abre la alerta recién a las 2 horas (con fechas simuladas)', async () => {
    const r = new RepositorioDemo({ vacio: true });
    // La de la semilla fue derivada hace 197 minutos: a los 119 minutos todavía no.
    const hace197 = (await repo.conversacion('conv-demo-2'))!.conversacion.derivadaEn!;
    const t = new Date(hace197).getTime();
    expect((await repo.revisarAlertas(new Date(t + 119 * 60_000))).abiertas).toBe(0);
    expect((await repo.revisarAlertas(new Date(t + 121 * 60_000))).abiertas).toBe(1);
    expect((await ejecutarTareas(r, new Date())).alertas).toEqual({ abiertas: 0, cerradas: 0 });
  });

  it('el tope de gasto alcanzado abre una alerta', async () => {
    await repo.registrarLlamada({
      botId: BOT_PUBLICADO, campanaId: CAMPANA, uso: 'en_vivo', funcion: 'responder', motorId: 'gemini-3.1-flash-lite', modelo: 'x', proveedor: 'Google', respaldo: false, ok: true,
      error: null, demoraMs: 800, tokensEntrada: 1, tokensSalida: 1, tokensCache: 0, tokensRazonamiento: null, costoUsd: 5.5, idGeneracion: null, personaId: null,
    });
    expect((await repo.alertas(CAMPANA, { abiertas: true })).map((a) => a.tipo)).toContain('tope_alcanzado');
  });
});

describe('bandeja: revisión por muestreo', () => {
  it('una respuesta correcta se convierte en contenido del borrador; el agente no revisa', async () => {
    const m = await repo.muestra(CAMPANA, { pendientes: true });
    expect(m.map((x) => [x.conversacionId, x.n])).toEqual([['conv-demo-1', 5], ['conv-demo-4', 3]]);
    expect(m[0]).toMatchObject({ pregunta: '¿Qué proponen para el transporte?', secciones: ['S02'] });
    expect((await ejecutarRevisar(como('p-andres'), { conversacionId: 'conv-demo-1', n: 5, veredicto: 'correcta', convertir: true })).codigo).toBe('sin_permiso');
    expect((await ejecutarRevisar(como('p-lucia'), { conversacionId: 'conv-demo-1', n: 4, veredicto: 'correcta', convertir: false })).codigo).toBe('no_muestra');
    expect(await ejecutarRevisar(como('p-lucia'), { conversacionId: 'conv-demo-1', n: 5, veredicto: 'correcta', convertir: true })).toEqual({ tipo: 'ok', codigo: 'respuesta_convertida' });
    const b = (await repo.borrador(BOT_PUBLICADO))!;
    const def = b.definicion as { contenidos: { nombre: string; texto: string }[] };
    expect(def.contenidos.at(-1)).toMatchObject({ nombre: 'Revisada: ¿Qué proponen para el transporte?' });
    expect(await ejecutarRevisar(como('p-lucia'), { conversacionId: 'conv-demo-4', n: 3, veredicto: 'incorrecta', convertir: true })).toEqual({ tipo: 'ok', codigo: 'respuesta_revisada' });
    expect(await repo.muestra(CAMPANA, { pendientes: true })).toEqual([]);
    expect((await repo.muestra(CAMPANA)).map((x) => [x.veredicto, x.convertida])).toEqual([['correcta', true], ['incorrecta', false]]);
  });
});

describe('bandeja: datos de un contacto y borrado', () => {
  it('el administrador exporta y borra los datos de un contacto; queda registrado', async () => {
    expect((await repo.buscarContactos(CAMPANA, 'Rosa', 'p-joaquin')).map((x) => x.contacto.id)).toEqual(['ct-demo-3']);
    expect((await repo.buscarContactos(CAMPANA, 'Belisario', 'p-joaquin')).map((x) => x.contacto.id)).toEqual(['ct-demo-3']);
    expect((await ejecutarExportarContacto(como('p-andres'), { contactoId: 'ct-demo-3' })).codigo).toBe('sin_permiso');
    const x = await ejecutarExportarContacto(como('p-joaquin'), { contactoId: 'ct-demo-3' });
    expect(x.tipo === 'ok' && x.datos.conversaciones[0]!.mensajes.some((m) => m.texto === 'Rosa')).toBe(true);
    expect((await ejecutarBorrarContacto(como('p-joaquin'), { contactoId: 'ct-demo-3', nota: '', confirmar: 'si' })).codigo).toBe('confirmar_borrado');
    expect(await ejecutarBorrarContacto(como('p-joaquin'), { contactoId: 'ct-demo-3', nota: 'Lo pidió por correo', confirmar: 'BORRAR' })).toEqual({ tipo: 'ok', codigo: 'contacto_borrado' });
    const c = (await repo.conversacion('conv-demo-3'))!;
    expect(c.contacto).toMatchObject({ nombre: null, datos: {} });
    expect(c.mensajes.every((m) => m.texto === null)).toBe(true);
    expect((await repo.pedidosDatos(CAMPANA)).map((p) => p.tipo)).toEqual(['borrar', 'exportar']);
    expect(await repo.buscarContactos(CAMPANA, 'Rosa', 'p-joaquin')).toEqual([]);
  });

  it('el borrado por vencimiento vacía los textos pasados los días de guardado (con fechas simuladas)', async () => {
    const en89 = new Date(Date.now() + 77 * 864e5);
    expect(await repo.borrarVencidos(en89)).toBe(0);
    const en100 = new Date(Date.now() + 100 * 864e5);
    expect(await ejecutarTareas(repo, en100)).toMatchObject({ borrados: 28 });
    expect((await repo.conversacion('conv-demo-4'))!.mensajes.every((m) => m.texto === null)).toBe(true);
    // El contacto queda en la base de contactos: sus datos se borran a pedido, no por vencimiento.
    expect((await repo.conversacion('conv-demo-4'))!.contacto.nombre).toBe('Marcos');
  });
});

describe('canal web: ajustes', () => {
  it('canal, condiciones y pausa: cada cosa con su permiso', async () => {
    expect((await ejecutarGuardarCanal(como('p-lucia'), { botId: BOT_PUBLICADO, activo: false, modoCondiciones: 'aviso' })).codigo).toBe('sin_permiso');
    expect(await ejecutarGuardarCanal(como('p-joaquin'), { botId: BOT_PUBLICADO, activo: false, modoCondiciones: 'acepto' })).toEqual({ tipo: 'ok', codigo: 'canal_guardado' });
    expect(await repo.canalWeb(BOT_PUBLICADO)).toEqual({ activo: false, modoCondiciones: 'acepto' });
    expect((await ejecutarGuardarCanal(como('p-joaquin'), { botId: BOT_PUBLICADO, activo: true, modoCondiciones: 'otro' })).codigo).toBe('datos');
    const texto = (await repo.condiciones(BOT_PUBLICADO))[0]!.texto;
    expect((await ejecutarPublicarCondiciones(como('p-joaquin'), { botId: BOT_PUBLICADO, texto })).codigo).toBe('condiciones_iguales');
    expect(await ejecutarPublicarCondiciones(como('p-joaquin'), { botId: BOT_PUBLICADO, texto: `${texto}\n\nVersión 2.` })).toEqual({ tipo: 'ok', codigo: 'condiciones_publicadas' });
    expect((await repo.condiciones(BOT_PUBLICADO)).map((c) => c.numero)).toEqual([2, 1]);
    expect((await ejecutarPausar(como('p-lucia'), { botId: BOT_PUBLICADO, pausar: true })).codigo).toBe('sin_permiso');
    expect(await ejecutarPausar(como('p-joaquin'), { botId: BOT_PUBLICADO, pausar: true })).toEqual({ tipo: 'ok', codigo: 'bot_pausado' });
    expect((await ejecutarPausar(como('p-joaquin'), { botId: BOT_PUBLICADO, pausar: true })).codigo).toBe('no_publicado');
    expect(await ejecutarPausar(como('p-joaquin'), { botId: BOT_PUBLICADO, pausar: false })).toEqual({ tipo: 'ok', codigo: 'bot_reanudado' });
    expect((await ejecutarPausar(como('p-joaquin'), { botId: 'bot-demo-1', pausar: true })).codigo).toBe('no_publicado');
  });
});
