/**
 * Equipo y roles: quién de la campaña entra a BotMaker y con qué rol, y qué puede cada rol (la matriz). El rol lo da el
 * administrador de BotMaker ('gestionar_equipo'); quien administra la campaña o la organización es administrador en
 * cascada y su rol no se cambia acá. Para sumar a alguien a la campaña se usa el equipo de la campaña de CampaignSuite.
 */
import { invitacionesDeCampana, puedeAdministrarOrganizacion, rolCampana } from '@campaignsuite/platform';
import { ACCIONES, DESCRIPCION_ROL, ETIQUETA_ACCION, ETIQUETA_ROL, MATRIZ, ORDEN_ROLES, puede } from '../dominio/permisos';
import { PRODUCTO, type RolModulo } from '../dominio/tipos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { mensajeDe, type MensajePantalla } from './mensajes';

export interface FilaEquipo {
  personaId: string;
  nombre: string;
  email: string;
  esVos: boolean;
  enCampana: string;
  rol: RolModulo | null;
  rolTexto: string;
  /** Administrador en cascada: su rol no se cambia acá. */
  fijo: boolean;
}

export interface VistaEquipo {
  mensaje: MensajePantalla | null;
  puedeEditar: boolean;
  campanaId: string;
  volver: string;
  filas: FilaEquipo[];
  pendientes: { email: string; rolTexto: string }[];
  opcionesRol: { valor: string; texto: string }[];
  roles: { rol: RolModulo; texto: string; descripcion: string }[];
  matriz: { accion: string; texto: string; roles: Record<RolModulo, boolean> }[];
  equipoCampana: string | null;
  nota: string;
}

export function vistaEquipo(ctx: ContextoPantalla): VistaEquipo {
  const n = ctx.nucleo;
  const c = ctx.campana;
  let filas: FilaEquipo[] = [];
  let pendientes: VistaEquipo['pendientes'] = [];
  if (n) {
    const activos = n.miembros.filter((m) => m.organizacionId === c.organizacionId && (m.estado ?? 'activo') === 'activo');
    filas = activos.flatMap((m): FilaEquipo[] => {
      const rc = rolCampana(n, m.personaId, c.id);
      if (rc !== 'administrador' && rc !== 'integrante') return [];
      const persona = n.personas.find((p) => p.id === m.personaId);
      const porOrg = puedeAdministrarOrganizacion(m.rol);
      const acceso = n.accesos.find((a) => a.campanaId === c.id && a.productoId === PRODUCTO && a.personaId === m.personaId);
      const rol = rc === 'administrador' ? 'administrador' : ((acceso?.rol as RolModulo | undefined) ?? null);
      return [{
        personaId: m.personaId,
        nombre: persona?.nombre ?? m.personaId,
        email: persona?.email ?? '',
        esVos: m.personaId === ctx.persona.id,
        enCampana: porOrg ? 'Administra la organización' : rc === 'administrador' ? 'Administrador de la campaña' : 'Integrante',
        rol,
        rolTexto: rc === 'administrador' ? `Administrador, por administrar la ${porOrg ? 'organización' : 'campaña'}` : rol ? ETIQUETA_ROL[rol] : 'Sin acceso',
        fijo: rc === 'administrador',
      }];
    });
    pendientes = invitacionesDeCampana(n, c.id).flatMap((i) => {
      const a = i.asignaciones.find((x) => x.campanaId === c.id);
      if (!a) return [];
      const p = a.productos.find((x) => x.productoId === PRODUCTO);
      const rol = a.rolCampana === 'administrador' ? 'administrador' : (p?.rol as RolModulo | null) ?? null;
      return [{ email: i.email, rolTexto: rol ? ETIQUETA_ROL[rol] : 'Sin acceso' }];
    });
  }
  filas.sort((a, b) => Number(b.fijo) - Number(a.fijo) || Number(!!b.rol) - Number(!!a.rol) || a.nombre.localeCompare(b.nombre));
  return {
    mensaje: mensajeDe(ctx.parametros),
    puedeEditar: puede(ctx.rol, 'gestionar_equipo') && !ctx.organizacion.demo,
    campanaId: c.id,
    volver: ruta(ctx, 'equipo'),
    filas,
    pendientes,
    opcionesRol: [{ valor: '', texto: 'Sin acceso' }, ...ORDEN_ROLES.map((r) => ({ valor: r, texto: ETIQUETA_ROL[r] }))],
    roles: ORDEN_ROLES.map((r) => ({ rol: r, texto: ETIQUETA_ROL[r], descripcion: DESCRIPCION_ROL[r] })),
    matriz: ACCIONES.map((a) => ({
      accion: a,
      texto: ETIQUETA_ACCION[a],
      roles: Object.fromEntries(ORDEN_ROLES.map((r) => [r, MATRIZ[a].includes(r)])) as Record<RolModulo, boolean>,
    })),
    equipoCampana: ctx.plataforma.configuracion,
    nota: 'Una fila por persona de la campaña. Quien administra la campaña (o la organización) es administrador de BotMaker sin asignación. A los demás, el administrador de BotMaker les da un rol o los deja sin acceso. Para sumar a alguien, primero tiene que estar en la campaña.',
  };
}
