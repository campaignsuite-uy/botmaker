import { beforeEach, describe, expect, it } from 'vitest';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import { borradorLegible, resolverDirecciones, revisarPropuesta } from '../dominio/copiloto';
import { ubicar, type Definicion } from '../dominio/definicion';
import { plantillaPolitica } from '../dominio/plantilla-politica';
import { CapaMotores } from '../motores/capa';
import { instruccionesCopiloto } from '../motores/prompts';
import { AdaptadorSimulado } from '../motores/simulado';
import { rolEfectivo } from './comun';
import type { ContextoNucleo } from './ejecutar-bots';
import { ejecutarDeshacer } from './ejecutar-borrador';
import { ejecutarAplicarCopiloto, ejecutarPedirCopiloto } from './ejecutar-copiloto';

const CAMPANA = 'c-pa-2029';
const BOT = 'bot-demo-1';
let repo: RepositorioDemo;
let capa: CapaMotores;
const como = (p: string): ContextoNucleo & { campana: { nombre: string } } => ({ repo, rol: rolEfectivo(nucleoMemoria(), p, CAMPANA), personaId: p, campanaId: CAMPANA, campana: { nombre: 'Generales 2029' } });
const plantilla = () => plantillaPolitica({ candidato: 'Candidata', partido: 'Partido Uno', trato: 'usted', mercado: 'PA' });

beforeEach(() => {
  reiniciarNucleoMemoria();
  repo = new RepositorioDemo();
  capa = new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
});

