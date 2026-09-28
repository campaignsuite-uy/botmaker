import type { Producto } from './tipos';

/**
 * Catálogo de productos de CampaignSuite. Los nombres salen de las capas del "Stack tecnológico de campaña".
 * Sumar un producto = sumar una entrada acá y su paquete, con sus roles (el primero, 'administrador': arma el equipo del
 * producto en cada campaña) y la pantalla de su Equipo (rutaEquipo).
 *
 * Copia de BotMaker: igual a CampaignSuite (ef6a364) más la entrada `botmaker`, que es la única diferencia de este
 * archivo. El día de la mudanza, esa entrada pasa al catálogo de CampaignSuite.
 */
export const PRODUCTOS: readonly Producto[] = [
  {
    id: 'ai_positioning',
    nombre: 'AI Positioning',
    descripcion: 'Cómo aparece el candidato cuando un votante le pregunta a ChatGPT, Gemini, Google, Meta y Claude.',
    capa: 'Conversación pública',
    roles: ['administrador', 'editor', 'revisor', 'lector'],
    ruta: 'ai-positioning',
    rutaEquipo: 'configuracion?seccion=equipo',
  },
  {
    id: 'botmaker',
    nombre: 'BotMaker',
    descripcion: 'Asistentes conversacionales de la campaña para responder a los ciudadanos en la web y en WhatsApp.',
    capa: 'Mensajería',
    roles: ['administrador', 'editor', 'agente', 'lector'],
    ruta: 'bots',
    rutaEquipo: 'equipo',
  },
  { id: 'voter_file', nombre: 'Voter file y CRM electoral', descripcion: 'Padrón, contactabilidad y segmentos de votantes.', capa: 'Datos', roles: ['administrador', 'editor', 'lector'], ruta: null },
  { id: 'territorio', nombre: 'Territorio y militancia', descripcion: 'Voluntarios, recorridos y tareas en el territorio.', capa: 'Campo', roles: ['administrador', 'editor', 'lector'], ruta: null },
  { id: 'whatsapp', nombre: 'WhatsApp electoral', descripcion: 'Difusión y conversaciones con votantes, con consentimiento.', capa: 'Mensajería', roles: ['administrador', 'editor', 'lector'], ruta: null },
  { id: 'listening', nombre: 'Social listening y narrativa', descripcion: 'Menciones, sentimiento y agenda en redes.', capa: 'Conversación pública', roles: ['administrador', 'editor', 'lector'], ruta: null },
  { id: 'encuestas', nombre: 'Encuestas y opinión pública', descripcion: 'Paneles, tracking e intención de voto.', capa: 'Opinión', roles: ['administrador', 'editor', 'lector'], ruta: null },
  { id: 'fiscalizacion', nombre: 'Mesas y fiscalización', descripcion: 'Fiscales, conteo rápido e incidentes el día de la elección.', capa: 'Día de la elección', roles: ['administrador', 'editor', 'lector'], ruta: null },
];

export function producto(id: string): Producto | undefined {
  return PRODUCTOS.find((p) => p.id === id);
}

/** Direcciones que no puede usar una campaña: son rutas de la organización (/<org>/…). También lo exige la base. */
export const SLUGS_RESERVADOS_CAMPANA = ['nueva', 'organizacion', 'configuracion', 'campanas', 'equipo', 'productos', 'ai-positioning', 'inicio'];

/** Productos que ya existen en la plataforma (con módulo): los únicos que se habilitan en una campaña. */
export function productosConModulo(): readonly Producto[] {
  return PRODUCTOS.filter((p) => p.ruta);
}
