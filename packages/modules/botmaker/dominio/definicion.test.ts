import { describe, expect, it } from 'vitest';
import set from '../pruebas/set-de-prueba.json';
import {
  buscarDireccion, direccion, direccionCompleta, esquemaDefinicion, idsUsados, letraDeNumero, nuevoId, problemasDeReferencias, RE_ID_CAJA,
  salidasDe, ubicar, validarDefinicion, type Definicion,
} from './definicion';
import { INTENCIONES_POLITICA, plantillaPolitica } from './plantilla-politica';

const base = () => plantillaPolitica({ candidato: 'Ricardo Lombana', partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA', 'Otro Camino'], trato: 'usted', mercado: 'PA' });
const copia = (d: Definicion): Definicion => structuredClone(d);
const codigos = (d: Definicion) => problemasDeReferencias(d).map((p) => p.codigo);

describe('plantilla política', () => {
  it('es una definición válida, con usted y con tú, en Panamá y en Uruguay', () => {
    for (const trato of ['usted', 'tu'] as const) {
      for (const mercado of ['PA', 'UY']) {
        const r = validarDefinicion(plantillaPolitica({ candidato: 'Candidata', trato, mercado }));
        expect(r.ok ? [] : r.problemas).toEqual([]);
      }
    }
  });

  it('trae las 23 intenciones: las de la prueba con saludo y despedida unidas en cortesía', () => {
    const prueba = set.intenciones.map((i) => i.id).filter((i) => i !== 'saludo' && i !== 'despedida');
    expect(INTENCIONES_POLITICA.map((i) => i.id).sort()).toEqual([...prueba, 'cortesia'].sort());
    expect(INTENCIONES_POLITICA.length).toBe(23);
    expect(base().intenciones.every((i) => i.destino !== null)).toBe(true);
  });

  it('los temas del mercado se suman a los generales', () => {
    expect(base().temas.map((t) => t.id)).toContain('css_pensiones');
    expect(plantillaPolitica({ candidato: 'X', trato: 'tu', mercado: 'UY' }).temas.map((t) => t.id)).not.toContain('css_pensiones');
  });

  it('guarda el nombre y los alias del partido para interpretar', () => {
    expect(base().identidad.partido).toEqual({ nombre: 'Movimiento Otro Camino', alias: ['MOCA', 'Otro Camino'] });
  });
});

describe('direcciones', () => {
  it('código humano de cada caja y letra de cada opción', () => {
    const d = base();
    expect(direccion(d, 'n_menu')).toBe('1.2');
    expect(direccion(d, 'n_menu', 'C')).toBe('1.2 › C');
    expect(direccionCompleta(12, d, 'n_consulta')).toBe('v12 · 2.1');
    for (const t of ['1.2 › C', '1.2C', '1.2.c', 'v12 · 1.2 › C']) expect(buscarDireccion(d, t), t).toEqual({ cajaId: 'n_menu', letra: 'C' });
    expect(buscarDireccion(d, '2.1')).toEqual({ cajaId: 'n_consulta' });
    expect(buscarDireccion(d, '1.2 › Z')).toBeNull();
    expect(buscarDireccion(d, '9.9')).toBeNull();
  });

  it('letras: A a Z y después AA', () => {
    expect([1, 26, 27, 52, 702].map(letraDeNumero)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ']);
    expect(() => letraDeNumero(0)).toThrow();
  });

  it('ids nuevos: únicos y con el formato', () => {
    const d = base();
    const usados = idsUsados(d);
    const id = nuevoId('n', usados);
    expect(RE_ID_CAJA.test(id)).toBe(true);
    expect(usados.has(id)).toBe(false);
    // Con un azar que siempre repite, alarga el id hasta encontrar uno libre.
    let i = 0;
    const repetido = () => [0, 0, 0, 0][i++ % 4]!;
    const uno = nuevoId('c', new Set(), repetido);
    expect(nuevoId('c', new Set([uno]), repetido)).toMatch(/^c_a{5}$/);
  });

  it('salidas de cada caja, para el diagrama', () => {
    const d = base();
    const menu = ubicar(d, 'n_menu')!.caja;
    expect(salidasDe(menu).map((s) => s.letra ?? s.etiqueta)).toEqual(['A', 'B', 'C', 'D', 'E', 'Si escriben']);
  });
});

describe('referencias', () => {
  it('un destino que no existe, o en otro flujo sin "Ir a flujo"', () => {
    const d = copia(base());
    const menu = ubicar(d, 'n_menu')!.caja as Extract<Definicion['flujos'][number]['cajas'][number], { tipo: 'menu' }>;
    menu.opciones[0]!.destino = 'n_noexiste';
    menu.opciones[1]!.destino = 'n_consulta';
    const p = problemasDeReferencias(d);
    expect(p.find((x) => x.codigo === 'destino_inexistente')?.donde).toBe('1.2 › A');
    expect(p.find((x) => x.codigo === 'destino_otro_flujo')?.donde).toBe('1.2 › B');
  });

  it('letras y códigos repetidos, o posteriores al último asignado', () => {
    const d = copia(base());
    const menu = ubicar(d, 'n_menu')!.caja as Extract<Definicion['flujos'][number]['cajas'][number], { tipo: 'menu' }>;
    menu.opciones[1]!.letra = 'A';
    menu.opciones[2]!.letra = 'F';
    d.flujos[0]!.cajas[3]!.codigo = 2;
    expect(codigos(d)).toEqual(expect.arrayContaining(['letra_repetida', 'letra_fuera', 'codigo_repetido']));
  });

  it('contenidos, variables, temas e intenciones que no existen', () => {
    const d = copia(base());
    d.contenidos[0]!.texto = 'Hola {{bot.inventada}}';
    d.intenciones[0]!.tema = 'tema_inventado';
    (ubicar(d, 'n_interpretar')!.caja as { rutas: Record<string, string | null> }).rutas = { inventada: 'n_menu' };
    (ubicar(d, 'n_bienvenida')!.caja as { contenido: string }).contenido = 'c_noexiste';
    expect(codigos(d)).toEqual(expect.arrayContaining(['variable_inexistente', 'tema_inexistente', 'intencion_inexistente', 'contenido_inexistente']));
  });

  it('"Ir a flujo" a su propio flujo, y datos pedidos guardados en una variable del bot', () => {
    const d = copia(base());
    (ubicar(d, 'n_irconsul')!.caja as { flujo: string }).flujo = 'f_inicio';
    (ubicar(d, 'n_sumate')!.caja as { variable: string }).variable = 'bot.candidato';
    expect(codigos(d)).toEqual(expect.arrayContaining(['ir_al_mismo_flujo', 'variable_del_bot']));
  });

  it('el formato lo controla zod: ids, límites de canal y tipos', () => {
    const d = copia(base()) as unknown as { flujos: { cajas: Record<string, unknown>[] }[] };
    d.flujos[0]!.cajas[0]!.id = 'caja-1';
    const r = validarDefinicion(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]!.mensaje).toMatch(/id_caja/);
    const e = copia(base());
    const menu = ubicar(e, 'n_menu')!.caja as { opciones: unknown[] };
    menu.opciones.push(...Array.from({ length: 6 }, (_, i) => ({ letra: 'FGHIJK'[i], texto: 'x', destino: null })));
    expect(esquemaDefinicion.safeParse(e).success).toBe(false);
  });
});
