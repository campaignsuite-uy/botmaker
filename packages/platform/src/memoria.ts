/**
 * El núcleo de la demo en memoria (CAMPAIGNSUITE_DATOS=demo) y lo que se cambia en él, con las mismas reglas que la
 * base (0006_acceso.sql, 0008_campana_en_organizacion.sql y 0009_roles_por_nivel.sql). Una copia de NUCLEO_DEMO que vive mientras el servidor
 * está prendido; las invitaciones quedan pendientes (en la demo nadie entra con Google).
 *
 * Sin dependencias del servidor web ni de Supabase: lo usan también el repositorio en memoria de AI Positioning (el
 * rol de cada persona en la campaña sale de acá, D-080) y las pruebas.
 */
import {
  administraCampana, administraProducto, habilitaProductos, puedeAdministrarOrganizacion, rolCampana, rolEnOrganizacion, type DatosNucleo,
} from './accesos';
import { producto as productoDelCatalogo } from './catalogo';
import { NUCLEO_DEMO } from './demo';
import type {
  AsignacionInvitacion, CampanaPlataforma, EtapaCampana, Invitacion, MiembroOrganizacion, RolCampana, RolOrganizacion, UbicacionCampana,
} from './tipos';

/** Error con un código que la pantalla traduce a un mensaje. */
export class ErrorNucleo extends Error {
  constructor(public readonly codigo: string, mensaje?: string) {
    super(mensaje ?? codigo);
  }
}

export const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type { AsignacionInvitacion } from './tipos';

/** Los roles de la campaña (D-081), en el orden en que se muestran. */
export const ROLES_CAMPANA: readonly RolCampana[] = ['administrador', 'integrante'];

/** Lo que cambia el Dueño o el Administrador de la organización desde la pantalla Organización. */
export interface OperacionesOrganizacion {
  invitar(organizacionId: string, email: string, rol: RolOrganizacion, asignaciones: AsignacionInvitacion[]): Promise<void>;
  cancelarInvitacion(invitacionId: string): Promise<void>;
  cambiarRol(organizacionId: string, personaId: string, rol: RolOrganizacion): Promise<void>;
  cambiarEstado(organizacionId: string, personaId: string, estado: 'activo' | 'suspendido'): Promise<void>;
}

/** Datos de la campaña que se cambian desde su Configuración (los que vengan). */
export interface CambiosCampana {
  nombre?: string;
  ubicacion?: UbicacionCampana;
  etapa?: EtapaCampana;
  fechaEleccion?: string | null;
  estado?: 'activa' | 'archivada';
}

/** Una campaña nueva: sus datos, los productos que se habilitan y lo que cada producto necesita (por su id). */
export interface NuevaCampanaPlataforma {
  nombre: string;
  slug: string;
  ubicacion: UbicacionCampana;
  etapa: EtapaCampana;
  fechaEleccion: string | null;
  productos: string[];
  /** Lo de cada producto: `{ ai_positioning: { codigoUbicacionGoogle, propio, motores } }`. */
  porProducto: Record<string, unknown>;
}

export type ResultadoInvitacionCampana = { estado: 'agregada'; personaId: string } | { estado: 'invitada'; invitacionId: string };

/**
 * Lo que cambia quien administra una campaña desde su Configuración (datos, productos y equipo de la campaña, 2.23 y
 * 2.24), el Administrador de cada producto desde el Equipo del producto (el rol de cada integrante, también el de una
 * invitación pendiente) y la creación de campañas (2.2).
 */
export interface OperacionesCampana {
  crearCampana(organizacionId: string, datos: NuevaCampanaPlataforma): Promise<string>;
  guardarCampana(campanaId: string, cambios: CambiosCampana, porProducto?: Record<string, unknown>): Promise<void>;
  /** Solo el Dueño y el Administrador de la organización. `datos`: lo que el producto necesita la primera vez. */
  habilitarProducto(campanaId: string, productoId: string, activo: boolean, datos?: unknown): Promise<void>;
  /** El rol de una persona de la organización en la campaña; null = sacarla de la campaña (quien la administra). */
  asignarRolCampana(campanaId: string, personaId: string, rol: RolCampana | null): Promise<void>;
  /** El rol de un integrante en un producto; null = quitarle el producto (el Administrador de ese producto en la campaña). */
  asignarAcceso(campanaId: string, productoId: string, personaId: string, rol: string | null): Promise<void>;
  /** Invitar a la campaña con el rol en la campaña (quien la administra). */
  invitarACampana(campanaId: string, email: string, rol: RolCampana): Promise<ResultadoInvitacionCampana>;
  /** El rol en un producto de quien tiene una invitación pendiente a la campaña (el Administrador de ese producto en la campaña). */
  asignarEnInvitacion(invitacionId: string, campanaId: string, productoId: string, rol: string | null, panelista: boolean): Promise<void>;
  quitarDeInvitacion(invitacionId: string, campanaId: string): Promise<void>;
}

