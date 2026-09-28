/**
 * Reglas de los bots: validación de lo que llega de un formulario (con zod) y textos de pantalla. Las mismas reglas las
 * exige la base (checks de bots.bots en bots_0001_base.sql).
 */
import { z } from 'zod';
import { mercado } from './mercados';
import { CASOS, TRATOS, type CasoUso, type EstadoBot, type Trato } from './tipos';

export const LARGO_NOMBRE = 80;
export const LARGO_AVISO_IA = 300;
export const DIAS_GUARDADO_POR_DEFECTO = 90;

const nombre = z.string().trim().min(1, 'nombre_vacio').max(LARGO_NOMBRE, 'nombre_largo');
const codigoMercado = z.string().trim().toUpperCase().refine((x) => !!mercado(x), 'mercado');

export const esquemaNuevoBot = z.object({
  nombre,
  caso: z.enum(CASOS, { error: 'caso' }),
  mercado: codigoMercado,
  trato: z.enum(TRATOS, { error: 'trato' }),
});

export const esquemaCambiosBot = z.object({
  nombre: nombre.optional(),
  caso: z.enum(CASOS, { error: 'caso' }).optional(),
  mercado: codigoMercado.optional(),
  trato: z.enum(TRATOS, { error: 'trato' }).optional(),
  avisoIa: z.string().trim().max(LARGO_AVISO_IA, 'aviso_largo').optional(),
});

export const esquemaTopes = z.object({
  diarioUsd: z.number({ error: 'tope' }).min(0, 'tope').max(100000, 'tope'),
  mensualUsd: z.number({ error: 'tope' }).min(0, 'tope').max(999999, 'tope'),
}).refine((t) => t.diarioUsd <= t.mensualUsd, 'tope_diario_mayor');

export const esquemaDatosPersonales = z.object({
  personalizacion: z.boolean(),
  diasGuardado: z.number({ error: 'dias' }).int('dias').min(1, 'dias').max(365, 'dias'),
});

/** El primer código de error de una validación de zod (los mensajes son códigos de vistas/mensajes.ts). */
export function codigoError(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'datos';
}

export const ETIQUETA_CASO: Record<CasoUso, string> = {
  electoral: 'Electoral',
  politico: 'Político no electoral',
};

export const DESCRIPCION_CASO: Record<CasoUso, string> = {
  electoral: 'Un candidato o una campaña en período electoral: pide el voto, informa propuestas, agenda y trámites de la elección.',
  politico: 'Un partido, un dirigente o una bancada fuera de la campaña: informa, recibe consultas y organiza.',
};

export const ETIQUETA_ESTADO_BOT: Record<EstadoBot, string> = {
  borrador: 'Borrador',
  publicado: 'Publicado',
  pausado: 'Pausado',
  archivado: 'Archivado',
};

export const ETIQUETA_TRATO: Record<Trato, string> = {
  usted: 'Usted',
  tu: 'Tú',
};

/** El aviso de IA del primer mensaje cuando el bot no tiene uno propio. */
export const AVISO_IA_POR_DEFECTO = 'Soy un asistente virtual con inteligencia artificial. Puedo equivocarme: para temas importantes, te derivo con una persona del equipo.';
