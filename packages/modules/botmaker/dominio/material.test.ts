import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { materialPara, validarDefinicion, type Definicion } from './definicion';
import { asignarCodigos, dividirMaterial, materialComoTexto, tokensAproximados } from './material';
import { aplicarCambio, aplicarOperacion } from './operaciones';
import { plantillaPolitica } from './plantilla-politica';
import { exportarYaml, importarYaml } from './yaml';

const MATERIAL = readFileSync(new URL('../pruebas/material-prueba.md', import.meta.url), 'utf8');
const base = () => plantillaPolitica({ candidato: 'Ricardo Lombana', partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA'], trato: 'usted', mercado: 'PA' });
const texto = (d: Definicion) => JSON.stringify(d);

describe('material por secciones', () => {
  it('el material de la prueba queda en 27 secciones con su código, título y fuente', () => {
    const r = dividirMaterial(MATERIAL);
    expect(r.avisos).toEqual([]);
    expect(r.secciones).toHaveLength(27);
    expect(r.secciones[0]).toMatchObject({ codigo: 'S01', titulo: 'Quién es Ricardo Lombana' });
    expect(r.secciones[0]!.fuente).toMatch(/otrocamino\.org\/lombana/);
    expect(r.secciones[0]!.texto).not.toMatch(/^Fuentes:/m);
    expect(r.secciones.every((s) => s.fuente)).toBe(true);
    expect(tokensAproximados(r.secciones)).toBeGreaterThan(6000);
  });

  it('sin código se asigna el siguiente; un código ocupado no se reusa', () => {
    const r = dividirMaterial('## Uno\nTexto uno.\nTemas: salud\n\n## [S01] Dos\nTexto dos.\nFecha: 2026-09-01\nFuente: Diario, 1/9/2026');
    const { secciones, ultima } = asignarCodigos(r.secciones, new Set(['S01']), 1);
    expect(secciones.map((s) => s.codigo)).toEqual(['S02', 'S03']);
    expect(ultima).toBe(3);
    expect(secciones[1]).toMatchObject({ fecha: '2026-09-01', fuente: 'Diario, 1/9/2026' });
    expect(secciones[0]!.temas).toEqual(['salud']);
    expect(dividirMaterial('Solo texto, sin títulos').avisos[0]).toMatch(/ninguna sección/);
  });

  it('cargar el material es un cambio que se deshace; agregar suma sin pisar códigos', () => {
    const d = base();
    const r = aplicarCambio(d, [{ tipo: 'cargar_material', texto: MATERIAL, reemplazar: true }]);
    expect(r.resumen).toBe('Cargó el material: 27 secciones');
    expect(r.definicion.material).toHaveLength(27);
    expect(r.definicion.ultimaSeccion).toBe(27);
    expect(validarDefinicion(r.definicion).ok).toBe(true);
    expect(texto(aplicarOperacion(r.definicion, r.inversa).definicion)).toBe(texto(d));
    const mas = aplicarCambio(r.definicion, [{ tipo: 'cargar_material', texto: '## [S05] Otra\nTexto.' }]);
    expect(mas.definicion.material.at(-1)!.codigo).toBe('S28');
    const q = aplicarCambio(mas.definicion, [{ tipo: 'quitar_seccion', seccion: 'S28' }, { tipo: 'agregar_seccion', seccion: { titulo: 'Nueva', texto: 'Algo.' } }]);
    expect(q.definicion.material.at(-1)!.codigo).toBe('S29');
    const e = aplicarCambio(q.definicion, [{ tipo: 'editar_seccion', seccion: 'S01', cambios: { temas: ['educacion'], fecha: '2026-09-28' } }]);
    expect(e.definicion.material[0]).toMatchObject({ temas: ['educacion'], fecha: '2026-09-28' });
  });

  it('una caja con temas usa esas secciones y las generales', () => {
    const d = aplicarCambio(base(), [{ tipo: 'cargar_material', texto: '## A\nGeneral.\n\n## B\nSalud.\nTemas: salud\n\n## C\nAgua.\nTemas: agua', reemplazar: true }]).definicion;
    expect(materialPara(d, []).map((s) => s.titulo)).toEqual(['A', 'B', 'C']);
    expect(materialPara(d, ['salud']).map((s) => s.titulo)).toEqual(['A', 'B']);
  });

  it('el material vuelve a texto en el mismo formato', () => {
    const r = dividirMaterial(MATERIAL);
    const { secciones } = asignarCodigos(r.secciones, new Set(), 0);
    const otra = dividirMaterial(materialComoTexto(secciones));
    expect(otra.secciones.map((s) => [s.codigo, s.titulo, s.fuente])).toEqual(secciones.map((s) => [s.codigo, s.titulo, s.fuente]));
  });

  it('el YAML no lleva el material, y al importarlo queda el que estaba', () => {
    const d = aplicarCambio(base(), [{ tipo: 'cargar_material', texto: MATERIAL, reemplazar: true }]).definicion;
    const y = exportarYaml(d);
    expect(y).not.toContain('## [S01]');
    expect(y).not.toContain('Ricardo Alberto Lombana González');
    const r = importarYaml(y, d);
    expect(r.ok && texto(r.definicion)).toBe(texto(d));
  });
});

describe('material de la demo', () => {
  it('el módulo de la demo es igual al material de prueba', async () => {
    const { MATERIAL_DEMO } = await import('../datos/demo/material-demo');
    expect(MATERIAL_DEMO).toBe(MATERIAL);
  });
});