// ── El núcleo en memoria ────────────────────────────────────────────────────────────────────────

const global_ = globalThis as unknown as { __campaignsuiteNucleo?: DatosNucleo & { invitaciones: Invitacion[] } };

function memoria(): DatosNucleo & { invitaciones: Invitacion[] } {
  return (global_.__campaignsuiteNucleo ??= { ...structuredClone(NUCLEO_DEMO), invitaciones: [] });
}

/** Núcleo de la demo en memoria (lo que ve cualquier persona de prueba). */
export function nucleoMemoria(): DatosNucleo {
  const m = memoria();
  return { ...m, invitaciones: m.invitaciones };
}

/** Vuelve la demo en memoria a la semilla (lo usan las pruebas). */
export function reiniciarNucleoMemoria(): void {
  delete global_.__campaignsuiteNucleo;
}

/** Una campaña de la demo en memoria (la identidad que lee el repositorio en memoria del módulo). */
export function campanaMemoria(campanaId: string): CampanaPlataforma | null {
  return memoria().campanas.find((c) => c.id === campanaId) ?? null;
}

/**
 * Suma asignaciones (como core.sumar_asignaciones): una por campaña; la nueva cambia el rol en la campaña y cada producto
 * que trae, sin perder los demás.
 */
export function sumarAsignaciones(actuales: AsignacionInvitacion[], nuevas: AsignacionInvitacion[]): AsignacionInvitacion[] {
  const salida = actuales.map((a) => ({ ...a, productos: [...a.productos] }));
  for (const n of nuevas) {
    const ya = salida.find((a) => a.campanaId === n.campanaId);
    if (!ya) {
      salida.push({ ...n, productos: [...n.productos] });
      continue;
    }
    ya.rolCampana = n.rolCampana;
    for (const p of n.productos) ya.productos = [...ya.productos.filter((x) => x.productoId !== p.productoId), p];
  }
  return salida;
}

/** Organización: mismas reglas que la base (0001_core.sql, 0006_acceso.sql y 0008), para la demo en memoria. */
export function operacionesMemoria(personaId: string): OperacionesOrganizacion {
  const d = memoria();
  const miRol = (org: string) => rolEnOrganizacion(d, personaId, org);
  const exigirAdmin = (org: string) => {
    if (!puedeAdministrarOrganizacion(miRol(org))) throw new ErrorNucleo('sin_permiso');
  };
  const miembro = (org: string, persona: string) => d.miembros.find((m) => m.organizacionId === org && m.personaId === persona);
  const puedeTocar = (org: string, objetivo: MiembroOrganizacion | undefined, rolNuevo?: RolOrganizacion) => {
    if (miRol(org) === 'dueno') return;
    if (objetivo?.rol === 'dueno' || rolNuevo === 'dueno') throw new ErrorNucleo('dueno');
  };
  const quedaDueno = (org: string, sin: string) => d.miembros.some((m) => m.organizacionId === org && m.rol === 'dueno' && (m.estado ?? 'activo') === 'activo' && m.personaId !== sin);
  return {
    async invitar(org, email, rol, asignaciones) {
      exigirAdmin(org);
      const mail = email.trim().toLowerCase();
      if (!CORREO.test(mail)) throw new ErrorNucleo('correo');
      puedeTocar(org, undefined, rol);
      const ya = d.personas.find((p) => p.email.toLowerCase() === mail);
      if (ya && (miembro(org, ya.id)?.estado ?? (miembro(org, ya.id) ? 'activo' : null)) === 'activo') throw new ErrorNucleo('ya_es_miembro');
      const pendiente = d.invitaciones.find((i) => i.organizacionId === org && i.email === mail);
      if (pendiente) {
        pendiente.rol = rol;
        pendiente.asignaciones = sumarAsignaciones(pendiente.asignaciones, asignaciones);
        return;
      }
      d.invitaciones.push({ id: `inv-${Date.now().toString(36)}-${d.invitaciones.length}`, organizacionId: org, email: mail, rol, asignaciones, invitadaPor: personaId, fecha: new Date().toISOString() });
    },
    async cancelarInvitacion(id) {
      const inv = d.invitaciones.find((i) => i.id === id);
      if (!inv) throw new ErrorNucleo('invitacion');
      exigirAdmin(inv.organizacionId);
      d.invitaciones = d.invitaciones.filter((i) => i.id !== id);
    },
    async cambiarRol(org, persona, rol) {
      exigirAdmin(org);
      const m = miembro(org, persona);
      if (!m) throw new ErrorNucleo('persona');
      puedeTocar(org, m, rol);
      if (m.rol === 'dueno' && rol !== 'dueno' && !quedaDueno(org, persona)) throw new ErrorNucleo('ultimo_dueno');
      m.rol = rol;
    },
    async cambiarEstado(org, persona, estado) {
      exigirAdmin(org);
      const m = miembro(org, persona);
      if (!m) throw new ErrorNucleo('persona');
      if (persona === personaId) throw new ErrorNucleo('vos');
      puedeTocar(org, m);
      if (m.rol === 'dueno' && estado !== 'activo' && !quedaDueno(org, persona)) throw new ErrorNucleo('ultimo_dueno');
      m.estado = estado;
    },
  };
}

