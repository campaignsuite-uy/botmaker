import { PRODUCTOS } from './catalogo';
import type {
  AccesoCampana, CampanaPlataforma, IntegranteCampana, Invitacion, MiembroOrganizacion, Organizacion, Persona, Producto, ProductoContratado,
  RolCampana, RolOrganizacion,
} from './tipos';

/**
 * Fuente de datos del núcleo. En demo es memoria; en producción, el esquema `core` de Supabase, visto con la
 * sesión de la persona (lo que las reglas por fila le dejan ver).
 */
export interface DatosNucleo {
  personas: Persona[];
  organizaciones: Organizacion[];
  miembros: MiembroOrganizacion[];
  contratados: ProductoContratado[];
  /** Campañas de las organizaciones que ve la persona (las que le dejan ver las reglas por fila, D-080). */
  campanas: CampanaPlataforma[];
  /** Quién está en cada campaña y con qué rol en ella (D-081): el equipo de las campañas a las que entra la persona. */
  integrantes: IntegranteCampana[];
  /**
   * Rol de cada integrante en cada producto (persona × campaña × producto): los propios; los de un producto, su
   * Administrador; todos los de la campaña, quien la administra.
   */
  accesos: AccesoCampana[];
  /** Invitaciones pendientes de las organizaciones que administra y de las campañas donde arma un equipo (2.3, 2.24). */
  invitaciones?: Invitacion[];
  /** La persona de la sesión es Administrador de CampaignSuite (2.16): ve la consola y todas las demos. */
  adminProducto?: boolean;
}

const activo = (m: MiembroOrganizacion) => (m.estado ?? 'activo') === 'activo';

/**
 * Organizaciones a las que entra la persona: donde es miembro activo y, si es Administrador de CampaignSuite, todas
 * las demos (rol null: no es miembro, las mira como observador).
 */
export function organizacionesDe(datos: DatosNucleo, personaId: string): { organizacion: Organizacion; rol: RolOrganizacion | null }[] {
  const propias = datos.miembros
    .filter((m) => m.personaId === personaId && activo(m))
    .map((m) => ({ organizacion: datos.organizaciones.find((o) => o.id === m.organizacionId)!, rol: m.rol as RolOrganizacion | null }))
    .filter((x) => x.organizacion);
  const demos = datos.adminProducto
    ? datos.organizaciones.filter((o) => o.demo && !propias.some((x) => x.organizacion.id === o.id)).map((o) => ({ organizacion: o, rol: null }))
    : [];
  return [...propias, ...demos];
}

export function rolEnOrganizacion(datos: DatosNucleo, personaId: string, organizacionId: string): RolOrganizacion | null {
  return datos.miembros.find((m) => m.personaId === personaId && m.organizacionId === organizacionId && activo(m))?.rol ?? null;
}

/** ¿La persona entra a esta organización? (miembro activo; en una demo, también el Administrador de CampaignSuite). */
export function entraAOrganizacion(datos: DatosNucleo, personaId: string, organizacionId: string): boolean {
  if (rolEnOrganizacion(datos, personaId, organizacionId)) return true;
  return !!datos.adminProducto && !!datos.organizaciones.find((o) => o.id === organizacionId)?.demo;
}

export function puedeAdministrarOrganizacion(rol: RolOrganizacion | null | undefined): boolean {
  return rol === 'dueno' || rol === 'admin';
}

/** ¿El producto está contratado y activo en la organización? */
export function productoContratado(datos: DatosNucleo, organizacionId: string, productoId: string): boolean {
  return datos.contratados.some((c) => c.organizacionId === organizacionId && c.productoId === productoId && c.estado === 'activo');
}

/**
 * Rol de la persona en la campaña (espejo de core.rol_campana_de, 0009_roles_por_nivel.sql): 'administrador' (el Dueño
 * y el Administrador de la organización, por serlo, o el Administrador de la campaña), 'integrante' o null (no está).
 * En una demo lista, quien entra es 'observador' (mientras se carga, nadie).
 */
export function rolCampana(datos: DatosNucleo, personaId: string, campanaId: string): RolCampana | 'observador' | null {
  const campana = datos.campanas.find((c) => c.id === campanaId);
  if (!campana) return null;
  const org = datos.organizaciones.find((o) => o.id === campana.organizacionId);
  if (org?.demo) return org.estadoDemo !== 'cargando' && entraAOrganizacion(datos, personaId, org.id) ? 'observador' : null;
  const rolOrg = rolEnOrganizacion(datos, personaId, campana.organizacionId);
  if (!rolOrg) return null;
  if (puedeAdministrarOrganizacion(rolOrg)) return 'administrador';
  return datos.integrantes.find((i) => i.campanaId === campanaId && i.personaId === personaId)?.rol ?? null;
}

