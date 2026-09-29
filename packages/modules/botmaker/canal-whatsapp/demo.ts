/**
 * Lo que comparten la semilla de la demo y el 360dialog simulado: la clave de prueba del bot publicado de la demo, el
 * secreto de su aviso y las plantillas de su cuenta. No son claves reales: solo existen en la memoria de la demo.
 */
import type { PlantillaMeta } from '../dominio/whatsapp';

export const CLAVE_DEMO = 'demo-clave-de-prueba-sin-valor-real';
export const SECRETO_DEMO = 'secreto-del-aviso-de-la-demo';
export const NUMERO_DEMO = '+507 6000-0101';

/** Plantillas de la cuenta simulada: una aprobada, una en revisión y una con imagen (no se manda desde la bandeja). */
export const PLANTILLAS_DEMO: PlantillaMeta[] = [
  {
    id: 'tpl-demo-1', name: 'retomar_consulta', language: 'es', status: 'APPROVED', category: 'UTILITY', parameter_format: 'positional',
    components: [{ type: 'BODY', text: 'Hola {{1}}, te escribimos de la campaña por tu consulta sobre {{2}}. ¿Querés que sigamos conversando por acá?' }],
  },
  {
    id: 'tpl-demo-2', name: 'novedades_semana', language: 'es', status: 'PENDING', category: 'MARKETING', parameter_format: 'named',
    components: [{ type: 'BODY', text: 'Hola {{nombre}}, esta semana la campaña recorre {{barrio}}. ¿Querés saber más?' }],
  },
  {
    id: 'tpl-demo-3', name: 'foto_recorrida', language: 'es', status: 'APPROVED', category: 'MARKETING',
    components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Así fue la recorrida del sábado. Gracias por acompañar.' }],
  },
];
