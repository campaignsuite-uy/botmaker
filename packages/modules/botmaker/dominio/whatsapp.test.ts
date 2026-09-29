import { describe, expect, it } from 'vitest';
import { reglaAntesDelMotor } from './reglas';
import {
  avisosPlantilla, aWhatsapp, completarPlantilla, consumoWhatsapp, estadoSiguiente, idOpcion, leerIdOpcion, leerMensaje, leerPlantilla,
  mensajePlantilla, partirTexto, plantillaAMeta, problemasPlantilla, variablesDe, ventanaAbierta, ventanaHasta, type NuevaPlantilla,
} from './whatsapp';

describe('WhatsApp: lo que sale', () => {
  it('un texto sin opciones es un mensaje de texto', () => {
    expect(aWhatsapp({ texto: 'Hola, soy el asistente.' }, 'tu')).toEqual([{ type: 'text', text: { body: 'Hola, soy el asistente.', preview_url: false } }]);
    expect(aWhatsapp({ texto: 'Mirá https://ejemplo.org' }, 'tu')[0]).toMatchObject({ text: { preview_url: true } });
  });

  it('hasta 3 opciones son botones con la caja y la letra en el id', () => {
    const [m] = aWhatsapp({ texto: '¿En qué te ayudo?', opcionesDe: 'n_menu1', opciones: [{ letra: 'A', texto: 'Propuestas' }, { letra: 'B', texto: 'Sumarme' }] }, 'tu');
    expect(m).toEqual({
      type: 'interactive',
      interactive: {
        type: 'button', body: { text: '¿En qué te ayudo?' },
        action: { buttons: [{ type: 'reply', reply: { id: 'n_menu1|A', title: 'Propuestas' } }, { type: 'reply', reply: { id: 'n_menu1|B', title: 'Sumarme' } }] },
      },
    });
  });

  it('más de 3 opciones o modo lista van como lista, con títulos y descripciones recortados', () => {
    const opciones = Array.from({ length: 12 }, (_, i) => ({ letra: String.fromCharCode(65 + i), texto: `Opción número ${i + 1} con un título largo`, descripcion: 'x'.repeat(100) }));
    const [m] = aWhatsapp({ texto: 'Elegí', opcionesDe: 'n_menu1', opciones, modo: 'lista' }, 'usted');
    if (m?.type !== 'interactive' || m.interactive.type !== 'list') throw new Error('esperaba una lista');
    const filas = m.interactive.action.sections[0]!.rows;
    expect(filas).toHaveLength(10);
    expect(filas.every((f) => f.title.length <= 24 && (f.description?.length ?? 0) <= 72)).toBe(true);
    expect(m.interactive.action.button).toBe('Ver opciones');
  });

  it('un texto largo con opciones sale en dos mensajes: el texto y después las opciones', () => {
    const ms = aWhatsapp({ texto: 'palabra '.repeat(200), opcionesDe: 'n_a1', opciones: [{ letra: 'A', texto: 'Sí' }] }, 'usted');
    expect(ms.map((x) => x.type)).toEqual(['text', 'interactive']);
    expect(ms[1]).toMatchObject({ interactive: { body: { text: 'Elija una opción:' } } });
  });

  it('parte los textos de más de 4.096 caracteres sin cortar palabras', () => {
    const t = Array.from({ length: 900 }, (_, i) => `palabra${i}`).join(' ');
    const partes = partirTexto(t);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.every((p) => p.length <= 4096)).toBe(true);
    expect(partes.join(' ')).toBe(t);
  });

  it('el id de una opción va y vuelve', () => {
    expect(leerIdOpcion(idOpcion('n_7f3a', 'G'))).toEqual({ cajaId: 'n_7f3a', letra: 'G' });
    expect(leerIdOpcion('cualquier cosa')).toBeNull();
  });
});

describe('WhatsApp: lo que llega', () => {
  const base = { from: '+507 6000-1234', id: 'wamid.ABC=', timestamp: '1790600000' };

  it('un texto', () => {
    expect(leerMensaje({ ...base, type: 'text', text: { body: '  Hola  ' } })).toEqual({
      id: 'wamid.ABC=', de: '50760001234', hora: new Date(1790600000 * 1000).toISOString(), entrada: { tipo: 'texto', texto: 'Hola' }, texto: 'Hola', tipo: 'texto',
    });
  });

  it('un botón o una fila de lista vuelven como opción de su caja', () => {
    expect(leerMensaje({ ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'n_menu1|B', title: 'Sumarme' } } })?.entrada)
      .toEqual({ tipo: 'opcion', cajaId: 'n_menu1', letra: 'B', titulo: 'Sumarme' });
    expect(leerMensaje({ ...base, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'otra-cosa', title: 'Salud' } } })?.entrada)
      .toEqual({ tipo: 'texto', texto: 'Salud' });
  });

  it('un audio o una imagen sin pie son un adjunto que las reglas reconocen sin motor', () => {
    const audio = leerMensaje({ ...base, type: 'audio' });
    expect(audio).toMatchObject({ tipo: 'adjunto', texto: '[audio]' });
    expect(reglaAntesDelMotor(audio!.texto)).toMatchObject({ intencion: 'no_entendible', regla: 'adjunto' });
    expect(leerMensaje({ ...base, type: 'image', image: { caption: '¿Esto es verdad?' } })).toMatchObject({ tipo: 'texto', texto: '¿Esto es verdad?' });
  });

  it('una reacción o un mensaje sin número no se contestan', () => {
    expect(leerMensaje({ ...base, type: 'reaction' })).toBeNull();
    expect(leerMensaje({ ...base, from: 'abc', type: 'text', text: { body: 'hola' } })).toBeNull();
  });
});

