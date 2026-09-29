/**
 * Reglas antes del motor: lo obvio se resuelve sin IA (más rápido, sin costo) y un pedido de baja no se pierde nunca.
 * Las usa el motor de conversación antes de interpretar un texto libre. Salen de la prueba de motores del 28/9/2026:
 *  - "ok", "👍" o "Bendiciones hermano, gracias" confundieron a casi todos los motores (despedida, saludo o apoyo);
 *  - "ya no me escriban mas xfa" terminó como despedida en dos motores: un pedido de baja no puede depender de eso.
 *
 * Una regla no decide qué hace el bot: devuelve una intención de la plantilla (cortesia, datos_personales,
 * no_entendible) y el flujo de esa intención sigue igual que si la hubiera elegido un motor. La baja, por ejemplo, va
 * al flujo de datos personales, que confirma antes de dejar de escribirle a la persona.
 */

export type IntencionRegla = 'cortesia' | 'datos_personales' | 'no_entendible';

export interface ResultadoRegla {
  intencion: IntencionRegla;
  /** Qué regla la resolvió (queda en la decisión del mensaje). */
  regla: 'cortesia' | 'baja' | 'adjunto' | 'risa';
  /** Solo cortesía: si suena a saludo o a cierre (el flujo decide con el momento de la conversación). */
  momento?: 'inicio' | 'cierre';
}

/** Minúsculas, sin tildes, sin signos: "¡Buenas tardes!" → "buenas tardes". Conserva la ñ. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/ñ/g, '\u0000')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0000/g, 'ñ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Cortesía ────────────────────────────────────────────────────────────────────────────────────

/** Palabras que por sí solas ya son cortesía: sin al menos una de estas, no hay regla. */
const ANCLAS_INICIO = ['hola', 'holaa', 'holis', 'buenas', 'buenos', 'buen', 'saludos', 'xopa'];
const ANCLAS_CIERRE = ['gracias', 'graciass', 'grax', 'ok', 'okey', 'oka', 'okay', 'dale', 'listo', 'perfecto', 'genial', 'excelente', 'bendiciones', 'bendicion', 'bendiga', 'chau', 'chao', 'adios', 'igualmente'];
/** Palabras que acompañan a la cortesía sin pedir nada. */
const RELLENO = [
  'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches', 'que', 'tal', 'como', 'esta', 'estas', 'estan', 'muy', 'bien',
  'muchas', 'mil', 'por', 'la', 'el', 'lo', 'le', 'los', 'su', 'sus', 'tu', 'informacion', 'info', 'todo', 'respuesta',
  'responder', 'atencion', 'ayuda', 'dios', 'hasta', 'luego', 'pronto', 'nos', 'vemos', 'y', 'e', 'a', 'mi', 'fren',
  'hermano', 'hermana', 'amigo', 'amiga', 'bro', 'senor', 'senora', 'una', 'consulta', 'pregunta', 'tengo', 'para',
];
const PALABRAS_CORTESIA = new Set([...ANCLAS_INICIO, ...ANCLAS_CIERRE, ...RELLENO]);
const MAX_PALABRAS_CORTESIA = 12;

/** Emojis que valen como cortesía cuando son todo el mensaje. Otros emojis solos van al motor (pueden ser crítica). */
const EMOJIS_CORTESIA = new Set(['👍', '🙏', '❤', '❤️', '♥', '♥️', '👏', '🙌', '💪', '😊', '🙂', '👌', '✅', '🤝', '😀', '😃', '☺', '☺️', '💙', '🫶']);
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F)?/gu;

function cortesia(texto: string): ResultadoRegla | null {
  // Sin espacios, uniones ni tonos de piel: 👍🏽 vale como 👍.
  const sinEspacios = texto.replace(/[\s\u200d\uFE0F]|[\u{1F3FB}-\u{1F3FF}]/gu, '');
  const emojis = sinEspacios.match(EMOJI) ?? [];
  if (sinEspacios && emojis.join('') === sinEspacios.replace(/\uFE0F/g, '')) {
    return emojis.every((e) => EMOJIS_CORTESIA.has(e) || EMOJIS_CORTESIA.has(e.replace(/\uFE0F/g, ''))) ? { intencion: 'cortesia', regla: 'cortesia', momento: 'cierre' } : null;
  }
  const palabras = normalizar(texto).split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > MAX_PALABRAS_CORTESIA) return null;
  if (!palabras.every((p) => PALABRAS_CORTESIA.has(p))) return null;
  const cierre = palabras.some((p) => ANCLAS_CIERRE.includes(p));
  const inicio = palabras.some((p) => ANCLAS_INICIO.includes(p));
  if (!cierre && !inicio) return null;
  return { intencion: 'cortesia', regla: 'cortesia', momento: cierre ? 'cierre' : 'inicio' };
}

// ── Baja ────────────────────────────────────────────────────────────────────────────────────────

const BAJA = [
  /\b(ya )?no (me|nos) (escrib|mand|envi|contact|llam|molest|agreg|sum)\w*/,
  /\bno quiero (recibir|que me|mas mensajes|mas nada)/,
  /\b(borr|elimin|saqu|sac|quit)(enme|ame|arme|ennos|anos)\b/,
  /\b(dar(me|nos)?|doy|den(me)?) de baja\b/,
  /\b(desuscrib|desinscrib|dessuscrib)\w*/,
  /^(baja|stop|parar|basta|cancelar)$/,
];
/** "¿Por qué no me escriben?" es una queja, no una baja. */
const NO_ES_BAJA = /\bpor ?que no (me|nos)\b/;

function baja(texto: string): ResultadoRegla | null {
  const t = normalizar(texto);
  if (!t || NO_ES_BAJA.test(t)) return null;
  return BAJA.some((r) => r.test(t)) ? { intencion: 'datos_personales', regla: 'baja' } : null;
}

// ── Sin texto que interpretar ───────────────────────────────────────────────────────────────────

/** Lo que un canal pone en lugar de un adjunto sin texto. */
const ADJUNTO = /^\[(audio|imagen|foto|video|sticker|documento|archivo|ubicacion|contacto|gif)\]$/i;
const RISA = /^(?:(?:j[aeiou]|[aeiou]j){2,}j?|(?:ha|he|hi){2,}h?|x+d+|(?:js)+j?|lol|lmao)$/;

function sinTexto(texto: string): ResultadoRegla | null {
  if (ADJUNTO.test(texto.trim())) return { intencion: 'no_entendible', regla: 'adjunto' };
  const palabras = normalizar(texto).split(' ').filter(Boolean);
  if (palabras.length && palabras.length <= 3 && palabras.every((p) => RISA.test(p))) return { intencion: 'no_entendible', regla: 'risa' };
  return null;
}

/**
 * La regla que resuelve el mensaje, o null si tiene que interpretarlo un motor. El orden importa: una baja gana
 * aunque venga con cortesía ("gracias, no me escriban más").
 */
export function reglaAntesDelMotor(texto: string): ResultadoRegla | null {
  if (!texto || !texto.trim()) return null;
  return baja(texto) ?? sinTexto(texto) ?? cortesia(texto);
}
