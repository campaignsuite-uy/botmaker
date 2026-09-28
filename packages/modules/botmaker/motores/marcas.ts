/**
 * Datos personales antes del motor: teléfonos, correos y números de documento se cambian por marcas ([TELÉFONO],
 * [CORREO], [DOCUMENTO]) antes de mandar un texto a cualquier motor. El original queda solo en la conversación.
 * Es deliberadamente amplio: ante la duda, se marca (un número largo cualquiera cuenta como teléfono).
 */

export interface TextoMarcado {
  texto: string;
  marcas: { correo: number; telefono: number; documento: number };
}

const CORREO = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
// Cédula de Panamá (8-123-4567, PE-12-345, E-8-12345, 1AV-12-345) y de Uruguay (1.234.567-8, 1234567-8).
const DOCUMENTO = /\b(?:(?:[1-9]|1[0-3]|PE|E|N|[1-9]AV|[1-9]PI)-\d{1,4}-\d{1,6}|\d\.\d{3}\.\d{3}-?\d|\d{7}-\d)\b/giu;
// Siete dígitos o más, con espacios, guiones, puntos o paréntesis en el medio y un + opcional adelante.
const TELEFONO = /(?<![\p{L}\p{N}])\+?\d(?:[\s().-]?\d){6,14}(?![\p{L}\p{N}])/gu;

export function marcarDatosPersonales(texto: string): TextoMarcado {
  const marcas = { correo: 0, telefono: 0, documento: 0 };
  let t = texto.replace(CORREO, () => { marcas.correo++; return '[CORREO]'; });
  t = t.replace(DOCUMENTO, () => { marcas.documento++; return '[DOCUMENTO]'; });
  t = t.replace(TELEFONO, () => { marcas.telefono++; return '[TELÉFONO]'; });
  return { texto: t, marcas };
}

export function hayMarcas(t: TextoMarcado): boolean {
  return t.marcas.correo + t.marcas.telefono + t.marcas.documento > 0;
}
