/**
 * Contratos de la capa de motores: qué recibe y qué devuelve cada función, fijo para cualquier motor. La salida de un
 * modelo se valida con zod antes de usarla; si no valida, cuenta como una falla y la capa pasa al respaldo.
 *
 * Los esquemas JSON (para el response_format estricto de OpenRouter) no usan claves libres ni límites de largo, porque
 * no todos los proveedores los aceptan en modo estricto: lo que falta se controla en zod.
 */
import { z } from 'zod';
import type { FuncionMotor } from '../dominio/tipos';

export interface Turno {
  quien: 'persona' | 'bot';
  texto: string;
}

// ── Interpretar ─────────────────────────────────────────────────────────────────────────────────

export interface EntradaInterpretar {
  mensaje: string;
  /** Los últimos turnos de la conversación (hasta 6). */
  turnos: Turno[];
  intenciones: { id: string; descripcion: string; ejemplos?: string[] }[];
  temas: { id: string; nombre: string }[];
}

export interface Interpretacion {
  intencion: string;
  tema: string;
  confianza: number;
  alternativas: { intencion: string; tema: string; confianza: number }[];
}

export const MAX_TURNOS = 6;
export const MAX_ALTERNATIVAS = 2;

const normal = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export function contratoInterpretar(e: Pick<EntradaInterpretar, 'intenciones' | 'temas'>) {
  const intenciones = e.intenciones.map((i) => i.id);
  const temas = e.temas.map((t) => t.id);
  if (!intenciones.length || !temas.length) throw new Error('El catálogo de intenciones y temas está vacío.');
  const opcion = {
    type: 'object',
    properties: { intencion: { type: 'string', enum: intenciones }, tema: { type: 'string', enum: temas }, confianza: { type: 'number' } },
    required: ['intencion', 'tema', 'confianza'],
    additionalProperties: false,
  };
  const json = {
    type: 'object',
    properties: { ...opcion.properties, alternativas: { type: 'array', items: opcion } },
    required: ['intencion', 'tema', 'confianza', 'alternativas'],
    additionalProperties: false,
  };
  const confianza = z.coerce.number().min(0).max(1);
  const unaOpcion = z.object({
    intencion: z.preprocess(normal, z.enum(intenciones as [string, ...string[]])),
    tema: z.preprocess(normal, z.enum(temas as [string, ...string[]])),
    confianza,
  });
  // Las alternativas que no valen se descartan (no invalidan la interpretación principal).
  const alternativas = (v: unknown) => (Array.isArray(v) ? v : [])
    .map((x) => unaOpcion.safeParse(x))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, MAX_ALTERNATIVAS);
  const zod = unaOpcion.extend({ alternativas: z.preprocess(alternativas, z.array(unaOpcion)) });
  return { esquema: { nombre: 'interpretacion', schema: json }, zod: zod as unknown as z.ZodType<Interpretacion> };
}

// ── Responder con base ──────────────────────────────────────────────────────────────────────────

export interface SeccionMaterial {
  codigo: string;
  titulo: string;
  texto: string;
  fuente?: string;
  fecha?: string;
}

export interface EntradaResponder {
  pregunta: string;
  turnos: Turno[];
  material: SeccionMaterial[];
}

export interface RespuestaConBase {
  respuesta: string;
  secciones: string[];
  tiene_respuesta: 'si' | 'no' | 'parcial';
}

export const contratoResponder = {
  esquema: {
    nombre: 'respuesta',
    schema: {
      type: 'object',
      properties: {
        respuesta: { type: 'string' },
        secciones: { type: 'array', items: { type: 'string' } },
        tiene_respuesta: { type: 'string', enum: ['si', 'no', 'parcial'] },
      },
      required: ['respuesta', 'secciones', 'tiene_respuesta'],
      additionalProperties: false,
    },
  },
  zod: z.object({
    respuesta: z.string().trim().min(1),
    secciones: z.array(z.string()).catch([]).transform((xs) => xs.map((x) => x.trim().toUpperCase()).filter(Boolean)),
    tiene_respuesta: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase().replace('í', 'i') : v), z.enum(['si', 'no', 'parcial'])),
  }) as z.ZodType<RespuestaConBase>,
};

// ── Copiloto ────────────────────────────────────────────────────────────────────────────────────

export interface EntradaCopiloto {
  pedido: string;
  /** El borrador del bot (la definición, etapa 2). */
  borrador: unknown;
  material?: SeccionMaterial[];
}

/** Una operación propuesta sobre el borrador. `datos` va como texto JSON (modo estricto sin claves libres). */
export interface OperacionPropuesta {
  tipo: string;
  datos: Record<string, unknown>;
  explicacion: string;
}

export interface PropuestaCopiloto {
  operaciones: OperacionPropuesta[];
  explicacion: string;
  dudas: string[];
}

export const contratoCopiloto = {
  esquema: {
    nombre: 'propuesta',
    schema: {
      type: 'object',
      properties: {
        operaciones: {
          type: 'array',
          items: {
            type: 'object',
            properties: { tipo: { type: 'string' }, datos_json: { type: 'string' }, explicacion: { type: 'string' } },
            required: ['tipo', 'datos_json', 'explicacion'],
            additionalProperties: false,
          },
        },
        explicacion: { type: 'string' },
        dudas: { type: 'array', items: { type: 'string' } },
      },
      required: ['operaciones', 'explicacion', 'dudas'],
      additionalProperties: false,
    },
  },
  zod: z.object({
    operaciones: z.array(z.object({
      tipo: z.string().trim().min(1),
      datos_json: z.string(),
      explicacion: z.string().catch(''),
    }).transform((o) => {
      let datos: Record<string, unknown> = {};
      try {
        const x = JSON.parse(o.datos_json);
        if (x && typeof x === 'object' && !Array.isArray(x)) datos = x as Record<string, unknown>;
      } catch { /* datos vacíos: la capa de operaciones lo va a rechazar al validar */ }
      return { tipo: o.tipo, datos, explicacion: o.explicacion };
    })),
    explicacion: z.string().catch(''),
    dudas: z.array(z.string()).catch([]),
  }) as unknown as z.ZodType<PropuestaCopiloto>,
};

// ── Por función ─────────────────────────────────────────────────────────────────────────────────

export interface EntradaDe {
  interpretar: EntradaInterpretar;
  responder: EntradaResponder;
  copiloto: EntradaCopiloto;
}

export interface SalidaDe {
  interpretar: Interpretacion;
  responder: RespuestaConBase;
  copiloto: PropuestaCopiloto;
}

/** Tokens máximos de salida por función (los modelos con razonamiento los gastan también pensando). */
export const MAX_TOKENS: Record<FuncionMotor, number> = {
  interpretar: 800,
  responder: 1500,
  copiloto: 4000,
};

/** Quita cercos de código (```json … ```) y el texto alrededor del primer objeto JSON. */
export function extraerJson(texto: string): unknown {
  let t = texto.trim();
  const cerco = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerco) t = cerco[1]!.trim();
  const inicio = t.indexOf('{');
  const fin = t.lastIndexOf('}');
  if (inicio === -1 || fin <= inicio) throw new Error('No hay un objeto JSON en la respuesta');
  return JSON.parse(t.slice(inicio, fin + 1));
}
