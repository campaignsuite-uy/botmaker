/**
 * Piezas comunes de las pantallas de plataforma (inicio de la organización y de la campaña, configuración de la campaña, Organización, consola): quién es la persona,
 * qué núcleo ve y la barra superior. Si falta la sesión, lleva a /ingresar; si la organización no existe o la
 * persona no entra, 404.
 */
import { notFound, redirect } from 'next/navigation';
import {
  entraAOrganizacion, etiquetaDatos, organizacionesDe, rolEnOrganizacion, tituloEtiquetaDatos,
  type DatosNucleo, type Organizacion, type Persona, type RolOrganizacion,
} from '@campaignsuite/platform';
import { nucleoActual, personaActual } from '@campaignsuite/platform/sesion';
import { EtiquetaDatos } from '@campaignsuite/ui';

export interface ContextoOrganizacion {
  persona: Persona;
  nucleo: DatosNucleo;
  organizacion: Organizacion;
  /** Rol en la organización; null si es una demo que mira como Administrador de CampaignSuite. */
  rolOrg: RolOrganizacion | null;
  variasOrganizaciones: boolean;
}

export async function sesionPlataforma(): Promise<{ persona: Persona; nucleo: DatosNucleo }> {
  const persona = await personaActual();
  if (!persona) redirect('/ingresar');
  return { persona, nucleo: await nucleoActual() };
}

export async function contextoOrganizacion(slug: string): Promise<ContextoOrganizacion> {
  const { persona, nucleo } = await sesionPlataforma();
  const organizacion = nucleo.organizaciones.find((o) => o.slug === slug);
  if (!organizacion || !entraAOrganizacion(nucleo, persona.id, organizacion.id)) notFound();
  return {
    persona, nucleo, organizacion,
    rolOrg: rolEnOrganizacion(nucleo, persona.id, organizacion.id),
    variasOrganizaciones: organizacionesDe(nucleo, persona.id).length > 1,
  };
}

/** Barra superior de las pantallas de plataforma. */
export function BarraPlataforma(props: { persona: Persona; organizacion?: Organizacion | null; nucleo: DatosNucleo; inicio?: string; titulo?: string }) {
  const { persona, organizacion, nucleo } = props;
  const etiqueta = etiquetaDatos(organizacion);
  const varias = organizacionesDe(nucleo, persona.id).length > 1;
  // En el celular se achica (2.19): el nombre se corta con "…", el rótulo y la consola van en corto y de la persona
  // quedan las iniciales; "Salir" siempre a la vista.
  return (
    <div className="plataforma__barra">
      <a className="plataforma__marca" href={props.inicio ?? (organizacion ? `/${organizacion.slug}` : '/')}>CampaignSuite</a>
      {props.titulo ? <span className="barra-sup__campana"><span className="recorte">{props.titulo}</span></span>
        : organizacion ? (
          <span className="barra-sup__campana" title={organizacion.nombre}>
            <span className="recorte"><span className="solo-escritorio">{organizacion.demo ? 'Demo' : 'Organización'} · </span>{organizacion.nombre}</span>
            {varias ? <a href="/">cambiar</a> : null}
          </span>
        ) : null}
      <span className="barra-sup__espacio" />
      {nucleo.adminProducto ? <a className="texto-mini" href="/consola"><span className="solo-escritorio">Consola del producto</span><span className="solo-movil">Consola</span></a> : null}
      {etiqueta ? <EtiquetaDatos etiqueta={etiqueta} titulo={tituloEtiquetaDatos(organizacion)} /> : null}
      <span className="barra-sup__persona">
        <span className="avatar" title={persona.nombre}>{persona.iniciales}</span>
        <span className="barra-sup__nombre">{persona.nombre}</span>
        <a className="texto-mini" href="/salir">Salir</a>
      </span>
    </div>
  );
}
