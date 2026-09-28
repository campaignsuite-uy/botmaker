/**
 * Núcleo de CampaignSuite: quién es la persona, a qué organización pertenece, qué campañas tiene la organización y a
 * qué productos entra en cada una. Espejo de las tablas del esquema `core` (packages/db/migraciones/0001_core.sql,
 * 0008_campana_en_organizacion.sql y 0009_roles_por_nivel.sql). Ver docs/decisiones.md (D-003: permisos en dos niveles;
 * D-080: la campaña es de la organización; D-081: un rol en cada nivel, organización ⊇ campaña ⊇ producto).
 */

export type RolOrganizacion = 'dueno' | 'admin' | 'miembro';

export interface Persona {
  id: string;
  nombre: string;
  email: string;
  iniciales: string;
}

export interface Organizacion {
  id: string;
  slug: string;
  nombre: string;
  tipo: 'agencia' | 'partido' | 'campana';
  paisIso: string;
  /**
   * Organización demo (entrega 2, 2.15 y 2.16): sin relación con ningún cliente, solo para mirar. Quien tiene
   * acceso entra a todas sus campañas como "observador". La crea el Administrador de CampaignSuite.
   */
  demo?: boolean;
  /** Demo: 'cargando' mientras se copian sus datos (nadie entra) o 'lista'. */
  estadoDemo?: 'cargando' | 'lista' | null;
  /** Demo: de dónde salió ("versión …" o "copia de …"). */
  origenDemo?: string | null;
}

/**
 * Rol en la campaña (D-081): el Administrador de la campaña cambia sus datos y arma su equipo, y es Administrador en
 * todos sus productos; el Integrante entra y ve los productos donde tiene rol.
 */
export type RolCampana = 'administrador' | 'integrante';

/**
 * Lo que una invitación da en una campaña al aceptarla (una por campaña): el rol en la campaña y, en cada producto, el
 * rol que le dejó el Administrador de ese producto en la campaña mientras estaba pendiente (y la función panelista de AI Positioning).
 */
export interface AsignacionInvitacion {
  campanaId: string;
  rolCampana: RolCampana;
  productos: { productoId: string; rol: string | null; panelista: boolean }[];
}

/** Invitación a una organización por correo de Google (2.3). Pendiente hasta que la persona entra con ese correo. */
export interface Invitacion {
  id: string;
  organizacionId: string;
  email: string;
  rol: RolOrganizacion;
  /** Campañas a las que entra al aceptar (2.24). */
  asignaciones: AsignacionInvitacion[];
  invitadaPor: string | null;
  fecha: string;
}

export interface MiembroOrganizacion {
  organizacionId: string;
  personaId: string;
  rol: RolOrganizacion;
  /** Por defecto 'activo'. Una persona desactivada no entra a la organización (2.3). */
  estado?: 'activo' | 'suspendido';
}

/** Un producto del catálogo de CampaignSuite. Cada producto define sus propios roles. */
export interface Producto {
  id: string;
  nombre: string;
  descripcion: string;
  capa: string;
  /** Roles del producto en una campaña; el primero es 'administrador', que arma el equipo del producto (D-081). */
  roles: readonly string[];
  /** Ruta de entrada relativa a la campaña (/<org>/<campaña>/<ruta>); null si el producto todavía no existe en la plataforma. */
  ruta: string | null;
  /** El Equipo del producto (rol y funciones de cada integrante), relativo a su ruta. */
  rutaEquipo?: string;
}

export interface ProductoContratado {
  organizacionId: string;
  productoId: string;
  estado: 'activo' | 'suspendido';
}

/** Etapa de la campaña. En AI Positioning cambia qué se carga en las fichas. */
export const ETAPAS_CAMPANA = ['gestion_permanente', 'precampana', 'campana', 'en_cargo'] as const;
export type EtapaCampana = (typeof ETAPAS_CAMPANA)[number];

export const ETIQUETA_ETAPA: Record<EtapaCampana, string> = {
  gestion_permanente: 'Gestión permanente',
  precampana: 'Precampaña',
  campana: 'Campaña',
  en_cargo: 'En el cargo',
};

/** Desde dónde se mide la campaña. Cada producto la usa a su manera (AI Positioning suma el código de Google). */
export interface UbicacionCampana {
  paisIso: string;
  pais: string;
  ciudad: string;
  region: string;
  zonaHoraria: string;
  latitud: number;
  longitud: number;
  idioma: string;
}

/** Un producto habilitado en una campaña. Suspendido: nadie entra a ese producto en la campaña (sus datos quedan). */
export interface ProductoDeCampana {
  productoId: string;
  estado: 'activo' | 'suspendido';
}

/**
 * Una campaña de la organización (core.campaigns, entrega 2, 2.22). Es de la organización, no de un producto: cada
 * producto se habilita en ella y guarda lo suyo en su esquema.
 */
export interface CampanaPlataforma {
  id: string;
  organizacionId: string;
  /** Dirección: /<organización>/<campaña>. Única en la organización. */
  slug: string;
  nombre: string;
  estado: 'activa' | 'archivada';
  ubicacion: UbicacionCampana;
  etapa: EtapaCampana;
  fechaEleccion: string | null;
  productos: ProductoDeCampana[];
}

/**
 * Quién está en una campaña y con qué rol en ella (core.campaign_members, D-081). El Dueño y el Administrador de la
 * organización no necesitan fila: administran todas las campañas.
 */
export interface IntegranteCampana {
  organizacionId: string;
  campanaId: string;
  personaId: string;
  rol: RolCampana;
}

/**
 * Rol de un integrante de la campaña en uno de sus productos (core.campaign_access): persona × campaña × producto, con
 * un rol del producto. Quien administra la campaña (o la organización) no lo necesita: es Administrador en todos sus
 * productos.
 */
export interface AccesoCampana {
  organizacionId: string;
  campanaId: string;
  productoId: string;
  personaId: string;
  rol: string;
}

export interface EventoActividad {
  personaId: string;
  organizacionId: string;
  productoId: string | null;
  accion: string;
  objeto: string;
  fecha: string;
}
