import type { DatosNucleo } from './accesos';

/**
 * Personas, organización, campaña y accesos de prueba. Sirven para entrar con distintos roles y ver qué cambia.
 *
 * Copia de BotMaker: en CampaignSuite la demo trae AI Positioning; acá trae BotMaker, con una persona por rol. Es la
 * otra diferencia con la plataforma de CampaignSuite (ver catalogo.ts). El día de la mudanza, las personas y los
 * accesos de BotMaker se suman a la demo de CampaignSuite.
 *
 * Joaquín es Dueño: administra la campaña y es Administrador de BotMaker sin fila (cascada, D-081). Los demás son
 * Miembros de la organización e Integrantes de la campaña, con un rol en BotMaker; Mariana está en la campaña sin
 * acceso a BotMaker.
 */
export const NUCLEO_DEMO: DatosNucleo = {
  personas: [
    { id: 'p-joaquin', nombre: 'Joaquín Vázquez', email: 'joaquin@ejemplo.org', iniciales: 'JV' },
    { id: 'p-lucia', nombre: 'Lucía Pérez', email: 'lucia@ejemplo.org', iniciales: 'LP' },
    { id: 'p-andres', nombre: 'Andrés Castillo', email: 'andres@ejemplo.org', iniciales: 'AC' },
    { id: 'p-equipo', nombre: 'Equipo del candidato', email: 'equipo@ejemplo.org', iniciales: 'EC' },
    { id: 'p-mariana', nombre: 'Mariana Díaz', email: 'mariana@ejemplo.org', iniciales: 'MD' },
  ],
  organizaciones: [
    { id: 'org-moca', slug: 'otro-camino', nombre: 'Movimiento Otro Camino', tipo: 'partido', paisIso: 'PA' },
  ],
  miembros: [
    { organizacionId: 'org-moca', personaId: 'p-joaquin', rol: 'dueno' },
    { organizacionId: 'org-moca', personaId: 'p-lucia', rol: 'miembro' },
    { organizacionId: 'org-moca', personaId: 'p-andres', rol: 'miembro' },
    { organizacionId: 'org-moca', personaId: 'p-equipo', rol: 'miembro' },
    { organizacionId: 'org-moca', personaId: 'p-mariana', rol: 'miembro' },
  ],
  contratados: [
    { organizacionId: 'org-moca', productoId: 'botmaker', estado: 'activo' },
  ],
  campanas: [
    {
      id: 'c-pa-2029',
      organizacionId: 'org-moca',
      slug: 'pa-2029',
      nombre: 'Generales 2029',
      estado: 'activa',
      ubicacion: {
        paisIso: 'PA', pais: 'Panamá', ciudad: 'Ciudad de Panamá', region: 'Panamá', zonaHoraria: 'America/Panama',
        latitud: 8.9824, longitud: -79.5199, idioma: 'es',
      },
      etapa: 'precampana',
      fechaEleccion: '2029-05-06',
      productos: [{ productoId: 'botmaker', estado: 'activo' }],
    },
  ],
  integrantes: [
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', personaId: 'p-lucia', rol: 'integrante' },
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', personaId: 'p-andres', rol: 'integrante' },
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', personaId: 'p-equipo', rol: 'integrante' },
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', personaId: 'p-mariana', rol: 'integrante' },
  ],
  accesos: [
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', productoId: 'botmaker', personaId: 'p-lucia', rol: 'editor' },
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', productoId: 'botmaker', personaId: 'p-andres', rol: 'agente' },
    { organizacionId: 'org-moca', campanaId: 'c-pa-2029', productoId: 'botmaker', personaId: 'p-equipo', rol: 'lector' },
  ],
};
