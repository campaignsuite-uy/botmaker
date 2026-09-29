import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { direccion, ubicar, type Definicion } from './definicion';
import { aplicarCambio, aplicarOperacion, operacionImportar } from './operaciones';
import { plantillaPolitica } from './plantilla-politica';
import { exportarYaml, importarYaml } from './yaml';

const base = () => plantillaPolitica({ candidato: 'Candidata', partido: 'Partido Uno', aliasPartido: ['PU'], trato: 'usted', mercado: 'PA' });
const texto = (d: Definicion) => JSON.stringify(d);
const lineaCon = (yaml: string, trozo: string) => yaml.split('\n').findIndex((l) => l.includes(trozo)) + 1;

describe('YAML', () => {
  it('un YAML exportado se vuelve a importar sin diferencias', () => {
    const d = base();
    const y = exportarYaml(d, ['Bot: Asistente · v1 (borrador)']);
    const r = importarYaml(y, d);
    expect(r.ok && texto(r.definicion)).toBe(texto(d));
    expect(r.ok && operacionImportar(d, r.definicion)).toBeNull();
  });

  it('cada caja lleva su dirección en un comentario, y el encabezado dice qué es', () => {
    const y = exportarYaml(base(), ['Bot: Asistente · v1 (borrador)']);
    expect(y.startsWith('# Bot: Asistente · v1 (borrador)\n')).toBe(true);
    expect(y).toContain('# 1.2 · Menú · Menú principal');
    expect(y).toContain('# Flujo 2 · Consultas');
    expect(y).toContain('# 2.1 · Respuesta con base · Respuesta con base');
  });

  it('un error de sintaxis vuelve con su línea', () => {
    const r = importarYaml('formato: 1\ninicio: n_bienvenida\n  flujos: [\n');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problemas[0]!.linea).toBeGreaterThan(0);
    expect(!r.ok && r.problemas[0]!.mensaje).toMatch(/No se puede leer/);
  });

  it('un error de formato vuelve con la caja, el campo y la línea', () => {
    const y = exportarYaml(base()).replace('modo: lista', 'modo: rueda');
    const r = importarYaml(y, base());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas[0]).toEqual({ linea: lineaCon(y, 'modo: rueda'), mensaje: expect.stringMatching(/^Caja 1\.2, modo: no es un valor admitido/) });
    }
  });

  it('un destino que no existe vuelve con la línea de la opción', () => {
    const d = base();
    const x = parse(exportarYaml(d));
    x.flujos[0].cajas[1].opciones[1].destino = 'n_noexiste';
    const y = stringify(x);
    const r = importarYaml(y, d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas[0]!.mensaje).toMatch(/1\.2 › B va a una caja que no existe/);
      const linea = r.problemas[0]!.linea!;
      expect(y.split('\n').slice(linea - 1, linea + 3).join('\n')).toMatch(/letra: B/);
    }
  });

  it('lo nuevo se completa solo: código de caja, letra de opción e id; los últimos no bajan', () => {
    const d = base();
    const x = parse(exportarYaml(d));
    const consultas = x.flujos[1];
    consultas.cajas.push({ id: 'n_nueva1', tipo: 'mensaje', contenido: 'c_cierre' });
    consultas.cajas.push({ tipo: 'mensaje', contenido: 'c_cierre' });
    consultas.cajas[1].opciones.push({ texto: 'Otra', destino: 'n_nueva1' });
    consultas.ultimoCodigo = 1;
    const r = importarYaml(stringify(x), d, { azar: () => 0.5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(direccion(r.definicion, 'n_nueva1')).toBe('2.8');
      const nuevas = r.definicion.flujos[1]!.cajas.slice(-2);
      expect(nuevas.map((c) => c.codigo)).toEqual([8, 9]);
      expect(nuevas[1]!.id).toMatch(/^n_[a-z0-9]{4}$/);
      expect(r.definicion.flujos[1]!.ultimoCodigo).toBe(9);
      const masayuda = ubicar(r.definicion, 'n_masayuda')!.caja as { opciones: { letra: string }[]; ultimaLetra: number };
      expect(masayuda.opciones.map((o) => o.letra)).toEqual(['A', 'B', 'C']);
      expect(masayuda.ultimaLetra).toBe(3);
    }
  });

  it('importar es un cambio: resume qué cambió y se deshace', () => {
    const d = base();
    const x = parse(exportarYaml(d));
    x.flujos[0].nombre = 'Entrada';
    x.intenciones = x.intenciones.filter((i: { id: string }) => i.id !== 'prensa');
    x.temas.push({ id: 'deporte', nombre: 'Deporte' });
    x.contenidos[0].texto = 'Hola de nuevo.';
    const r = importarYaml(stringify(x), d);
    if (!r.ok) throw new Error(JSON.stringify(r.problemas));
    const op = operacionImportar(d, r.definicion)!;
    const c = aplicarCambio(d, [op]);
    expect(c.resumen).toBe('Importó el YAML: cambió 1 flujo y 1 contenido; agregó 1 tema; quitó 1 intención y 2 casos de prueba');
    expect(texto(c.definicion)).toBe(texto(r.definicion));
    expect(texto(aplicarOperacion(c.definicion, c.inversa).definicion)).toBe(texto(d));
  });

  it('rechaza lo que no es un bot y lo que es demasiado largo', () => {
    expect(importarYaml('- a\n- b').ok).toBe(false);
    expect(importarYaml('x'.repeat(1_600_000)).ok).toBe(false);
  });
});
