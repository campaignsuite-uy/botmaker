import { describe, expect, it } from 'vitest';
import set from '../pruebas/set-de-prueba.json';
import { normalizar, reglaAntesDelMotor } from './reglas';

/** En la plantilla nueva, saludo y despedida son una sola intención: cortesía. */
const plantilla = (id: string) => (id === 'saludo' || id === 'despedida' ? 'cortesia' : id);

describe('reglas antes del motor', () => {
  it('normaliza sin perder la ñ', () => {
    expect(normalizar('¡Buenas TARDES, señora!')).toBe('buenas tardes señora');
    expect(normalizar('Bórrenme')).toBe('borrenme');
  });

  it('con los 218 mensajes de la prueba: nunca contradice la respuesta esperada', () => {
    const errores = set.mensajes.flatMap((m) => {
      const r = reglaAntesDelMotor(m.mensaje);
      if (!r) return [];
      const validas = [m.intencion, ...m.intencionAlt].map(plantilla);
      return validas.includes(r.intencion) ? [] : [`${m.id} «${m.mensaje}»: ${r.intencion}, esperaba ${validas.join(' o ')}`];
    });
    expect(errores).toEqual([]);
  });

  it('resuelve sin motor todos los saludos y despedidas de la prueba', () => {
    const cortesia = set.mensajes.filter((m) => plantilla(m.intencion) === 'cortesia');
    expect(cortesia.length).toBe(10);
    for (const m of cortesia) expect(reglaAntesDelMotor(m.mensaje), `${m.id} «${m.mensaje}»`).toMatchObject({ intencion: 'cortesia' });
  });

  it('los pedidos de baja nunca se pierden, aunque vengan con cortesía', () => {
    for (const t of ['ya no me escriban mas xfa', 'No quiero recibir más mensajes, bórrenme.', 'gracias, no me manden más', 'Sáquenme de la lista', 'BAJA', 'quiero darme de baja', 'stop']) {
      expect(reglaAntesDelMotor(t), t).toMatchObject({ intencion: 'datos_personales', regla: 'baja' });
    }
    // Una queja o una pregunta sobre los datos van al motor.
    for (const t of ['¿Por qué no me escriben?', '¿Quién les dio mi número?', '¿Qué hacen con mis datos?']) expect(reglaAntesDelMotor(t), t).toBeNull();
  });

  it('cortesía: distingue saludo de cierre, y lo que pide algo va al motor', () => {
    expect(reglaAntesDelMotor('Hola, buenos días')).toMatchObject({ momento: 'inicio' });
    expect(reglaAntesDelMotor('Ok, gracias')).toMatchObject({ momento: 'cierre' });
    expect(reglaAntesDelMotor('👍🏽')).toMatchObject({ intencion: 'cortesia' });
    for (const t of ['Hola, quiero sumarme', 'gracias, ¿y dónde voto?', 'y la información?', '😡', 'no gracias']) expect(reglaAntesDelMotor(t), t).toBeNull();
  });

  it('adjuntos sin texto y risas: no se entiende, sin llamar al motor', () => {
    expect(reglaAntesDelMotor('[audio]')).toMatchObject({ intencion: 'no_entendible', regla: 'adjunto' });
    expect(reglaAntesDelMotor('jajajaja')).toMatchObject({ intencion: 'no_entendible', regla: 'risa' });
    expect(reglaAntesDelMotor('jaja qué propone para la Caja')).toBeNull();
  });
});
