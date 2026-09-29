/**
 * Validador de datos (etapa 3, tarea 3.03): la última defensa contra datos inventados. Una respuesta con base que
 * trae un número, un enlace, un correo o un teléfono que no está en las secciones que cita (ni en la pregunta, ni en
 * los datos del bot) se corta: el bot manda la respuesta de sin dato y el corte queda en la decisión del mensaje.
 *
 * Los números de un solo dígito pasan (los ordinales, "dos debates"); los demás se comparan por sus dígitos
 * ("368.962", "368,962" y "368962" son lo mismo). Un enlace pasa si su dominio está en lo citado.
 */

export interface FuentesPermitidas {
  /** El texto de las secciones que citó la respuesta. */
  citadas: string[];
  /** Lo demás que el bot puede repetir: la pregunta de la persona, los valores de las variables del bot, el contacto. */
  otros: string[];
}

export interface Corte {
  tipo: 'numero' | 'enlace' | 'correo' | 'telefono';
  valor: string;
}

const RE_CORREO = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_ENLACE = /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+(?:com|org|net|gob|gov|edu|pa|uy|ar|mx|co|cl|pe|info|io|app|tv|me|es)(?:\.[a-z]{2})?)(?:\/[^\s)]*)?/gi;
const RE_TELEFONO = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]\d{4}\b/g;
const RE_NUMERO = /\d[\d.,]*\d|\d/g;

const digitos = (x: string) => x.replace(/\D/g, '');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Los valores que puede querer decir un número escrito: "559.000" es 559000 o 559; "17,50" es 17.5 o 1750. */
function valoresDe(token: string): string[] {
  const valores = [String(Number(digitos(token)))];
  const m = token.match(/^(.*\d)[.,](\d+)$/);
  if (m) valores.push(String(Number(`${digitos(m[1]!)}.${m[2]}`)));
  return valores;
}

function numerosDe(texto: string): Set<string> {
  const s = new Set<string>();
  // Una fecha escrita con el mes en letras vale también con el mes en números ("26 de noviembre" y "26/11").
  const minusculas = texto.toLowerCase();
  MESES.forEach((m, i) => {
    if (minusculas.includes(m) || (m === 'septiembre' && minusculas.includes('setiembre'))) s.add(String(i + 1));
  });
  for (const m of texto.matchAll(RE_NUMERO)) for (const v of valoresDe(m[0])) s.add(v);
  return s;
}

function dominiosDe(texto: string): Set<string> {
  const s = new Set<string>();
  for (const m of texto.matchAll(RE_ENLACE)) s.add(m[1]!.toLowerCase().replace(/^www\./, ''));
  return s;
}

export function validarDatos(respuesta: string, f: FuentesPermitidas): Corte[] {
  const fuente = [...f.citadas, ...f.otros].join('\n');
  const numeros = numerosDe(fuente);
  const dominios = dominiosDe(fuente);
  const correos = new Set([...fuente.matchAll(RE_CORREO)].map((m) => m[0].toLowerCase()));
  const telefonos = new Set([...fuente.matchAll(RE_TELEFONO)].map((m) => digitos(m[0])));
  const cortes: Corte[] = [];
  let resto = respuesta;

  for (const m of respuesta.matchAll(RE_CORREO)) {
    if (!correos.has(m[0].toLowerCase())) cortes.push({ tipo: 'correo', valor: m[0] });
    resto = resto.replace(m[0], ' ');
  }
  for (const m of resto.matchAll(RE_ENLACE)) {
    const dominio = m[1]!.toLowerCase().replace(/^www\./, '');
    if (!dominios.has(dominio) && ![...dominios].some((d) => d.endsWith(`.${dominio}`) || dominio.endsWith(`.${d}`))) cortes.push({ tipo: 'enlace', valor: m[0] });
    resto = resto.replace(m[0], ' ');
  }
  for (const m of resto.matchAll(RE_TELEFONO)) {
    const d = digitos(m[0]);
    // "2004-2007" tiene forma de teléfono: si cada grupo está en lo citado como número, pasa.
    const grupos = m[0].split(/\D+/).filter((g) => g.length >= 2);
    const comoNumeros = grupos.length > 0 && grupos.every((g) => numeros.has(String(Number(g))));
    if (!telefonos.has(d) && !comoNumeros) cortes.push({ tipo: 'telefono', valor: m[0].trim() });
    resto = resto.replace(m[0], ' ');
  }
  for (const m of resto.matchAll(RE_NUMERO)) {
    if (digitos(m[0]).length < 2) continue;
    if (!valoresDe(m[0]).some((v) => numeros.has(v))) cortes.push({ tipo: 'numero', valor: m[0] });
  }
  return cortes;
}
