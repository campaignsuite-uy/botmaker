import { describe, expect, it } from 'vitest';
import {
  celdaCsv, claveConsulta, consultasDeEventos, csvBaseContactos, etiquetaConsulta, leerClaveConsulta, numeroInternacional, type EventoDeContacto,
} from './contactos';
import { plantillaPolitica } from './plantilla-politica';
import { validarDefinicion, type Definicion } from './definicion';

const ev = (nombre: string, fecha: string, datos: Record<string, unknown> = {}, cajaId: string | null = null): EventoDeContacto => ({ nombre, cajaId, datos, fecha });

describe('Base de contactos: lo que consultó', () => {
  it('suma temas, consultas y opciones; deja afuera cortesía, lo que no se entiende y "ninguno"', () => {
    const c = consultasDeEventos([
      ev('sesion_iniciada', '2026-09-01T10:00:00Z'),
      ev('interpretado', '2026-09-01T10:01:00Z', { intencion: 'propuesta', tema: 'transporte' }, 'n_interpretar'),
      ev('interpretado', '2026-09-02T10:01:00Z', { intencion: 'propuesta', tema: 'agua' }, 'n_interpretar'),
      ev('interpretado', '2026-09-02T10:05:00Z', { intencion: 'cortesia', tema: 'ninguno' }, 'n_interpretar'),
      ev('interpretado', '2026-09-03T10:05:00Z', { intencion: 'no_entendible', tema: null }, 'n_interpretar'),
      ev('opcion_elegida', '2026-09-03T11:00:00Z', { letra: 'C' }, 'n_menu'),
      ev('opcion_elegida', '2026-09-03T11:00:00Z', { letra: 'C' }),
      ev('respondido_con_base', '2026-09-03T11:01:00Z', { secciones: ['S02'] }, 'n_consulta'),
    ]);
    expect(c).toEqual([
      { tipo: 'intencion', clave: 'propuesta', veces: 2, ultima: '2026-09-02T10:01:00Z' },
      { tipo: 'opcion', clave: 'n_menu|C', veces: 1, ultima: '2026-09-03T11:00:00Z' },
      { tipo: 'tema', clave: 'agua', veces: 1, ultima: '2026-09-02T10:01:00Z' },
      { tipo: 'tema', clave: 'transporte', veces: 1, ultima: '2026-09-01T10:01:00Z' },
    ]);
  });

  it('la clave de filtro va y vuelve, y rechaza lo que no tiene forma', () => {
    expect(leerClaveConsulta(claveConsulta({ tipo: 'opcion', clave: 'n_menu|C' }))).toEqual({ tipo: 'opcion', clave: 'n_menu|C' });
    expect(leerClaveConsulta('tema:agua')).toEqual({ tipo: 'tema', clave: 'agua' });
    for (const x of ['tema:', 'tema:Agua', 'otra:agua', 'opcion:n_menu', "tema:agua' or 1=1", null]) expect(leerClaveConsulta(x)).toBeNull();
  });

  it('pone los nombres de la definición del bot', () => {
    const def = validarDefinicion(plantillaPolitica({ candidato: 'Ana', partido: null, aliasPartido: [], trato: 'usted', mercado: 'PA', consultas: null, aportes: null }));
    if (!def.ok) throw new Error('plantilla inválida');
    const d: Definicion = def.definicion;
    expect(etiquetaConsulta(d, { tipo: 'intencion', clave: 'voluntariado' })).toBe('Voluntariado');
    expect(etiquetaConsulta(d, { tipo: 'tema', clave: 'css_pensiones' })).toBe('Caja de Seguro Social');
    expect(etiquetaConsulta(d, { tipo: 'opcion', clave: 'n_menu|A' })).toMatch(/^Menú principal › /);
    expect(etiquetaConsulta(d, { tipo: 'tema', clave: 'no_existe' })).toBe('no_existe');
    expect(etiquetaConsulta(null, { tipo: 'opcion', clave: 'n_viejo1|B' })).toBe('Opción B (n_viejo1)');
  });
});

describe('Base de contactos: exportación', () => {
  it('una celda que parece fórmula va como texto; comillas, comas y saltos, entre comillas', () => {
    expect(celdaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celdaCsv('+5076-1')).toBe("'+5076-1");
    expect(celdaCsv('+50761234567')).toBe('+50761234567');
    expect(celdaCsv('@hola')).toBe("'@hola");
    expect(celdaCsv('Belisario Porras, San Miguelito')).toBe('"Belisario Porras, San Miguelito"');
    expect(celdaCsv('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(celdaCsv(null)).toBe('');
  });

  it('el número va con + y el CSV lleva cada dato en su columna, con BOM y horas en UTC', () => {
    expect(numeroInternacional('50761234567')).toBe('+50761234567');
    expect(numeroInternacional(null)).toBe('');
    const base = { bot: 'Asistente', canal: 'WhatsApp', nombrePerfil: '', numero: '', primera: '2026-09-01T10:00:00Z', ultima: '2026-09-02T11:30:00.000Z', conversaciones: 2, temas: ['Agua'], consultas: ['Propuesta'], opciones: [], condiciones: 1, condicionesAceptadas: '2026-09-01T10:00:00Z' };
    const csv = csvBaseContactos([
      { ...base, id: 'c1', nombre: 'Rosa', datos: { zona: 'Arraiján' } },
      { ...base, id: 'c2', nombre: 'Marcos', datos: { correo: 'm@ejemplo.org' }, numero: '+50761234567' },
    ]);
    expect(csv.startsWith('﻿Bot,Canal,Nombre,Nombre de perfil de WhatsApp,Número,Dato: correo,Dato: zona,Primera conversación (UTC)')).toBe(true);
    const lineas = csv.slice(1).trimEnd().split('\r\n');
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toBe('Asistente,WhatsApp,Rosa,,,,Arraiján,2026-09-01 10:00,2026-09-02 11:30,2,Agua,Propuesta,,1,2026-09-01 10:00,c1');
    expect(lineas[2]).toContain(',+50761234567,m@ejemplo.org,,');
  });
});