/**
 * Rol de la persona en un producto de una campaña (espejo de core.rol_en_campana, 0009_roles_por_nivel.sql): null si el
 * producto no está contratado y activo en la organización o no está habilitado y activo en la campaña, o si la persona
 * no está en la campaña. En cascada (D-081), quien administra la campaña (o la organización) es "administrador" en
 * todos sus productos; un integrante, el rol de su acceso a ese producto. En una demo, "observador".
 */
export function rolEnCampana(datos: DatosNucleo, personaId: string, campanaId: string, productoId: string): string | null {
  const campana = datos.campanas.find((c) => c.id === campanaId);
  if (!campana) return null;
  if (!productoContratado(datos, campana.organizacionId, productoId)) return null;
  if (!campana.productos.some((p) => p.productoId === productoId && p.estado === 'activo')) return null;
  const rc = rolCampana(datos, personaId, campanaId);
  if (!rc) return null;
  if (rc === 'administrador' || rc === 'observador') return rc;
  return datos.accesos.find((a) => a.personaId === personaId && a.campanaId === campanaId && a.productoId === productoId)?.rol ?? null;
}

/** Productos de la campaña (en el orden del catálogo), con su estado y el rol de la persona en cada uno. */
export function productosDeCampana(datos: DatosNucleo, personaId: string, campanaId: string): { producto: Producto; estado: 'activo' | 'suspendido'; rol: string | null }[] {
  const campana = datos.campanas.find((c) => c.id === campanaId);
  if (!campana) return [];
  return PRODUCTOS.flatMap((producto) => {
    const p = campana.productos.find((x) => x.productoId === producto.id);
    return p ? [{ producto, estado: p.estado, rol: rolEnCampana(datos, personaId, campanaId, producto.id) }] : [];
  });
}

/**
 * Campañas de la organización a las que entra la persona: todas, si es Dueño o Administrador de la organización (o en
 * una demo lista a la que entra); si no, aquellas donde está, tenga o no productos (D-081). Archivadas al final.
 */
export function campanasDe(datos: DatosNucleo, personaId: string, organizacionId: string): CampanaPlataforma[] {
  const org = datos.organizaciones.find((o) => o.id === organizacionId);
  if (!org || !entraAOrganizacion(datos, personaId, organizacionId)) return [];
  return datos.campanas
    .filter((c) => c.organizacionId === organizacionId && rolCampana(datos, personaId, c.id) !== null)
    .sort((a, b) => Number(a.estado === 'archivada') - Number(b.estado === 'archivada') || a.nombre.localeCompare(b.nombre));
}

/** La campaña de la organización con esa dirección, si la persona entra (null si no existe o no entra). */
export function campanaDeRuta(datos: DatosNucleo, personaId: string, organizacionId: string, slug: string): CampanaPlataforma | null {
  return campanasDe(datos, personaId, organizacionId).find((c) => c.slug === slug) ?? null;
}

/**
 * ¿La persona administra la campaña? (espejo de core.administra_campana_de): el Dueño y el Administrador de la
 * organización y el Administrador de la campaña. En una demo, nadie. Cambian sus datos y arman su equipo (D-081).
 */
export function administraCampana(datos: DatosNucleo, personaId: string, campanaId: string): boolean {
  return rolCampana(datos, personaId, campanaId) === 'administrador';
}

/**
 * ¿La persona administra ese producto en la campaña? Su Administrador en la campaña y, en cascada, quien administra la
 * campaña o la organización. Arma el equipo del producto (D-081). En una demo, nadie.
 */
export function administraProducto(datos: DatosNucleo, personaId: string, campanaId: string, productoId: string): boolean {
  return rolEnCampana(datos, personaId, campanaId, productoId) === 'administrador';
}

/** ¿Habilita y suspende productos en las campañas de la organización? El Dueño y el Administrador (no en una demo). */
export function habilitaProductos(datos: DatosNucleo, personaId: string, organizacionId: string): boolean {
  if (datos.organizaciones.find((o) => o.id === organizacionId)?.demo) return false;
  return puedeAdministrarOrganizacion(rolEnOrganizacion(datos, personaId, organizacionId));
}

/** Integrantes de la campaña (con fila: el Dueño y el Administrador de la organización no la tienen). */
export function integrantesDe(datos: DatosNucleo, campanaId: string): IntegranteCampana[] {
  return datos.integrantes.filter((i) => i.campanaId === campanaId);
}

/** Invitaciones pendientes de una organización (2.3). */
export function invitacionesDe(datos: DatosNucleo, organizacionId: string): Invitacion[] {
  return (datos.invitaciones ?? []).filter((i) => i.organizacionId === organizacionId);
}

/** Invitaciones pendientes que incluyen la campaña (2.23). */
export function invitacionesDeCampana(datos: DatosNucleo, campanaId: string): Invitacion[] {
  return (datos.invitaciones ?? []).filter((i) => i.asignaciones.some((a) => a.campanaId === campanaId));
}
