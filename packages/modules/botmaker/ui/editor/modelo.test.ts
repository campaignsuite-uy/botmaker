import { describe, expect, it } from 'vitest';
import { direccion, ubicar } from '../../dominio/definicion';
import { aplicarCambio } from '../../dominio/operaciones';
import { plantillaPolitica } from '../../dominio/plantilla-politica';
import { TIPOS_CAJA } from '../../dominio/definicion';
import { ANCHO_NODO, diagramaDeFlujo, operacionesCajaNueva, operacionesDeFormulario, operacionesFlujoNuevo, salidasConectables, usosDeContenido, valoresDeCaja } from './modelo';

const base = () => plantillaPolitica({ candidato: 'Candidata', trato: 'usted', mercado: 'PA' });

describe('diagrama de un flujo', () => {
  it('una caja por nodo, sin superponerse, con el inicio arriba y flechas solo dentro del flujo', () => {
    const d = base();
    const g = diagramaDeFlujo(d, 'f_inicio');
    expect(g.nodos.map((n) => n.direccion)).toEqual(d.flujos[0]!.cajas.map((c) => `1.${c.codigo}`));
    const inicio = g.nodos.find((n) => n.id === 'n_bienvenida')!;
    expect(inicio).toMatchObject({ inicioFlujo: true, inicioBot: true });
    expect(Math.min(...g.nodos.map((n) => n.y))).toBe(inicio.y);
    for (const a of g.nodos) {
      for (const b of g.nodos) {
        if (a === b) continue;
        const separados = a.x + ANCHO_NODO <= b.x || b.x + ANCHO_NODO <= a.x || a.y + a.alto <= b.y || b.y + b.alto <= a.y;
        expect(separados, `${a.direccion} y ${b.direccion}`).toBe(true);
      }
    }
    const menu = g.nodos.find((n) => n.id === 'n_menu')!;
    expect(menu.salidas.map((s) => `${s.letra ?? s.etiqueta}→${s.destinoTexto}`)).toEqual(['A→1.7', 'B→1.11', 'C→1.8', 'D→1.9', 'E→1.10', 'Si escriben→1.3']);
    expect(g.aristas.every((a) => d.flujos[0]!.cajas.some((c) => c.id === a.hasta))).toBe(true);
    const salto = g.nodos.find((n) => n.id === 'n_irconsul')!;
    expect(salto.salidas[0]).toMatchObject({ destinoTexto: '2.5', otroFlujo: 'f_consultas' });
  });
});

describe('inspector', () => {
  it('sin cambios no hay operaciones', () => {
    const d = base();
    for (const c of d.flujos.flatMap((f) => f.cajas)) expect(operacionesDeFormulario(d, c.id, valoresDeCaja(d, c))).toEqual([]);
  });

  it('nombre, modo, texto del contenido, texto y destino de una opción: un solo cambio que se aplica', () => {
    const d = base();
    const v = valoresDeCaja(d, ubicar(d, 'n_menu')!.caja);
    v.nombre = 'Menú';
    v.modo = 'botones';
    v.contenidoTexto = '¿Qué necesita?';
    v.opciones!.splice(3);
    v.opciones![0]!.texto = 'Qué propone';
    v.opciones![2]!.destino = 'n_noentendi';
    const ops = operacionesDeFormulario(d, 'n_menu', v);
    expect(ops.map((o) => o.tipo)).toEqual(['editar_caja', 'editar_contenido', 'editar_opcion', 'cambiar_ruta']);
    const r = aplicarCambio(d, ops);
    const menu = ubicar(r.definicion, 'n_menu')!.caja as { nombre: string; modo: string; opciones: { texto: string; destino: string }[] };
    expect(menu).toMatchObject({ nombre: 'Menú', modo: 'botones' });
    expect(menu.opciones[0]!.texto).toBe('Qué propone');
    expect(menu.opciones[2]!.destino).toBe('n_noentendi');
    expect(r.definicion.contenidos.find((c) => c.id === 'c_menu')!.texto).toBe('¿Qué necesita?');
  });

  it('dice en qué cajas se usa un contenido', () => {
    expect(usosDeContenido(base(), 'c_cierre')).toEqual(['2.7', '3.6', '5.3', 'sistema (cierre)']);
  });
});

describe('cajas y flujos nuevos', () => {
  it('cada tipo de caja se agrega en un solo cambio válido, conectado desde la salida elegida', () => {
    for (const tipo of TIPOS_CAJA) {
      const d = base();
      const { ops, cajaId } = operacionesCajaNueva(d, 'f_consultas', tipo, { caja: 'n_masayuda', salida: { opcion: 'B' } });
      const r = aplicarCambio(d, ops);
      expect(direccion(r.definicion, cajaId), tipo).toBe('2.8');
      expect((ubicar(r.definicion, 'n_masayuda')!.caja as { opciones: { destino: string }[] }).opciones[1]!.destino).toBe(cajaId);
    }
  });

  it('un flujo nuevo arranca con un mensaje', () => {
    const d = base();
    const { ops, flujoId } = operacionesFlujoNuevo(d, 'Encuesta');
    const r = aplicarCambio(d, ops);
    const f = r.definicion.flujos.find((x) => x.id === flujoId)!;
    expect(f).toMatchObject({ codigo: 6, nombre: 'Encuesta' });
    expect(f.cajas[0]!.tipo).toBe('mensaje');
  });

  it('las salidas conectables de cada caja', () => {
    const d = base();
    expect(salidasConectables(ubicar(d, 'n_masayuda')!.caja).map((s) => s.texto)).toEqual(['Opción A (Ver el menú)', 'Opción B (No, gracias)']);
    expect(salidasConectables(ubicar(d, 'n_atencion')!.caja).map((s) => s.texto)).toEqual(['Caso 1', 'Si no']);
  });
});
