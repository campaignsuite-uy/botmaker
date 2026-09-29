import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dividirMaterial } from './material';
import { validarDatos } from './validar-datos';

const MATERIAL = dividirMaterial(readFileSync(new URL('../pruebas/material-prueba.md', import.meta.url), 'utf8')).secciones;
const sec = (...codigos: string[]) => MATERIAL.filter((s) => codigos.includes(s.codigo!)).map((s) => `${s.texto}\n${s.fuente}`);
const cortes = (respuesta: string, citadas: string[], otros: string[] = []) => validarDatos(respuesta, { citadas, otros }).map((c) => `${c.tipo}:${c.valor}`);

describe('validador de datos', () => {
  it('respuestas fieles al material pasan', () => {
    expect(cortes('Nació el 26 de noviembre de 1973 en la Ciudad de Panamá (26/11/1973).', sec('S01'))).toEqual([]);
    expect(cortes('En 2019 obtuvo 368.962 votos (18,78 %) y en 2024 unos 559.000 votos (24,6 %).', sec('S02'))).toEqual([]);
    expect(cortes('Entre 2004 y 2007 fue ministro consejero en Washington (2004-2007).', sec('S01'))).toEqual([]);
    expect(cortes('Se consulta en VerificaTE (verificate.te.gob.pa), con la cédula.', sec('S11'))).toEqual([]);
    expect(cortes('El duplicado cuesta US$35, o US$17,50 para jubilados.', sec('S11'))).toEqual([]);
    expect(cortes('Tiene dos hijos y le gusta el béisbol. Fue su 1.ª elección en 2 partidos.', sec('S01'))).toEqual([]);
  });

  it('corta los datos armados: números, enlaces, correos y teléfonos que no están en lo citado', () => {
    const casos: [string, string[]][] = [
      ['En 2019 obtuvo 412.000 votos.', sec('S02')],
      ['Obtuvo el 31 % de los votos en 2024.', sec('S02')],
      ['Propone subir la pensión mínima a 600 dólares.', sec('S12')],
      ['La elección es el 5 de mayo de 2030.', sec('S10')],
      ['Más información en www.lombana2029.com.', sec('S01')],
      ['Escribale a info@otrocamino.org para sumarse.', sec('S07')],
      ['Llame al 6123-4567 para donar.', sec('S08')],
      ['Puede llamar al +507 6000-0000.', sec('S09')],
      ['Renovar la cédula cuesta US$20.', sec('S11')],
      ['Nació en 1975.', sec('S01')],
    ];
    for (const [respuesta, citadas] of casos) expect(cortes(respuesta, citadas), respuesta).not.toEqual([]);
  });

  it('solo vale lo citado: el mismo dato de otra sección no citada se corta', () => {
    expect(cortes('Obtuvo 368.962 votos.', sec('S01'))).toEqual(['numero:368.962']);
  });

  it('lo que dijo la persona y los datos del bot también valen', () => {
    expect(cortes('No tengo el dato sobre los 600 dólares que menciona.', [], ['¿Va a subir la pensión a 600 dólares?'])).toEqual([]);
    expect(cortes('Puede escribir a consultas@ejemplo.org o al +507 6000-0000.', [], ['consultas@ejemplo.org', '+507 6000-0000'])).toEqual([]);
  });
});
