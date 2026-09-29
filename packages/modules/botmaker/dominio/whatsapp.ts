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
  | { type: 'template'; template: { name: string; language: { code: string }; components?: { type: 'body'; parameters: { type: 'text'; text: string }[] }[] } };

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

// ── Plantillas ──────────────────────────────────────────────────────────────────────────────────

export interface Plantilla {
  nombre: string;
  idioma: string;
  categoria: string;
  estado: string;
  /** El cuerpo con sus variables {{1}}, {{2}}… */
  texto: string;
  parametros: number;
  /** Solo las aprobadas con cuerpo de texto y variables numeradas se mandan desde la bandeja. */
  usable: boolean;
  motivo: string | null;
}

/** Una plantilla como la devuelve GET /message_templates (el subconjunto que usa BotMaker). */
export interface PlantillaMeta {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  parameter_format?: string;
  components?: { type?: string; format?: string; text?: string }[];
}

export function leerPlantilla(p: PlantillaMeta): Plantilla | null {
  if (!p.name || !p.language) return null;
  const comps = p.components ?? [];
  const cuerpo = comps.find((c) => (c.type ?? '').toUpperCase() === 'BODY')?.text ?? '';
  const encabezado = comps.find((c) => (c.type ?? '').toUpperCase() === 'HEADER');
  const numeradas = [...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => Number(x[1]));
  const nombradas = /\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/i.test(cuerpo);
  const parametros = numeradas.length ? Math.max(...numeradas) : 0;
  let motivo: string | null = null;
  if ((p.status ?? '').toUpperCase() !== 'APPROVED') motivo = 'Todavía no la aprobó Meta.';
  else if (!cuerpo) motivo = 'No tiene texto.';
  else if (nombradas || (p.parameter_format ?? '').toUpperCase() === 'NAMED') motivo = 'Usa variables con nombre: desde la bandeja solo se completan las numeradas.';
  else if (encabezado && ((encabezado.format ?? 'TEXT').toUpperCase() !== 'TEXT' || /\{\{/.test(encabezado.text ?? ''))) motivo = 'Tiene un encabezado con imagen o variables: se manda desde 360dialog.';
  return {
    nombre: p.name, idioma: p.language, categoria: (p.category ?? '').toLowerCase(), estado: (p.status ?? '').toLowerCase(), texto: cuerpo,
    parametros, usable: !motivo, motivo,
  };
}

/** El texto de la plantilla con sus variables completas (lo que queda en la conversación). */
export function completarPlantilla(texto: string, valores: readonly string[]): string {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => valores[Number(n) - 1] ?? '');
}

export function mensajePlantilla(p: Pick<Plantilla, 'nombre' | 'idioma'>, valores: readonly string[]): MensajeWhatsapp {
  return {
    type: 'template',
    template: {
      name: p.nombre, language: { code: p.idioma },
      ...(valores.length ? { components: [{ type: 'body' as const, parameters: valores.map((v) => ({ type: 'text' as const, text: v })) }] } : {}),
    },
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
