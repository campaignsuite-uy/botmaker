import { describe, expect, it } from 'vitest';
import { direccion, ubicar, type Definicion } from './definicion';
import { aplicarOperacion, aplicarOperaciones, ErrorOperacion, type OperacionEntrada } from './operaciones';
import { plantillaPolitica } from './plantilla-politica';

const base = () => plantillaPolitica({ candidato: 'Ricardo Lombana', partido: 'Movimiento Otro Camino', trato: 'usted', mercado: 'PA' });
/** Azar fijo: ids reproducibles. */
function azarFijo(semilla = 7) {
  let s = semilla;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const texto = (d: Definicion) => JSON.stringify(d);
const falla = (d: Definicion, op: unknown): ErrorOperacion => {
  try {
    aplicarOperacion(d, op);
  } catch (e) {
    if (e instanceof ErrorOperacion) return e;
    throw e;
  }
  throw new Error(`No falló: ${JSON.stringify(op)}`);
};

/** Operaciones variadas sobre la plantilla, para la prueba de ida y vuelta. */
const OPERACIONES: OperacionEntrada[] = [
  { tipo: 'agregar_caja', flujo: 'f_consultas', caja: { tipo: 'mensaje', contenido: 'c_masayuda', siguiente: null }, desde: { caja: 'n_masayuda', salida: { opcion: 'B' } } },
  { tipo: 'editar_caja', caja: 'n_menu', cambios: { nombre: 'Menú', modo: 'botones' } },
  { tipo: 'cambiar_ruta', caja: 'n_interpretar', salida: 'noEntendio', destino: 'n_noentendi' },
  { tipo: 'cambiar_ruta', caja: 'n_interpretar', salida: { intencion: 'apoyo' }, destino: 'n_menu' },
  { tipo: 'agregar_opcion', caja: 'n_masayuda', texto: 'Hablar con alguien', destino: 'n_irmenu' },
  { tipo: 'editar_opcion', caja: 'n_menu', letra: 'A', texto: 'Qué propone' },
  { tipo: 'quitar_opcion', caja: 'n_menu', letra: 'E' },
  { tipo: 'quitar_caja', caja: 'n_limite' },
  { tipo: 'agregar_flujo', nombre: 'Encuesta', primera: { tipo: 'mensaje', contenido: 'c_masayuda', siguiente: null } },
  { tipo: 'renombrar_flujo', flujo: 'f_datos', nombre: 'Tus datos' },
  { tipo: 'agregar_contenido', contenido: { nombre: 'Nuevo', texto: 'Hola, {{contacto.nombre}}' } },
  { tipo: 'editar_contenido', contenido: 'c_bienvenida', cambios: { texto: 'Bienvenido. Soy el asistente de {{bot.candidato}}.' } },
  { tipo: 'agregar_intencion', intencion: { id: 'encuestas', nombre: 'Encuestas', descripcion: 'Pregunta por encuestas.', destino: 'n_irconsul' } },
  { tipo: 'editar_intencion', intencion: 'propuesta', cambios: { frases: ['¿Qué propone?'], tema: 'salud' } },
  { tipo: 'quitar_intencion', intencion: 'prensa' },
  { tipo: 'agregar_tema', tema: { id: 'deporte', nombre: 'Deporte' } },
  { tipo: 'quitar_tema', tema: 'agua' },
  { tipo: 'agregar_variable', variable: { nombre: 'bot.web', valor: 'otrocamino.org' } },
  { tipo: 'editar_variable', variable: 'bot.horario', cambios: { valor: 'de 8 a 20' } },
  { tipo: 'editar_identidad', partido: { alias: ['MOCA', 'Otro Camino'] } },
  { tipo: 'editar_contacto', consultas: { canal: 'correo', valor: 'consultas@ejemplo.org' } },
  { tipo: 'cambiar_inicio', caja: 'n_menu' },
  { tipo: 'cambiar_texto_libre', caja: 'n_menu' },
  { tipo: 'cambiar_inicio_flujo', flujo: 'f_consultas', caja: 'n_masayuda' },
  { tipo: 'editar_sistema', clave: 'cierre', contenido: 'c_masayuda' },
  { tipo: 'quitar_flujo', flujo: 'f_datos' },
];

describe('capa de operaciones', () => {
  it('cada operación se deshace aplicando su inversa, y la inversa de la inversa la rehace', () => {
    for (const op of OPERACIONES) {
      const antes = base();
      const r = aplicarOperacion(antes, op, { azar: azarFijo() });
      expect(texto(r.definicion), op.tipo).not.toBe(texto(antes));
      const deshecho = aplicarOperacion(r.definicion, r.inversa);
      expect(texto(deshecho.definicion), `deshacer ${op.tipo}`).toBe(texto(antes));
      const rehecho = aplicarOperacion(deshecho.definicion, deshecho.inversa);
      expect(texto(rehecho.definicion), `rehacer ${op.tipo}`).toBe(texto(r.definicion));
    }
  });

  it('una serie entera también vuelve atrás deshaciendo en orden inverso', () => {
    const antes = base();
    const { definicion, inversas } = aplicarOperaciones(antes, OPERACIONES.slice(0, 10), { azar: azarFijo() });
    let d = definicion;
    for (const inv of [...inversas].reverse()) d = aplicarOperacion(d, inv).definicion;
    expect(texto(d)).toBe(texto(antes));
  });

  it('agregar una caja le da el código siguiente y la conecta desde la salida elegida', () => {
    const r = aplicarOperacion(base(), OPERACIONES[0], { azar: azarFijo() });
    expect(direccion(r.definicion, r.creado!)).toBe('2.7');
    expect(r.resumen).toBe('Agregó la caja 2.7 (mensaje)');
    const menu = ubicar(r.definicion, 'n_masayuda')!.caja as { opciones: { letra: string; destino: string | null }[] };
    expect(menu.opciones.find((o) => o.letra === 'B')?.destino).toBe(r.creado);
  });

  it('los códigos y las letras no se reusan', () => {
    let d = base();
    d = aplicarOperacion(d, { tipo: 'quitar_opcion', caja: 'n_menu', letra: 'E' }).definicion;
    const op = aplicarOperacion(d, { tipo: 'agregar_opcion', caja: 'n_menu', texto: 'Otra', destino: null });
    expect(op.creado).toBe('F');
    d = aplicarOperacion(d, { tipo: 'cambiar_inicio_flujo', flujo: 'f_consultas', caja: 'n_masayuda' }).definicion;
    d = aplicarOperacion(d, { tipo: 'quitar_caja', caja: 'n_irmenu' }).definicion;
    const nueva = aplicarOperacion(d, { tipo: 'agregar_caja', flujo: 'f_consultas', caja: { tipo: 'mensaje', contenido: 'c_masayuda', siguiente: null } });
    expect(direccion(nueva.definicion, nueva.creado!)).toBe('2.7');
  });

  it('quitar una caja deja sin destino lo que apuntaba a ella; la de inicio no se quita', () => {
    const r = aplicarOperacion(base(), { tipo: 'quitar_caja', caja: 'n_limite' });
    expect(r.definicion.intenciones.find((i) => i.id === 'fuera_de_tema')?.destino).toBeNull();
    expect(falla(base(), { tipo: 'quitar_caja', caja: 'n_bienvenida' }).codigo).toBe('es_inicio');
    expect(falla(base(), { tipo: 'quitar_caja', caja: 'n_consulta' }).codigo).toBe('es_inicio');
  });

  it('rechaza lo que dejaría el bot inválido, sin cambiar nada', () => {
    const d = base();
    const antes = texto(d);
    expect(falla(d, { tipo: 'cambiar_ruta', caja: 'n_menu', salida: { opcion: 'A' }, destino: 'n_noexiste' }).codigo).toBe('definicion_invalida');
    const otro = falla(d, { tipo: 'cambiar_ruta', caja: 'n_menu', salida: { opcion: 'A' }, destino: 'n_consulta' });
    expect(otro.problemas[0]?.codigo).toBe('destino_otro_flujo');
    expect(falla(d, { tipo: 'quitar_contenido', contenido: 'c_menu' }).codigo).toBe('contenido_en_uso');
    expect(falla(d, { tipo: 'quitar_variable', variable: 'contacto.nombre' }).codigo).toBe('variable_en_uso');
    expect(falla(d, { tipo: 'editar_caja', caja: 'n_menu', cambios: { codigo: 9 } }).codigo).toBe('campo_fijo');
    expect(falla(d, { tipo: 'editar_caja', caja: 'n_menu', cambios: { modo: 'rueda' } }).codigo).toBe('caja_invalida');
    expect(falla(d, { tipo: 'volar' }).codigo).toBe('operacion_invalida');
    expect(falla(d, { tipo: 'agregar_intencion', intencion: { id: 'propuesta', nombre: 'x', descripcion: 'x', destino: null } }).codigo).toBe('id_repetido');
    expect(texto(d)).toBe(antes);
  });

  it('quitar una intención borra sus rutas; quitar un tema lo saca de intenciones y cajas', () => {
    let d = aplicarOperacion(base(), { tipo: 'cambiar_ruta', caja: 'n_interpretar', salida: { intencion: 'prensa' }, destino: 'n_menu' }).definicion;
    d = aplicarOperacion(d, { tipo: 'quitar_intencion', intencion: 'prensa' }).definicion;
    expect((ubicar(d, 'n_interpretar')!.caja as { rutas: Record<string, unknown> }).rutas).toEqual({});
    d = aplicarOperacion(d, { tipo: 'editar_intencion', intencion: 'propuesta', cambios: { tema: 'agua' } }).definicion;
    d = aplicarOperacion(d, { tipo: 'quitar_tema', tema: 'agua' }).definicion;
    expect(d.intenciones.find((i) => i.id === 'propuesta')?.tema).toBeNull();
  });

  it('varias operaciones: si una falla, no se aplica ninguna', () => {
    const d = base();
    expect(() => aplicarOperaciones(d, [OPERACIONES[1], { tipo: 'quitar_caja', caja: 'n_bienvenida' }])).toThrow(ErrorOperacion);
    expect((ubicar(d, 'n_menu')!.caja as { modo: string }).modo).toBe('lista');
  });
});
