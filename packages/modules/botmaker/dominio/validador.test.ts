import { describe, expect, it } from 'vitest';
import { ubicar, type CajaDe, type Definicion, type TipoCaja } from './definicion';
import { MOTORES_POR_DEFECTO } from './motores';
import { plantillaPolitica } from './plantilla-politica';
import { revisarBot } from './validador';

const base = () => structuredClone(plantillaPolitica({ candidato: 'Candidata', trato: 'usted', mercado: 'PA' }));
const caja = <T extends TipoCaja>(d: Definicion, id: string) => ubicar(d, id)!.caja as CajaDe<T>;
const codigos = (d: Definicion, nivel: 'errores' | 'avisos' = 'errores') => revisarBot(d)[nivel].map((h) => `${h.codigo}@${h.donde}`);

describe('validador del flujo', () => {
  it('la plantilla no tiene errores ni avisos', () => {
    const r = revisarBot(base());
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it('límites de canal: 4 botones, un botón de más de 20 y una opción de lista de más de 24', () => {
    const d = base();
    const menu = caja<'menu'>(d, 'n_menu');
    menu.modo = 'botones';
    menu.opciones[0]!.texto = 'Propuestas del candidato';
    const r = revisarBot(d);
    expect(r.errores.map((h) => h.codigo)).toEqual(expect.arrayContaining(['botones_de_mas', 'texto_opcion_largo']));
    expect(r.porCaja.get('n_menu')?.length).toBe(2);
    expect(r.errores.find((h) => h.codigo === 'texto_opcion_largo')).toMatchObject({ donde: '1.2 › A', cajaId: 'n_menu', letra: 'A' });
    menu.modo = 'lista';
    menu.opciones[0]!.texto = 'Propuestas del candidato y más';
    expect(codigos(d)).toEqual(['texto_opcion_largo@1.2 › A']);
  });

  it('una intención sin destino es un error; sin frases, un aviso', () => {
    const d = base();
    d.intenciones[0]!.destino = null;
    d.intenciones[1]!.frases = [];
    expect(codigos(d)).toEqual(['intencion_sin_destino@intención cortesia']);
    expect(codigos(d, 'avisos')).toContain('intencion_sin_frases@intención propuesta');
  });

  it('una respuesta con base sin salida para cuando no tiene el dato', () => {
    const d = base();
    caja<'respuesta_base'>(d, 'n_consulta').sinDato = null;
    expect(codigos(d)).toEqual(['sin_dato_mudo@2.1']);
  });

  it('un inicio que espera sin decir nada, y textos libres que van a un mensaje', () => {
    const d = base();
    d.inicio = 'n_interpretar';
    d.textoLibre = 'n_soybot';
    expect(codigos(d)).toEqual(['inicio_mudo@1.3']);
    expect(codigos(d, 'avisos')).toContain('texto_libre@1.5');
  });

  it('un ciclo sin espera y una condición sin salidas', () => {
    const d = base();
    caja<'mensaje'>(d, 'n_noentendi').siguiente = 'n_limite';
    caja<'mensaje'>(d, 'n_limite').siguiente = 'n_noentendi';
    const cond = caja<'condicion'>(d, 'n_atencion');
    cond.casos[0]!.destino = null;
    cond.sino = null;
    expect(codigos(d).sort()).toEqual(['ciclo@1.4', 'ciclo@1.6', 'condicion_sin_salida@4.1']);
  });

  it('avisos: caja a la que no se llega, opción que termina muda, dato sin salida, contenido sin uso, variable vacía', () => {
    const d = base();
    caja<'menu'>(d, 'n_menu').opciones = caja<'menu'>(d, 'n_menu').opciones.filter((o) => o.letra !== 'D');
    caja<'mensaje'>(d, 'n_masayuda').opciones[1]!.destino = null;
    caja<'pedir_dato'>(d, 'n_zona').siFalla = null;
    d.contenidos.push({ id: 'c_suelto', nombre: 'Suelto', tipo: 'texto', texto: 'Hola' });
    d.variables.find((v) => v.nombre === 'bot.horario')!.valor = '';
    const avisos = codigos(d, 'avisos');
    expect(avisos).toEqual(expect.arrayContaining([
      'inalcanzable@1.9', 'opcion_sin_destino@2.2 › B', 'dato_sin_salida@3.3', 'contenido_sin_uso@contenido Suelto', 'variable_sin_valor@bot.horario',
    ]));
    expect(codigos(d)).toEqual([]);
  });

  it('sin probar: solo si se pasan las cajas que pasaron por el simulador', () => {
    const d = base();
    expect(revisarBot(d).avisos.some((h) => h.codigo === 'sin_probar')).toBe(false);
    const r = revisarBot(d, { probadas: new Set(['n_bienvenida', 'n_menu']) });
    const sin = r.avisos.filter((h) => h.codigo === 'sin_probar').map((h) => h.cajaId);
    expect(sin).not.toContain('n_menu');
    expect(sin).toContain('n_interpretar');
  });

  it('referencias rotas (de un YAML o una versión vieja) se marcan en su caja', () => {
    const d = base();
    caja<'menu'>(d, 'n_menu').opciones[1]!.destino = 'n_noexiste';
    expect(revisarBot(d).errores).toEqual([expect.objectContaining({ codigo: 'destino_inexistente', cajaId: 'n_menu', letra: 'B' })]);
  });

  it('las condiciones de los motores para el caso son avisos, nunca errores', () => {
    const motores = MOTORES_POR_DEFECTO.map((m) => (m.funcion === 'responder' ? { ...m, principal: 'claude-haiku-4.5', respaldo: null } : m));
    const r = revisarBot(base(), { bot: { caso: 'electoral', personalizacion: true }, motores });
    expect(r.errores).toEqual([]);
    const motor = r.avisos.filter((h) => h.codigo === 'motor').map((h) => h.mensaje).join('\n');
    expect(motor).toMatch(/menores de 18/);
    expect(motor).toMatch(/no tiene motor de respaldo/);
    expect(motor).toMatch(/personalizar/);
  });
});
