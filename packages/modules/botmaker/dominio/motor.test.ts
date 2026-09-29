import { describe, expect, it } from 'vitest';
import type { Interpretacion, RespuestaConBase } from '../motores/contratos';
import { ubicar, type Definicion } from './definicion';
import { aplicarOperacion } from './operaciones';
import { plantillaPolitica } from './plantilla-politica';
import { CAJA_ACLARACION, sesionNueva, turno, validarDato, type Entrada, type ResultadoTurno, type Servicios, type Sesion } from './motor';

const DEF = plantillaPolitica({ candidato: 'Ricardo Lombana', partido: 'Movimiento Otro Camino', trato: 'usted', mercado: 'PA', consultas: { canal: 'correo', valor: 'consultas@ejemplo.org' } });

interface Lectura { intencion: string; otra?: string; nada?: boolean }
/** Motores falsos: qué intención sale para cada texto, y qué responde con base. */
function servicios(o: { lecturas?: Record<string, Lectura>; respuesta?: RespuestaConBase | null; horario?: boolean } = {}): Servicios & { interpretados: string[]; preguntas: string[] } {
  const interpretados: string[] = [];
  const preguntas: string[] = [];
  return {
    interpretados,
    preguntas,
    async interpretar(e) {
      interpretados.push(e.mensaje);
      const l = o.lecturas?.[e.mensaje] ?? { intencion: 'fuera_de_tema' };
      if (l.nada) return { salida: null, lectura: { principal: null, respaldo: null, resultado: 'ninguna' }, motorId: null, costoUsd: 0.002 };
      const salida: Interpretacion = { intencion: l.intencion, tema: 'ninguno', confianza: 0.95, alternativas: l.otra ? [{ intencion: l.otra, tema: 'ninguno', confianza: 0.95 }] : [] };
      return { salida, lectura: { principal: l.intencion, respaldo: l.otra ?? l.intencion, resultado: l.otra ? 'distintas' : 'coinciden' }, motorId: 'gemini-3.1-flash-lite', costoUsd: 0.001 };
    },
    async responder(e) {
      preguntas.push(e.pregunta);
      const salida = o.respuesta === undefined ? { respuesta: 'Propone reformar la Caja de Seguro Social.', secciones: ['S01'], tiene_respuesta: 'si' as const } : o.respuesta;
      return { salida, motorId: 'gemini-3.1-flash-lite', costoUsd: 0.002 };
    },
    material: () => [],
    dentroDeHorario: () => o.horario ?? true,
  };
}

/** Corre un guion de entradas y devuelve cada resultado. */
async function guion(entradas: Entrada[], sv: Servicios = servicios(), def: Definicion = DEF, inicial: Sesion = sesionNueva()): Promise<ResultadoTurno[]> {
  let s = inicial;
  const out: ResultadoTurno[] = [];
  for (const e of entradas) {
    const r = await turno(def, s, e, sv);
    out.push(r);
    s = r.sesion;
  }
  return out;
}
const textos = (r: ResultadoTurno) => r.mensajes.map((m) => m.texto);
const boton = (cajaId: string, letra: string, titulo = letra): Entrada => ({ tipo: 'opcion', cajaId, letra, titulo });
const texto = (t: string): Entrada => ({ tipo: 'texto', texto: t });

