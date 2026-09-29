/**
 * WhatsApp (etapa 7): las reglas del canal que no dependen de la base ni de la red.
 *
 *  - Traducir lo que dice el bot (texto, botones, lista) al formato de mensajes de WhatsApp Cloud API, que es el que
 *    usa 360dialog, y lo que manda la persona (texto, botón, fila de lista, audio, imagen…) a una entrada del motor.
 *  - La ventana de 24 horas: fuera de ella solo se puede escribir con una plantilla aprobada.
 *  - Las plantillas de la cuenta de 360dialog de la campaña y cómo se completan.
 *  - El consumo estimado del mes (Meta cobra las respuestas desde el 1/10/2026, pasadas las 1.000 gratis por número).
 *  - El aviso de la política de WhatsApp Business para bots electorales y políticos: informa, no bloquea.
 *
 * Los formatos salen de la documentación de 360dialog (waba-v2.360dialog.io, consultada el 29/9/2026): POST /messages,
 * POST /v1/configs/webhook con encabezados propios, GET /message_templates y los avisos (webhooks) de Meta.
 */
import type { Entrada, MensajeSalida } from './motor';
import type { Trato } from './tipos';

export const LIMITES_WHATSAPP = {
  botones: 3,
  tituloBoton: 20,
  filas: 10,
  tituloFila: 24,
  descripcionFila: 72,
  /** El texto de un mensaje con botones o lista. */
  cuerpoInteractivo: 1024,
  texto: 4096,
  botonLista: 20,
} as const;

/** Después del último mensaje de la persona, la campaña puede escribirle libremente durante este tiempo. */
export const HORAS_VENTANA = 24;

/**
 * Lo que cobra Meta por las respuestas (Definición de producto, "WhatsApp (360dialog)"): desde el 1/10/2026, pasadas
 * las 1.000 gratis por número y por mes, la tarifa de utilidad del resto de América Latina. Es una estimación: la
 * factura es de Meta, con el saldo de la cuenta de 360dialog de la campaña.
 */
export const COSTO_WHATSAPP = { desde: '2026-10-01', gratisPorMes: 1000, usdPorRespuesta: 0.0113 } as const;

export const AVISO_POLITICA_WHATSAPP =
  'La política de WhatsApp Business (actualizada el 23/9/2026) no admite partidos, candidatos ni campañas. Conectar el ' +
  'número es una decisión de la campaña: Meta puede limitar o dar de baja la cuenta. BotMaker solo responde a quien ' +
  'escribe; no hace envíos masivos ni manda mensajes de campaña. El widget y la página del bot siguen siendo el canal principal.';

export const ESTADOS_CANAL = ['activo', 'apagado', 'desconectado'] as const;
export type EstadoCanal = (typeof ESTADOS_CANAL)[number];

export const ETIQUETA_ESTADO_CANAL: Record<EstadoCanal, string> = {
  activo: 'Conectado',
  apagado: 'Apagado',
  desconectado: 'Desconectado',
};

/** Cómo va cada mensaje que sale por WhatsApp. */
export const ESTADOS_ENVIO = ['pendiente', 'enviado', 'entregado', 'leido', 'fallido'] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

export const ETIQUETA_ESTADO_ENVIO: Record<EstadoEnvio, string> = {
  pendiente: 'Por enviar',
  enviado: 'Enviado',
  entregado: 'Entregado',
  leido: 'Leído',
  fallido: 'No se envió',
};

/** Un estado solo avanza (enviado → entregado → leído); fallido gana siempre. */
export function estadoSiguiente(actual: EstadoEnvio, nuevo: EstadoEnvio): EstadoEnvio {
  if (actual === 'fallido' || nuevo === 'fallido') return 'fallido';
  return ESTADOS_ENVIO.indexOf(nuevo) > ESTADOS_ENVIO.indexOf(actual) ? nuevo : actual;
}

