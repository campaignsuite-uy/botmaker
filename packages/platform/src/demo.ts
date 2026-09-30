import type { DatosNucleo } from './accesos';

/**
 * Personas, organización, campaña y accesos de prueba. Sirven para entrar con distintos roles y ver qué cambia.
 *
 * Copia de BotMaker: en CampaignSuite la demo trae AI Positioning; acá trae BotMaker, con una persona por rol. Es la
 * otra diferencia con la plataforma de CampaignSuite (ver catalogo.ts). El día de la mudanza, las personas y los
 * accesos de BotMaker se suman a la demo de CampaignSuite.
 *
 * La organización es de pruebas de CampaignSuite («CampaignSuite · Pruebas», campaña «Panamá · Pruebas»): ningún
 * nombre de cliente (decidido el 30/9/2026; antes se llamaba como el primer cliente). Para la mudanza: si la demo de
 * CampaignSuite usa el nombre de un cliente, conviene cambiarlo allá también.
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
    { id: 'org-pruebas', slug: 'pruebas', nombre: 'CampaignSuite · Pruebas', tipo: 'agencia', paisIso: 'PA' },
  ],
  miembros: [
    { organizacionId: 'org-pruebas', personaId: 'p-joaquin', rol: 'dueno' },
    { organizacionId: 'org-pruebas', personaId: 'p-lucia', rol: 'miembro' },
    { organizacionId: 'org-pruebas', personaId: 'p-andres', rol: 'miembro' },
    { organizacionId: 'org-pruebas', personaId: 'p-equipo', rol: 'miembro' },
    { organizacionId: 'org-pruebas', personaId: 'p-mariana', rol: 'miembro' },
  ],
  contratados: [
    { organizacionId: 'org-pruebas', productoId: 'botmaker', estado: 'activo' },
  ],
  campanas: [
    {
      id: 'c-pa-pruebas',
      organizacionId: 'org-pruebas',
      slug: 'pa-pruebas',
      nombre: 'Panamá · Pruebas',
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
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', personaId: 'p-lucia', rol: 'integrante' },
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', personaId: 'p-andres', rol: 'integrante' },
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', personaId: 'p-equipo', rol: 'integrante' },
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', personaId: 'p-mariana', rol: 'integrante' },
  ],
  accesos: [
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', productoId: 'botmaker', personaId: 'p-lucia', rol: 'editor' },
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', productoId: 'botmaker', personaId: 'p-andres', rol: 'agente' },
    { organizacionId: 'org-pruebas', campanaId: 'c-pa-pruebas', productoId: 'botmaker', personaId: 'p-equipo', rol: 'lector' },
  ],
};