describe('copiloto: borrador legible y direcciones', () => {
  it('el borrador legible lleva cada caja con su dirección, id, texto y adónde lleva', () => {
    const t = borradorLegible(plantilla());
    expect(t).toContain('## Flujo 1 [f_inicio]');
    expect(t).toMatch(/1\.2 \[n_menu\] Menú · Menú principal \(lista\): c_menu «/);
    expect(t).toContain('   1.2 › C «Sumarme» (Ser voluntario) → 1.8 [n_irsumate]');
    expect(t).toMatch(/- voluntariado: Voluntariado · .* · 2 frases: «Quiero ayudar en la campaña»/);
  });

  it('las direcciones pasan a ids: cajas, destinos, flujos y opciones', () => {
    const d = plantilla();
    expect(resolverDirecciones(d, 'agregar_opcion', { caja: '1.2', texto: 'X', destino: '2.2' })).toEqual({ caja: 'n_menu', texto: 'X', destino: 'n_masayuda' });
    expect(resolverDirecciones(d, 'editar_opcion', { caja: '1.2 › B', texto: 'Y' })).toEqual({ caja: 'n_menu', letra: 'B', texto: 'Y' });
    expect(resolverDirecciones(d, 'cambiar_ruta', { caja: '1.2 › B', destino: '2.2' })).toEqual({ caja: 'n_menu', salida: { opcion: 'B' }, destino: 'n_masayuda' });
    expect(resolverDirecciones(d, 'agregar_caja', { flujo: '2', caja: { tipo: 'mensaje', contenido: 'c_menu', siguiente: '1.2' }, desde: { caja: '2.2 › A' } })).toEqual({
      flujo: 'f_consultas', caja: { tipo: 'mensaje', contenido: 'c_menu', siguiente: 'n_menu' }, desde: { caja: 'n_masayuda', salida: { opcion: 'A' } },
    });
    expect(resolverDirecciones(d, 'editar_caja', { caja: '1.3', cambios: { rutas: { voluntariado: '2.2' } } })).toEqual({ caja: 'n_interpretar', cambios: { rutas: { voluntariado: 'n_masayuda' } } });
    // Lo que no es una dirección queda igual (y la validación dice qué está mal).
    expect(resolverDirecciones(d, 'quitar_caja', { caja: '9.9' })).toEqual({ caja: '9.9' });
  });

  it('la propuesta se revisa en orden: una operación usa lo que creó la anterior; las que no sirven quedan marcadas', () => {
    const d = plantilla();
    const r = revisarPropuesta(d, {
      explicacion: 'Voluntariado en el menú', dudas: [],
      operaciones: [
        { tipo: 'agregar_contenido', datos: { contenido: { id: 'c_volunt', nombre: 'Voluntariado', texto: '¡Gracias por sumarse!' } }, explicacion: 'Texto' },
        { tipo: 'agregar_caja', datos: { flujo: '1', caja: { id: 'n_volunt', tipo: 'mensaje', contenido: 'c_volunt', siguiente: null } }, explicacion: 'Caja' },
        { tipo: 'agregar_opcion', datos: { caja: '1.2', texto: 'Voluntariado', destino: 'n_volunt' }, explicacion: 'Opción' },
        { tipo: 'agregar_opcion', datos: { caja: '8.1', texto: 'Nada' }, explicacion: 'No existe' },
        { tipo: 'restaurar', datos: { partes: {} }, explicacion: 'No permitido' },
        { tipo: 'agregar_contenido', datos: { contenido: { nombre: 'Sin id', texto: 'Hola' } }, explicacion: 'Id elegido por el sistema' },
      ],
    }, () => 0.5);
    expect(r.items.map((i) => [i.resumen, i.error === null])).toEqual([
      ['Agregó el contenido Voluntariado', true],
      ['Agregó la caja 1.12 (mensaje)', true],
      ['Agregó la opción 1.2 › F', true],
      ['', false],
      ['', false],
      ['Agregó el contenido Sin id', true],
    ]);
    expect(r.items[3]!.error).toMatch(/caja/i);
    expect(r.items[4]!.error).toMatch(/no puede hacer "restaurar"/);
    // El id que eligió el sistema queda fijo en la operación.
    expect((r.items[5]!.operacion as { contenido: { id?: string } }).contenido.id).toMatch(/^c_[a-z0-9]{4}$/);
  });

  it('las instrucciones llevan la tarea, el catálogo, el borrador legible y los avisos', () => {
    const d = plantilla();
    const i = instruccionesCopiloto(
      { nombreBot: 'Asistente', campana: 'Generales 2029', mercado: 'PA', caso: 'electoral', trato: 'usted' },
      { pedido: 'En 1.2 agregá Voluntariado', modo: 'frases', borrador: borradorLegible(d), avisos: ['Aviso en 2.2: sin probar'] },
    );
    expect(i.sistema).toContain('## Tarea: Frases de ejemplo');
    expect(i.sistema).toContain('- agregar_opcion: {"caja": "n_xxxx o 2.4"');
    expect(i.sistema).not.toContain('- restaurar');
    expect(i.sistema).toContain('de usted');
    expect(i.usuario).toContain('1.2 [n_menu]');
    expect(i.usuario).toContain('LO QUE MARCA EL VALIDADOR:\n- Aviso en 2.2: sin probar');
    expect(i.usuario.endsWith('PEDIDO DEL EQUIPO:\nEn 1.2 agregá Voluntariado')).toBe(true);
  });
});