describe('motor de conversación', () => {
  it('al empezar: bienvenida con las variables del bot y el menú; espera una opción', async () => {
    const [r] = await guion([{ tipo: 'inicio' }]);
    expect(textos(r!)[0]).toBe('Hola, soy el asistente virtual de Ricardo Lombana. Puedo contarle sus propuestas, cómo sumarse y resolver sus dudas.');
    expect(r!.mensajes[1]).toMatchObject({ cajaId: 'n_menu', modo: 'lista', opcionesDe: 'n_menu' });
    expect(r!.mensajes[1]!.opciones!.map((o) => o.letra)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r!.sesion.espera).toEqual({ tipo: 'opciones', cajaId: 'n_menu' });
    expect(r!.decision.recorrido).toEqual(['n_bienvenida', 'n_menu']);
  });

  it('sumarse: pide nombre y zona, los guarda y deriva al equipo; derivada, el bot no contesta', async () => {
    const [, a, b, c, d] = await guion([{ tipo: 'inicio' }, boton('n_menu', 'C', 'Sumarme'), texto('Ana'), texto('San Miguelito'), texto('¿hola?')]);
    expect(textos(a!)).toEqual(['¡Qué bueno! ¿Cómo se llama?']);
    expect(textos(b!)).toEqual(['¿En qué zona o corregimiento vive?']);
    expect(textos(c!)).toEqual(['Gracias, Ana. Alguien del equipo le va a escribir para coordinar.']);
    expect(c!.sesion).toMatchObject({ estado: 'derivada', variables: { 'contacto.nombre': 'Ana', 'contacto.zona': 'San Miguelito' } });
    expect(c!.eventos.find((e) => e.nombre === 'derivada')?.datos).toEqual({ motivo: 'Quiere sumarse como voluntario' });
    expect(d!.mensajes).toEqual([]);
    expect(d!.eventos.map((e) => e.nombre)).toEqual(['mensaje_en_derivada']);
  });

  it('un texto en el menú va a interpretar; una propuesta se contesta con base con ese mismo texto', async () => {
    const sv = servicios({ lecturas: { '¿Qué propone para la Caja?': { intencion: 'propuesta' } } });
    const [, r] = await guion([{ tipo: 'inicio' }, texto('¿Qué propone para la Caja?')], sv);
    expect(sv.preguntas).toEqual(['¿Qué propone para la Caja?']);
    expect(textos(r!)).toEqual(['Propone reformar la Caja de Seguro Social.', '¿Le ayudo con algo más?']);
    expect(r!.decision).toMatchObject({ intencion: 'propuesta', secciones: ['S01'], recorrido: ['n_interpretar', 'n_consulta', 'n_masayuda'] });
    expect(r!.decision.costoUsd).toBeCloseTo(0.003);
    expect(r!.sesion.espera).toEqual({ tipo: 'opciones', cajaId: 'n_masayuda' });
  });

  it('desde el menú: "Propuestas" pide la pregunta; "Quién es" contesta una pregunta fija', async () => {
    const sv = servicios({ lecturas: { '¿Y para la salud?': { intencion: 'propuesta' } } });
    const [, a, b] = await guion([{ tipo: 'inicio' }, boton('n_menu', 'A', 'Propuestas'), texto('¿Y para la salud?')], sv);
    expect(textos(a!)).toEqual(['Escríbame su pregunta sobre las propuestas de Ricardo Lombana y le respondo.']);
    expect(b!.decision.intencion).toBe('propuesta');
    const sv2 = servicios();
    await guion([{ tipo: 'inicio' }, boton('n_menu', 'B', 'Quién es')], sv2);
    expect(sv2.preguntas).toEqual(['¿Quién es Ricardo Lombana y cuál es su trayectoria?']);
  });

  it('doble lectura sin acuerdo que lleva a lugares distintos: pregunta con dos botones y sigue con lo que elige', async () => {
    const sv = servicios({ lecturas: { 'quiero saber lo de la caja y ayudar': { intencion: 'propuesta', otra: 'voluntariado' } } });
    const [, r, a] = await guion([{ tipo: 'inicio' }, texto('quiero saber lo de la caja y ayudar'), boton(CAJA_ACLARACION, 'A')], sv);
    expect(textos(r!)).toEqual(['Para ayudarle mejor, ¿qué quiere saber?']);
    expect(r!.mensajes[0]!.opciones).toEqual([{ letra: 'A', texto: 'Propuesta' }, { letra: 'B', texto: 'Voluntariado' }]);
    expect(r!.sesion.espera).toMatchObject({ tipo: 'aclaracion', texto: 'quiero saber lo de la caja y ayudar' });
    // Eligió propuesta: se contesta con base la pregunta original.
    expect(sv.preguntas).toEqual(['quiero saber lo de la caja y ayudar']);
    expect(a!.decision.intencion).toBe('propuesta');
    const [, , b] = await guion([{ tipo: 'inicio' }, texto('quiero saber lo de la caja y ayudar'), boton(CAJA_ACLARACION, 'B')], sv);
    expect(textos(b!)).toEqual(['¡Qué bueno! ¿Cómo se llama?']);
  });

  it('sin acuerdo pero al mismo lugar (propuesta o rumor): no pregunta', async () => {
    const sv = servicios({ lecturas: { 'moca voto a favor de la 462 si o no': { intencion: 'propuesta', otra: 'verificar_rumor' } } });
    const [, r] = await guion([{ tipo: 'inicio' }, texto('moca voto a favor de la 462 si o no')], sv);
    expect(r!.eventos.some((e) => e.nombre === 'aclaracion')).toBe(false);
    expect(textos(r!)[0]).toBe('Propone reformar la Caja de Seguro Social.');
  });

  it('sin motor disponible: lo dice y vuelve al menú', async () => {
    const sv = servicios({ lecturas: { 'algo': { intencion: '', nada: true } } });
    const [, r] = await guion([{ tipo: 'inicio' }, texto('algo')], sv);
    expect(textos(r!)[0]).toBe('Ahora puedo ayudarle mejor con las opciones del menú.');
    expect(r!.sesion.espera).toEqual({ tipo: 'opciones', cajaId: 'n_menu' });
  });

  it('sin el dato en el material: el mensaje de sin dato con el canal de consultas', async () => {
    const sv = servicios({ lecturas: { '¿Qué opina de Marco Rubio?': { intencion: 'otros_actores' } }, respuesta: { respuesta: 'No tengo ese dato.', secciones: [], tiene_respuesta: 'no' } });
    const [, r] = await guion([{ tipo: 'inicio' }, texto('¿Qué opina de Marco Rubio?')], sv);
    expect(textos(r!)).toEqual(['No tengo ese dato. Puede consultarlo con el equipo en consultas@ejemplo.org.', '¿Le ayudo con algo más?']);
  });

  it('reglas sin IA: saludo, cierre y baja con confirmación', async () => {
    const sv = servicios();
    const [hola, ok] = await guion([texto('Hola, buenos días'), texto('Ok, gracias')], sv);
    expect(hola!.decision.regla).toBe('cortesia');
    expect(hola!.sesion.espera).toEqual({ tipo: 'opciones', cajaId: 'n_menu' });
    expect(textos(ok!)).toEqual(['Gracias a usted. Cuando quiera, me escribe.']);
    const [, baja, si] = await guion([{ tipo: 'inicio' }, texto('ya no me escriban mas xfa'), boton('n_datos', 'A', 'Sí, no me escriban')], sv);
    expect(textos(baja!)[0]).toMatch(/¿Quiere que no le escribamos más\?/);
    expect(si!.eventos.some((e) => e.nombre === 'baja')).toBe(true);
    expect(sv.interpretados).toEqual([]);
  });

  it('un botón viejo se trata como texto libre', async () => {
    const sv = servicios({ lecturas: { 'Sumarme': { intencion: 'voluntariado' } } });
    const [, , r] = await guion([{ tipo: 'inicio' }, boton('n_menu', 'A', 'Propuestas'), boton('n_menu', 'C', 'Sumarme')], sv);
    expect(r!.eventos[0]).toMatchObject({ nombre: 'boton_viejo', cajaId: 'n_menu' });
    expect(sv.interpretados).toEqual(['Sumarme']);
    expect(textos(r!)).toEqual(['¡Qué bueno! ¿Cómo se llama?']);
  });

  it('si la caja donde esperaba ya no existe (otra versión), el texto va a interpretar', async () => {
    const sv = servicios({ lecturas: { 'Ana': { intencion: 'fuera_de_tema' } } });
    const s: Sesion = { ...sesionNueva(), iniciada: true, espera: { tipo: 'dato', cajaId: 'n_borrada', intentos: 0 } };
    const [r] = await guion([texto('Ana')], sv, DEF, s);
    expect(sv.interpretados).toEqual(['Ana']);
    expect(textos(r!)[0]).toBe('Solo puedo ayudarle con información de la campaña de Ricardo Lombana.');
  });

  it('un dato inválido se vuelve a pedir y, si sigue mal, se sigue por siFalla', async () => {
    let def = aplicarOperacion(DEF, { tipo: 'agregar_variable', variable: { nombre: 'contacto.correo' } }).definicion;
    def = aplicarOperacion(def, { tipo: 'editar_caja', caja: 'n_zona', cambios: { dato: 'correo', variable: 'contacto.correo' } }).definicion;
    const [, , , mal1, mal2] = await guion([{ tipo: 'inicio' }, boton('n_menu', 'C'), texto('Ana'), texto('no tengo'), texto('tampoco')], servicios(), def);
    expect(textos(mal1!)).toEqual(['Disculpe, no le entendí. ¿Me lo escribe de otra forma?', '¿En qué zona o corregimiento vive?']);
    expect(mal2!.eventos.map((e) => e.nombre)).toContain('derivada');
    expect(validarDato('correo', 'Ana@Correo.com')).toBe('ana@correo.com');
    expect(validarDato('telefono', '+507 6123-4567')).toBe('+50761234567');
    expect(validarDato('nombre', '123')).toBeNull();
  });

  it('fuera de horario, "hablar con alguien" deja el mensaje en vez de derivar en vivo', async () => {
    const [, r] = await guion([{ tipo: 'inicio' }, boton('n_menu', 'E')], servicios({ horario: false }));
    expect(textos(r!)[0]).toBe('Ahora el equipo no está atendiendo (de lunes a viernes, de 9 a 18). Deje su mensaje y le responden apenas puedan.');
  });

  it('un ciclo entre cajas se corta con el tope de pasos', async () => {
    const def = structuredClone(DEF);
    (ubicar(def, 'n_noentendi')!.caja as { siguiente: string }).siguiente = 'n_limite';
    (ubicar(def, 'n_limite')!.caja as { siguiente: string }).siguiente = 'n_noentendi';
    const [, r] = await guion([{ tipo: 'inicio' }, texto('asdfgh')], servicios({ lecturas: { asdfgh: { intencion: 'no_entendible' } } }), def);
    expect(r!.eventos.some((e) => e.nombre === 'tope_pasos')).toBe(true);
    expect(r!.mensajes.length).toBeLessThanOrEqual(25);
  });
});