/** Los estados que avisa Meta, en nuestras palabras. */
export function estadoDeMeta(s: string): EstadoEnvio | null {
  return ({ sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' } as Record<string, EstadoEnvio>)[s] ?? null;
}

// ── Mensajes que salen (formato de WhatsApp Cloud API, sin el destinatario) ─────────────────────

export type MensajeWhatsapp =
  | { type: 'text'; text: { body: string; preview_url?: boolean } }
  | { type: 'interactive'; interactive: { type: 'button'; body: { text: string }; action: { buttons: { type: 'reply'; reply: { id: string; title: string } }[] } } }
  | { type: 'interactive'; interactive: { type: 'list'; body: { text: string }; action: { button: string; sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[] } } }
  | { type: 'template'; template: { name: string; language: { code: string }; components?: { type: 'body'; parameters: { type: 'text'; text: string; parameter_name?: string }[] }[] } };

const recortar = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

/** El id de un botón o una fila: la caja y la letra (así la respuesta vuelve al motor como una opción). */
export function idOpcion(cajaId: string, letra: string): string {
  return `${cajaId}|${letra}`;
}

export function leerIdOpcion(id: string): { cajaId: string; letra: string } | null {
  const m = /^([A-Za-z0-9_]{1,40})\|([A-Z]{1,2})$/.exec(id);
  return m ? { cajaId: m[1]!, letra: m[2]! } : null;
}

/**
 * Lo que dice el bot, en mensajes de WhatsApp. Casi siempre uno; dos si el texto no entra en un mensaje con botones
 * (el texto va primero, solo, y las opciones después). Hasta 3 opciones van como botones; más, como lista (hasta 10).
 */
export function aWhatsapp(m: Pick<MensajeSalida, 'texto' | 'opciones' | 'modo' | 'opcionesDe'>, trato: Trato): MensajeWhatsapp[] {
  const texto = m.texto.trim();
  const opciones = (m.opciones ?? []).slice(0, LIMITES_WHATSAPP.filas);
  if (!opciones.length || !m.opcionesDe) {
    if (!texto) return [];
    return partirTexto(texto).map((body) => ({ type: 'text', text: { body, preview_url: /https?:\/\//.test(body) } }));
  }
  const elegir = trato === 'usted' ? 'Elija una opción:' : 'Elegí una opción:';
  const previos: MensajeWhatsapp[] = [];
  let cuerpo = texto || elegir;
  if (cuerpo.length > LIMITES_WHATSAPP.cuerpoInteractivo) {
    previos.push(...partirTexto(cuerpo).map((body): MensajeWhatsapp => ({ type: 'text', text: { body } })));
    cuerpo = elegir;
  }
  const botones = (m.modo ?? 'botones') === 'botones' && opciones.length <= LIMITES_WHATSAPP.botones;
  if (botones) {
    return [...previos, {
      type: 'interactive',
      interactive: {
        type: 'button', body: { text: cuerpo },
        action: { buttons: opciones.map((o) => ({ type: 'reply' as const, reply: { id: idOpcion(m.opcionesDe!, o.letra), title: recortar(o.texto, LIMITES_WHATSAPP.tituloBoton) } })) },
      },
    }];
  }
  return [...previos, {
    type: 'interactive',
    interactive: {
      type: 'list', body: { text: cuerpo },
      action: {
        button: 'Ver opciones',
        sections: [{
          rows: opciones.map((o) => ({
            id: idOpcion(m.opcionesDe!, o.letra), title: recortar(o.texto, LIMITES_WHATSAPP.tituloFila),
            ...(o.descripcion ? { description: recortar(o.descripcion, LIMITES_WHATSAPP.descripcionFila) } : {}),
          })),
        }],
      },
    },
  }];
}

/** Un texto largo en partes de hasta 4.096 caracteres, cortando en un fin de párrafo o de línea si se puede. */
export function partirTexto(texto: string, max: number = LIMITES_WHATSAPP.texto): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n\n', max);
    if (corte < max / 2) corte = resto.lastIndexOf('\n', max);
    if (corte < max / 2) corte = resto.lastIndexOf(' ', max);
    if (corte < max / 2) corte = max;
    partes.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** El texto que ve el equipo de un mensaje que salió (para la bandeja y las pruebas). */
export function textoDeWhatsapp(m: MensajeWhatsapp): string {
  switch (m.type) {
    case 'text': return m.text.body;
    case 'interactive': return m.interactive.body.text;
    case 'template': return `[plantilla ${m.template.name}]`;
  }
}

// ── Mensajes que llegan ─────────────────────────────────────────────────────────────────────────

/** Un mensaje de la persona, como lo avisa Meta (el subconjunto que usa BotMaker). */
export interface MensajeMeta {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string; description?: string } };
  button?: { text?: string; payload?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
}

/** Lo que el canal pone en lugar de un adjunto sin texto: las reglas antes del motor lo reconocen (dominio/reglas.ts). */
const ADJUNTOS: Record<string, string> = {
  audio: '[audio]', voice: '[audio]', image: '[imagen]', video: '[video]', document: '[documento]', sticker: '[sticker]',
  location: '[ubicacion]', contacts: '[contacto]',
};

export interface EntranteWhatsapp {
  /** El id de WhatsApp del mensaje (wamid…): los reintentos de 360dialog traen el mismo. */
  id: string;
  /** El número de quien escribe (solo dígitos, con el código de país). */
  de: string;
  /** Cuándo lo mandó (ISO, UTC). */
  hora: string;
  entrada: Entrada;
  /** El texto que queda en la conversación (el título del botón que tocó, o [audio]…). */
  texto: string;
  tipo: 'texto' | 'opcion' | 'adjunto';
  /** El nombre de perfil de WhatsApp, si vino en el aviso. */
  nombrePerfil?: string | null;
}

/** Un mensaje de Meta como entrada del motor, o null si no hay que contestarlo (una reacción, un aviso del sistema). */
export function leerMensaje(m: MensajeMeta): EntranteWhatsapp | null {
  const de = String(m.from ?? '').replace(/\D/g, '');
  if (!de || !/^\d{7,15}$/.test(de) || !m.id) return null;
  const segundos = Number(m.timestamp);
  const hora = new Date(Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : Date.now()).toISOString();
  const base = { id: String(m.id), de, hora };
  const texto = (t: string): EntranteWhatsapp | null => {
    const x = t.trim().slice(0, 2000);
    return x ? { ...base, entrada: { tipo: 'texto', texto: x }, texto: x, tipo: 'texto' } : null;
  };
  switch (m.type) {
    case 'text':
      return texto(m.text?.body ?? '');
    case 'interactive': {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (!r) return null;
      const titulo = String(r.title ?? '').slice(0, 200);
      const op = leerIdOpcion(String(r.id ?? ''));
      if (!op) return texto(titulo);
      return { ...base, entrada: { tipo: 'opcion', cajaId: op.cajaId, letra: op.letra, titulo }, texto: titulo, tipo: 'opcion' };
    }
    case 'button':
      // El botón de respuesta rápida de una plantilla: su texto vale como si lo hubiera escrito.
      return texto(m.button?.text ?? m.button?.payload ?? '');
    case 'image':
    case 'video':
    case 'document': {
      const pie = (m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? '').trim();
      if (pie) return texto(pie);
      break;
    }
    case 'reaction':
    case 'system':
    case 'unsupported':
    case 'request_welcome':
      return null;
  }
  const marca = ADJUNTOS[m.type];
  if (!marca) return null;
  return { ...base, entrada: { tipo: 'texto', texto: marca }, texto: marca, tipo: 'adjunto' };
}

// ── Ventana de 24 horas ─────────────────────────────────────────────────────────────────────────

export function ventanaHasta(ultimoDeLaPersona: string | Date): string {
  return new Date(new Date(ultimoDeLaPersona).getTime() + HORAS_VENTANA * 36e5).toISOString();
}

export function ventanaAbierta(hasta: string | null | undefined, ahora: Date): boolean {
  return !!hasta && new Date(hasta).getTime() > ahora.getTime();
}

// ── Plantillas (7.07) ───────────────────────────────────────────────────────────────────────────

/**
 * Una plantilla de la cuenta de 360dialog de la campaña: se crea en BotMaker (o en el panel de 360dialog), Meta la revisa
 * y, aprobada, es la única forma de escribirle a alguien con la ventana de 24 horas cerrada.
 */
export const ESTADOS_PLANTILLA = ['en_revision', 'aprobada', 'rechazada', 'pausada', 'deshabilitada', 'otro'] as const;
export type EstadoPlantilla = (typeof ESTADOS_PLANTILLA)[number];

export const ETIQUETA_ESTADO_PLANTILLA: Record<EstadoPlantilla, string> = {
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  pausada: 'Pausada por Meta',
  deshabilitada: 'Deshabilitada',
  otro: 'Otro estado',
};

export function estadoPlantillaDeMeta(s: string | undefined): EstadoPlantilla {
  switch ((s ?? '').toUpperCase()) {
    case 'APPROVED': return 'aprobada';
    case 'PENDING': case 'IN_REVIEW': case 'PENDING_APPROVAL': case 'SUBMITTED': return 'en_revision';
    case 'REJECTED': return 'rechazada';
    case 'PAUSED': return 'pausada';
    case 'DISABLED': case 'DELETED': return 'deshabilitada';
    default: return 'otro';
  }
}

/** utility: seguir una consulta de la persona (lo que corresponde para retomar). marketing: novedades o convocatorias. */
export const CATEGORIAS_PLANTILLA = ['utility', 'marketing'] as const;
export type CategoriaPlantilla = (typeof CATEGORIAS_PLANTILLA)[number];
export const ETIQUETA_CATEGORIA_PLANTILLA: Record<CategoriaPlantilla, string> = { utility: 'Utilidad (seguir una consulta)', marketing: 'Marketing (novedades)' };

export const IDIOMAS_PLANTILLA = [
  { codigo: 'es', nombre: 'Español' }, { codigo: 'es_AR', nombre: 'Español (Argentina)' }, { codigo: 'es_MX', nombre: 'Español (México)' },
  { codigo: 'es_ES', nombre: 'Español (España)' }, { codigo: 'en_US', nombre: 'Inglés (Estados Unidos)' },
] as const;

export interface Plantilla {
  /** El id de Meta (null si todavía no se mandó). */
  id: string | null;
  nombre: string;
  idioma: string;
  categoria: string;
  estado: EstadoPlantilla;
  /** Por qué la rechazó Meta, si la rechazó. */
  motivo: string | null;
  /** El cuerpo con sus espacios: {{1}}, {{2}}… o {{nombre}}, {{tema}}… */
  texto: string;
  formato: 'posicional' | 'nombre';
  /** Los espacios en orden: ["1", "2"] o ["nombre", "tema"]. */
  variables: string[];
  /** Se puede mandar desde la bandeja: aprobada y sin encabezado con imagen o variables. */
  usable: boolean;
  /** Si no es usable, por qué (para mostrar). */
  aviso: string | null;
}

/** Una plantilla como la devuelve GET /message_templates (el subconjunto que usa BotMaker). */
export interface PlantillaMeta {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  parameter_format?: string;
  components?: { type?: string; format?: string; text?: string }[];
}

const RE_POSICIONAL = /\{\{\s*(\d+)\s*\}\}/g;
const RE_NOMBRE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

/** Los espacios de un texto, en orden de aparición y sin repetir. */
export function variablesDe(texto: string): { formato: 'posicional' | 'nombre'; variables: string[] } {
  const pos = [...texto.matchAll(RE_POSICIONAL)].map((x) => x[1]!);
  const nom = [...texto.matchAll(RE_NOMBRE)].map((x) => x[1]!);
  if (nom.length && !pos.length) return { formato: 'nombre', variables: [...new Set(nom)] };
  return { formato: 'posicional', variables: [...new Set(pos)].sort((a, b) => Number(a) - Number(b)) };
}

export function leerPlantilla(p: PlantillaMeta): Plantilla | null {
  if (!p.name || !p.language) return null;
  const comps = p.components ?? [];
  const cuerpo = comps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text ?? '';
  const encabezado = comps.find((c) => (c.type ?? '').toUpperCase() === 'HEADER');
  const { formato, variables } = variablesDe(cuerpo);
  const estado = estadoPlantillaDeMeta(p.status);
  let aviso: string | null = null;
  if (estado !== 'aprobada') aviso = estado === 'en_revision' ? 'Meta todavía la está revisando.' : `No se puede usar: ${ETIQUETA_ESTADO_PLANTILLA[estado].toLowerCase()}.`;
  else if (!cuerpo) aviso = 'No tiene texto.';
  else if (encabezado && ((encabezado.format ?? 'TEXT').toUpperCase() !== 'TEXT' || /\{\{/.test(encabezado.text ?? ''))) aviso = 'Tiene un encabezado con imagen o con espacios: se manda desde el panel de 360dialog.';
  return {
    id: p.id ? String(p.id) : null, nombre: p.name, idioma: p.language, categoria: (p.category ?? '').toLowerCase(), estado,
    motivo: estado === 'rechazada' ? (p.rejected_reason && p.rejected_reason !== 'NONE' ? p.rejected_reason : 'Meta no dio el motivo.') : null,
    texto: cuerpo, formato: (p.parameter_format ?? '').toLowerCase() === 'named' ? 'nombre' : formato, variables, usable: !aviso, aviso,
  };
}

/** El texto de la plantilla con sus espacios completos (lo que queda en la conversación). */
export function completarPlantilla(texto: string, valores: Readonly<Record<string, string>>): string {
  return texto.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => valores[k] ?? '');
}

export function mensajePlantilla(p: Pick<Plantilla, 'nombre' | 'idioma' | 'formato' | 'variables'>, valores: Readonly<Record<string, string>>): MensajeWhatsapp {
  const parametros = p.variables.map((v) => (p.formato === 'nombre' ? { type: 'text' as const, parameter_name: v, text: valores[v] ?? '' } : { type: 'text' as const, text: valores[v] ?? '' }));
  return {
    type: 'template',
    template: { name: p.nombre, language: { code: p.idioma }, ...(parametros.length ? { components: [{ type: 'body' as const, parameters: parametros }] } : {}) },
  };
}

/** Una plantilla nueva, como la arma el administrador en BotMaker. */
export interface NuevaPlantilla {
  nombre: string;
  categoria: CategoriaPlantilla;
  idioma: string;
  texto: string;
  /** Un ejemplo por espacio (Meta los pide para revisarla). */
  ejemplos: Record<string, string>;
}

export const LIMITES_PLANTILLA = { nombre: 60, texto: 1024, ejemplo: 200 } as const;

/** Lo que hay que corregir antes de mandarla a aprobar (vacío: está lista). */
export function problemasPlantilla(n: NuevaPlantilla): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9_]{1,60}$/.test(n.nombre)) p.push('El nombre va en minúsculas, sin espacios ni tildes (letras, números y _), hasta 60 caracteres.');
  if (!(CATEGORIAS_PLANTILLA as readonly string[]).includes(n.categoria)) p.push('Elegí la categoría.');
  if (!IDIOMAS_PLANTILLA.some((i) => i.codigo === n.idioma)) p.push('Elegí el idioma.');
  const t = n.texto.trim();
  if (!t) p.push('Falta el texto.');
  if (t.length > LIMITES_PLANTILLA.texto) p.push(`El texto pasa los ${LIMITES_PLANTILLA.texto} caracteres.`);
  const pos = [...t.matchAll(RE_POSICIONAL)].length;
  const nom = [...t.matchAll(RE_NOMBRE)].length;
  if (pos && nom) p.push('Usá espacios numerados ({{1}}) o con nombre ({{nombre}}), no los dos.');
  const { formato, variables } = variablesDe(t);
  if (formato === 'posicional' && variables.some((v, i) => Number(v) !== i + 1)) p.push('Los espacios numerados van en orden y sin saltos: {{1}}, {{2}}…');
  for (const v of variables) {
    const e = (n.ejemplos[v] ?? '').trim();
    if (!e) p.push(`Falta un ejemplo para {{${v}}}.`);
    else if (e.length > LIMITES_PLANTILLA.ejemplo) p.push(`El ejemplo de {{${v}}} es muy largo.`);
  }
  return p;
}

/** Lo que conviene revisar antes de mandarla (no frena: Meta decide). */
export function avisosPlantilla(n: Pick<NuevaPlantilla, 'texto' | 'categoria'>): string[] {
  const a: string[] = [];
  const t = n.texto.trim();
  if (/^\{\{/.test(t) || /\}\}[\s.!?]*$/.test(t)) a.push('Meta suele rechazar las plantillas que empiezan o terminan con un espacio para completar.');
  if (n.categoria === 'utility' && /\b(vot[aáe]|sumate|donaci[oó]n|don[aá]|evento|acto|marcha|campa[nñ]a)\b/i.test(t)) a.push('Parece de marketing: si Meta lo ve así, la cambia de categoría (y cuesta más).');
  return a;
}

/** El pedido de POST /message_templates de 360dialog (formato de Meta). */
export function plantillaAMeta(n: NuevaPlantilla): Record<string, unknown> {
  const texto = n.texto.trim();
  const { formato, variables } = variablesDe(texto);
  const ejemplo = !variables.length
    ? {}
    : formato === 'nombre'
      ? { example: { body_text_named_params: variables.map((v) => ({ param_name: v, example: n.ejemplos[v]!.trim() })) } }
      : { example: { body_text: [variables.map((v) => n.ejemplos[v]!.trim())] } };
  return {
    name: n.nombre, language: n.idioma, category: n.categoria.toUpperCase(), parameter_format: formato === 'nombre' ? 'named' : 'positional',
    components: [{ type: 'BODY', text: texto, ...ejemplo }],
  };
}

// ── Consumo del mes ─────────────────────────────────────────────────────────────────────────────

export interface ConsumoWhatsapp {
  respuestas: number;
  gratis: number;
  cobradas: number;
  usd: number;
  /** Antes del 1/10/2026 Meta no cobraba las respuestas. */
  vigente: boolean;
}

export function consumoWhatsapp(respuestasDelMes: number, ahora: Date): ConsumoWhatsapp {
  const vigente = ahora.toISOString().slice(0, 10) >= COSTO_WHATSAPP.desde;
  const cobradas = vigente ? Math.max(0, respuestasDelMes - COSTO_WHATSAPP.gratisPorMes) : 0;
  return { respuestas: respuestasDelMes, gratis: COSTO_WHATSAPP.gratisPorMes, cobradas, usd: Math.round(cobradas * COSTO_WHATSAPP.usdPorRespuesta * 100) / 100, vigente };
}

// ── El canal ────────────────────────────────────────────────────────────────────────────────────

/** Una clave de 360dialog con forma válida (no dice si anda: eso lo contesta 360dialog). */
export function claveConForma(clave: string): boolean {
  return /^[A-Za-z0-9_-]{16,256}$/.test(clave.trim());
}

/** El número como lo ve la gente: +507 6000-1234. Solo para mostrar. */
export function numeroVisible(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  const d = t.replace(/[^\d+]/g, '');
  return /^\+?\d{7,15}$/.test(d) ? t.slice(0, 30) : null;
}

/** Los últimos cuatro dígitos (para distinguir contactos en la bandeja sin mostrar el número). */
export function finalDelNumero(numero: string | null): string | null {
  const d = (numero ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}