describe('copiloto: pedir y aplicar', () => {
  it('"en 1.2 agregá la opción de voluntariado": propone, se aplica como cambio del copiloto y se deshace', async () => {
    const r = await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'cambios', pedido: 'En 1.2 agregá la opción de voluntariado' });
    if (!r.ok) throw new Error(r.codigo);
    expect(r.simulado).toBe(true);
    expect(r.items).toHaveLength(1);
    const item = r.items[0]!;
    expect(item).toMatchObject({ tipo: 'agregar_opcion', resumen: 'Agregó la opción 1.2 › F', error: null });
    // La intención voluntariado va a 3.2 (otro flujo): la opción va a la caja "Ir a flujo" de 1.2 que lleva ahí.
    const antes = (await repo.borrador(BOT))!.definicion as Definicion;
    expect(antes.intenciones.find((i) => i.id === 'voluntariado')!.destino).toBe('n_sumate');
    expect(item.operacion).toEqual({ tipo: 'agregar_opcion', caja: 'n_menu', texto: 'Voluntariado', destino: 'n_irsumate' });

    const a = await ejecutarAplicarCopiloto(como('p-lucia'), { botId: BOT, seq: r.seq, operaciones: [item.operacion] });
    if (!a.ok) throw new Error(a.codigo);
    expect(a.resumen).toBe('Agregó la opción 1.2 › F');
    const cambios = await repo.cambios(a.versionId);
    expect(cambios.at(-1)).toMatchObject({ origen: 'copiloto', resumen: 'Agregó la opción 1.2 › F' });
    const menu = ubicar(a.definicion, 'n_menu')!.caja as { opciones: { letra: string; texto: string }[] };
    expect(menu.opciones.at(-1)).toMatchObject({ letra: 'F', texto: 'Voluntariado' });
    // Aplicar dos veces la misma propuesta: el borrador ya cambió.
    expect(await ejecutarAplicarCopiloto(como('p-lucia'), { botId: BOT, seq: r.seq, operaciones: [item.operacion] })).toEqual({ ok: false, codigo: 'copiloto_viejo' });
    const d = await ejecutarDeshacer(como('p-lucia'), { botId: BOT, seq: a.seq });
    expect(d.ok && (ubicar(d.definicion, 'n_menu')!.caja as { opciones: unknown[] }).opciones.length).toBe(5);
  });

  it('frases, revisión y armar con el motor simulado', async () => {
    const f = await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'frases', pedido: 'Frases para todas' });
    if (!f.ok) throw new Error(f.codigo);
    expect(f.items.length).toBeGreaterThan(3);
    expect(f.items.every((i) => i.tipo === 'editar_intencion' && i.error === null)).toBe(true);
    const a = await ejecutarAplicarCopiloto(como('p-lucia'), { botId: BOT, seq: f.seq, operaciones: f.items.map((i) => i.operacion) });
    expect(a.ok).toBe(true);
    const rv = await ejecutarPedirCopiloto(como('p-joaquin'), capa, { botId: BOT, modo: 'revision', pedido: 'Revisá el bot' });
    expect(rv.ok && rv.items.length === 0 && rv.dudas.length > 0).toBe(true);
    const ar = await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'armar', pedido: 'Adaptalo a la campaña' });
    expect(ar.ok && ar.items[0]!.resumen).toMatch(/^Editó el contenido/);
  });

  it('permisos y pedidos que no sirven', async () => {
    expect(await ejecutarPedirCopiloto(como('p-equipo'), capa, { botId: BOT, modo: 'cambios', pedido: 'x' })).toEqual({ ok: false, codigo: 'sin_permiso' });
    expect(await ejecutarPedirCopiloto(como('p-andres'), capa, { botId: BOT, modo: 'cambios', pedido: 'x' })).toEqual({ ok: false, codigo: 'sin_permiso' });
    expect(await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'cambios', pedido: '  ' })).toEqual({ ok: false, codigo: 'pedido_vacio' });
    expect(await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: 'otro', modo: 'cambios', pedido: 'x' })).toEqual({ ok: false, codigo: 'no_existe' });
    expect(await ejecutarAplicarCopiloto(como('p-equipo'), { botId: BOT, seq: 0, operaciones: [{ tipo: 'quitar_caja', caja: 'n_soybot' }] })).toMatchObject({ ok: false, codigo: 'sin_permiso' });
    expect(await ejecutarAplicarCopiloto(como('p-lucia'), { botId: BOT, seq: 0, operaciones: [] })).toEqual({ ok: false, codigo: 'nada_marcado' });
    // Un pedido que el simulado no entiende: explica qué entiende y no propone nada.
    const r = await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'cambios', pedido: 'Hacelo más lindo' });
    expect(r.ok && r.items.length === 0 && r.explicacion).toMatch(/entiende pedidos como/);
    // Una caja que no existe va a dudas.
    const n = await ejecutarPedirCopiloto(como('p-lucia'), capa, { botId: BOT, modo: 'cambios', pedido: 'En 9.9 agregá la opción Prensa' });
    expect(n.ok && n.dudas).toEqual(['No hay una caja 9.9 en el borrador.']);
  });
});