/** Campaña: mismas reglas que la base (0008 y 0009_roles_por_nivel.sql), para la demo en memoria. */
export function operacionesCampanaMemoria(personaId: string): OperacionesCampana {
  const d = memoria();
  const campanaDe = (id: string) => {
    const c = d.campanas.find((x) => x.id === id);
    if (!c) throw new ErrorNucleo('campana');
    if (d.organizaciones.find((o) => o.id === c.organizacionId)?.demo) throw new ErrorNucleo('demo');
    return c;
  };
  const exigirAdministrar = (c: CampanaPlataforma) => {
    if (!administraCampana(d, personaId, c.id)) throw new ErrorNucleo('sin_permiso');
  };
  const exigirProducto = (c: CampanaPlataforma, productoId: string) => {
    if (!administraProducto(d, personaId, c.id, productoId)) throw new ErrorNucleo('sin_permiso');
  };
  const validarRol = (c: CampanaPlataforma, productoId: string, rol: string) => {
    if (!c.productos.some((p) => p.productoId === productoId)) throw new ErrorNucleo('producto');
    if (!productoDelCatalogo(productoId)?.roles.includes(rol)) throw new ErrorNucleo('rol');
  };
  const rolCampanaEn = (c: CampanaPlataforma, persona: string, rol: RolCampana | null) => {
    const rolOrg = rolEnOrganizacion(d, persona, c.organizacionId);
    if (!rolOrg) throw new ErrorNucleo('persona');
    if (puedeAdministrarOrganizacion(rolOrg)) throw new ErrorNucleo('admin_org');
    d.integrantes = d.integrantes.filter((i) => !(i.campanaId === c.id && i.personaId === persona));
    if (rol === null) {
      // Sacarla de la campaña se lleva sus productos (en la base, también su función panelista).
      d.accesos = d.accesos.filter((a) => !(a.campanaId === c.id && a.personaId === persona));
      return;
    }
    if (!ROLES_CAMPANA.includes(rol)) throw new ErrorNucleo('rol_campana');
    d.integrantes.push({ organizacionId: c.organizacionId, campanaId: c.id, personaId: persona, rol });
  };
  return {
    async crearCampana() {
      throw new ErrorNucleo('memoria');
    },
    async guardarCampana(campanaId, cambios) {
      const c = campanaDe(campanaId);
      exigirAdministrar(c);
      if (cambios.nombre !== undefined && cambios.nombre.trim()) c.nombre = cambios.nombre.trim();
      if (cambios.ubicacion) c.ubicacion = { ...cambios.ubicacion };
      if (cambios.etapa) c.etapa = cambios.etapa;
      if (cambios.fechaEleccion !== undefined) c.fechaEleccion = cambios.fechaEleccion;
      if (cambios.estado) c.estado = cambios.estado;
    },
    async habilitarProducto(campanaId, productoId, activo) {
      const c = campanaDe(campanaId);
      if (!habilitaProductos(d, personaId, c.organizacionId)) throw new ErrorNucleo('sin_permiso');
      const ya = c.productos.find((p) => p.productoId === productoId);
      if (ya) {
        ya.estado = activo ? 'activo' : 'suspendido';
        return;
      }
      if (!activo) return;
      // Un producto nuevo en la campaña se prepara con sus datos: la demo en memoria no lo hace.
      throw new ErrorNucleo('memoria');
    },
    async asignarRolCampana(campanaId, persona, rol) {
      const c = campanaDe(campanaId);
      exigirAdministrar(c);
      rolCampanaEn(c, persona, rol);
    },
    async asignarAcceso(campanaId, productoId, persona, rol) {
      const c = campanaDe(campanaId);
      exigirProducto(c, productoId);
      if (!c.productos.some((p) => p.productoId === productoId)) throw new ErrorNucleo('producto');
      const rc = rolCampana(d, persona, c.id);
      if (!rc || rc === 'observador') throw new ErrorNucleo('no_integrante');
      if (rc === 'administrador') throw new ErrorNucleo('admin_campana');
      d.accesos = d.accesos.filter((a) => !(a.campanaId === c.id && a.productoId === productoId && a.personaId === persona));
      if (rol === null) return;
      validarRol(c, productoId, rol);
      d.accesos.push({ organizacionId: c.organizacionId, campanaId: c.id, productoId, personaId: persona, rol });
    },
    async invitarACampana(campanaId, email, rol) {
      const c = campanaDe(campanaId);
      exigirAdministrar(c);
      const mail = email.trim().toLowerCase();
      if (!CORREO.test(mail)) throw new ErrorNucleo('correo');
      if (!ROLES_CAMPANA.includes(rol)) throw new ErrorNucleo('rol_campana');
      const persona = d.personas.find((p) => p.email.toLowerCase() === mail);
      const m = persona ? d.miembros.find((x) => x.organizacionId === c.organizacionId && x.personaId === persona.id) : undefined;
      if (persona && m && (m.estado ?? 'activo') === 'suspendido') throw new ErrorNucleo('persona_suspendida');
      if (persona && m) {
        rolCampanaEn(c, persona.id, rol);
        return { estado: 'agregada', personaId: persona.id };
      }
      const asignacion: AsignacionInvitacion = { campanaId: c.id, rolCampana: rol, productos: [] };
      const pendiente = d.invitaciones.find((i) => i.organizacionId === c.organizacionId && i.email === mail);
      if (pendiente) {
        pendiente.asignaciones = sumarAsignaciones(pendiente.asignaciones, [asignacion]);
        return { estado: 'invitada', invitacionId: pendiente.id };
      }
      const id = `inv-${Date.now().toString(36)}-${d.invitaciones.length}`;
      d.invitaciones.push({ id, organizacionId: c.organizacionId, email: mail, rol: 'miembro', asignaciones: [asignacion], invitadaPor: personaId, fecha: new Date().toISOString() });
      return { estado: 'invitada', invitacionId: id };
    },
    async asignarEnInvitacion(invitacionId, campanaId, productoId, rol, panelista) {
      const c = campanaDe(campanaId);
      exigirProducto(c, productoId);
      const inv = d.invitaciones.find((i) => i.id === invitacionId);
      const a = inv?.asignaciones.find((x) => x.campanaId === campanaId);
      if (!inv || !a) throw new ErrorNucleo('invitacion');
      if (!c.productos.some((p) => p.productoId === productoId)) throw new ErrorNucleo('producto');
      if (panelista && productoId !== 'ai_positioning') throw new ErrorNucleo('rol');
      let r = rol;
      if (a.rolCampana === 'administrador') {
        if (r && r !== 'administrador') throw new ErrorNucleo('admin_campana');
        r = null;
      } else {
        if (!r && panelista) throw new ErrorNucleo('panelista_sin_rol');
        if (r) validarRol(c, productoId, r);
      }
      a.productos = a.productos.filter((p) => p.productoId !== productoId);
      if (r || panelista) a.productos.push({ productoId, rol: r, panelista });
    },
    async quitarDeInvitacion(invitacionId, campanaId) {
      const c = campanaDe(campanaId);
      exigirAdministrar(c);
      const inv = d.invitaciones.find((i) => i.id === invitacionId);
      if (!inv) throw new ErrorNucleo('invitacion');
      inv.asignaciones = inv.asignaciones.filter((a) => a.campanaId !== campanaId);
      if (!inv.asignaciones.length && inv.rol === 'miembro') d.invitaciones = d.invitaciones.filter((i) => i.id !== invitacionId);
    },
  };
}