describe('WhatsApp: ventana, estados y consumo', () => {
  it('la ventana dura 24 horas desde el último mensaje de la persona', () => {
    const hasta = ventanaHasta('2026-10-01T10:00:00Z');
    expect(hasta).toBe('2026-10-02T10:00:00.000Z');
    expect(ventanaAbierta(hasta, new Date('2026-10-02T09:59:00Z'))).toBe(true);
    expect(ventanaAbierta(hasta, new Date('2026-10-02T10:00:01Z'))).toBe(false);
    expect(ventanaAbierta(null, new Date())).toBe(false);
  });

  it('un estado solo avanza y fallido gana', () => {
    expect(estadoSiguiente('leido', 'entregado')).toBe('leido');
    expect(estadoSiguiente('enviado', 'leido')).toBe('leido');
    expect(estadoSiguiente('leido', 'fallido')).toBe('fallido');
  });

  it('Meta cobra las respuestas pasadas las 1.000 del mes desde el 1/10/2026', () => {
    expect(consumoWhatsapp(1500, new Date('2026-09-30T12:00:00Z'))).toMatchObject({ vigente: false, cobradas: 0, usd: 0 });
    expect(consumoWhatsapp(1500, new Date('2026-10-15T12:00:00Z'))).toMatchObject({ vigente: true, cobradas: 500, usd: 5.65 });
  });
});

describe('WhatsApp: plantillas', () => {
  const nueva: NuevaPlantilla = { nombre: 'retomar_consulta', categoria: 'utility', idioma: 'es', texto: 'Hola {{1}}, te escribimos por tu consulta sobre {{2}}. ¿Seguimos?', ejemplos: { 1: 'Rosa', 2: 'transporte' } };

  it('lee los espacios numerados o con nombre', () => {
    expect(variablesDe('Hola {{2}} y {{1}}, {{1}}')).toEqual({ formato: 'posicional', variables: ['1', '2'] });
    expect(variablesDe('Hola {{nombre}}, sobre {{tema}}')).toEqual({ formato: 'nombre', variables: ['nombre', 'tema'] });
  });

  it('una plantilla bien armada no tiene problemas y sale en el formato de Meta con sus ejemplos', () => {
    expect(problemasPlantilla(nueva)).toEqual([]);
    expect(plantillaAMeta(nueva)).toEqual({
      name: 'retomar_consulta', language: 'es', category: 'UTILITY', parameter_format: 'positional',
      components: [{ type: 'BODY', text: nueva.texto, example: { body_text: [['Rosa', 'transporte']] } }],
    });
    const conNombre = { ...nueva, texto: 'Hola {{nombre}}, ¿seguimos con {{tema}}?', ejemplos: { nombre: 'Rosa', tema: 'salud' } };
    expect(plantillaAMeta(conNombre)).toMatchObject({ parameter_format: 'named', components: [{ example: { body_text_named_params: [{ param_name: 'nombre', example: 'Rosa' }, { param_name: 'tema', example: 'salud' }] } }] });
  });

  it('marca lo que hay que corregir y avisa lo que Meta suele rechazar', () => {
    expect(problemasPlantilla({ ...nueva, nombre: 'Retomar Consulta', texto: 'Hola {{1}} y {{3}}', ejemplos: { 1: 'x' } })).toEqual([
      'El nombre va en minúsculas, sin espacios ni tildes (letras, números y _), hasta 60 caracteres.',
      'Los espacios numerados van en orden y sin saltos: {{1}}, {{2}}…',
      'Falta un ejemplo para {{3}}.',
    ]);
    expect(avisosPlantilla({ texto: 'Te escribimos, {{1}}', categoria: 'utility' })).toHaveLength(1);
  });

  it('lee las plantillas de 360dialog y dice cuáles se pueden usar', () => {
    const ok = leerPlantilla({ id: '1', name: 'retomar', language: 'es', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hola {{1}}' }] });
    expect(ok).toMatchObject({ estado: 'aprobada', usable: true, variables: ['1'], formato: 'posicional' });
    const revision = leerPlantilla({ name: 'nueva', language: 'es', status: 'PENDING', components: [{ type: 'BODY', text: 'Hola' }] });
    expect(revision).toMatchObject({ estado: 'en_revision', usable: false });
    const rechazada = leerPlantilla({ name: 'mala', language: 'es', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT', components: [{ type: 'BODY', text: 'x' }] });
    expect(rechazada).toMatchObject({ estado: 'rechazada', motivo: 'INVALID_FORMAT' });
    const imagen = leerPlantilla({ name: 'foto', language: 'es', status: 'APPROVED', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hola' }] });
    expect(imagen).toMatchObject({ usable: false });
  });

  it('completa y arma el mensaje con los valores', () => {
    expect(completarPlantilla(nueva.texto, { 1: 'Rosa', 2: 'transporte' })).toBe('Hola Rosa, te escribimos por tu consulta sobre transporte. ¿Seguimos?');
    expect(mensajePlantilla({ nombre: 'retomar_consulta', idioma: 'es', formato: 'posicional', variables: ['1', '2'] }, { 1: 'Rosa', 2: 'transporte' })).toEqual({
      type: 'template', template: { name: 'retomar_consulta', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Rosa' }, { type: 'text', text: 'transporte' }] }] },
    });
    expect(mensajePlantilla({ nombre: 'x', idioma: 'es', formato: 'nombre', variables: ['nombre'] }, { nombre: 'Rosa' })).toMatchObject({
      template: { components: [{ parameters: [{ type: 'text', parameter_name: 'nombre', text: 'Rosa' }] }] },
    });
  });
});
