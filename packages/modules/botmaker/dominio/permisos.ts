import type { RolEfectivo, RolModulo } from './tipos';

/**
 * Qué puede hacer cada rol de BotMaker en una campaña: la matriz de la definición de producto (Usuarios, roles y
 * permisos), fila por fila. Se aplica en tres capas:
 *  1. la pantalla (vistas/) esconde lo que no corresponde;
 *  2. el servidor (acciones/) lo exige con `exigir` antes de tocar el repositorio;
 *  3. la base lo vuelve a exigir: bots.matriz_permisos() es esta misma tabla (packages/db/migraciones/bots_0001_base.sql)
 *     y `pnpm db:probar` controla que coincidan.
 *
 * En cascada (D-081 de CampaignSuite): el Dueño y el Administrador de la organización, y el Administrador de la
 * campaña, son administradores de BotMaker sin asignación. En una organización demo, quien entra es "observador":
 * ve todo lo que ve un administrador y no cambia nada.
 */
export const ACCIONES = [
  'ver',
  'editar_borrador',
  'correr_pruebas',
  'pedir_publicacion',
  'publicar',
  'configurar_canales',
  'elegir_motores',
  'leer_conversaciones',
  'responder_conversaciones',
  'gestionar_datos_contactos',
  'ver_costos',
  'gestionar_equipo',
] as const;
export type Accion = (typeof ACCIONES)[number];

export const MATRIZ: Record<Accion, RolEfectivo[]> = {
  ver: ['administrador', 'editor', 'agente', 'lector', 'observador'],
  editar_borrador: ['administrador', 'editor'],
  correr_pruebas: ['administrador', 'editor'],
  pedir_publicacion: ['administrador', 'editor'],
  publicar: ['administrador'],
  configurar_canales: ['administrador'],
  elegir_motores: ['administrador'],
  leer_conversaciones: ['administrador', 'editor', 'agente', 'observador'],
  responder_conversaciones: ['administrador', 'agente'],
  gestionar_datos_contactos: ['administrador'],
  ver_costos: ['administrador', 'observador'],
  gestionar_equipo: ['administrador'],
};

/** Texto de cada acción, tal como figura en la matriz de la definición. */
export const ETIQUETA_ACCION: Record<Accion, string> = {
  ver: 'Ver bots, flujos, contenidos y métricas',
  editar_borrador: 'Crear bots, editar el borrador y usar el copiloto y el simulador',
  correr_pruebas: 'Correr pruebas',
  pedir_publicacion: 'Pedir la publicación de una versión',
  publicar: 'Aprobar y publicar, pausar, volver a una versión anterior o archivar un bot',
  configurar_canales: 'Configurar canales y claves (sin volver a verlas)',
  elegir_motores: 'Elegir el motor de cada función del bot y los topes de gasto',
  leer_conversaciones: 'Leer conversaciones',
  responder_conversaciones: 'Responder conversaciones derivadas',
  gestionar_datos_contactos: 'Buscar, exportar o borrar los datos de un contacto; personalización y días de guardado',
  ver_costos: 'Ver costos',
  gestionar_equipo: 'Armar el equipo de BotMaker en la campaña',
};

export const ETIQUETA_ROL: Record<RolEfectivo, string> = {
  administrador: 'Administrador',
  editor: 'Editor',
  agente: 'Agente',
  lector: 'Lector',
  observador: 'Observador de la demo',
};

export const DESCRIPCION_ROL: Record<RolEfectivo, string> = {
  administrador: 'Todo: aprueba y publica, configura canales, elige motores y topes, arma el equipo, ve costos y atiende pedidos sobre datos personales.',
  editor: 'Arma y cambia bots, usa el copiloto y el simulador, corre pruebas y pide publicar.',
  agente: 'Atiende las conversaciones derivadas.',
  lector: 'Ve bots y métricas.',
  observador: 'Demo: ve todo como un administrador, incluidos los costos, pero no cambia nada.',
};

export const ORDEN_ROLES: readonly RolModulo[] = ['administrador', 'editor', 'agente', 'lector'];

export function puede(rol: RolEfectivo | null | undefined, accion: Accion): boolean {
  return !!rol && MATRIZ[accion].includes(rol);
}

export function accionesDe(rol: RolEfectivo): Accion[] {
  return ACCIONES.filter((a) => MATRIZ[a].includes(rol));
}

export class SinPermiso extends Error {
  constructor(readonly accion: Accion) {
    super(`Tu rol no permite esta acción (${ETIQUETA_ACCION[accion]}).`);
  }
}

export function exigir(rol: RolEfectivo | null | undefined, accion: Accion): void {
  if (!puede(rol, accion)) throw new SinPermiso(accion);
}

/** Acciones que no cambian nada: las únicas que pasan en la demo online de solo lectura. */
export const ACCIONES_DE_LECTURA: readonly Accion[] = ['ver', 'leer_conversaciones', 'ver_costos'];

export function esDeLectura(accion: Accion): boolean {
  return ACCIONES_DE_LECTURA.includes(accion);
}

export class SoloLectura extends Error {
  constructor() {
    super('Demo online de solo lectura: no se guarda ningún cambio.');
  }
}
