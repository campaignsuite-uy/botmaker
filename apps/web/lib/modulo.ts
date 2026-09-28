/**
 * Resuelve, para cada pantalla de BotMaker, quién es la persona, a qué campaña entra y con qué rol en BotMaker en esa
 * campaña (core.rol_en_campana con la cascada de CampaignSuite). Si algo falta, redirige. Mismo patrón que
 * apps/web/lib/modulo.ts de CampaignSuite: al mudarse, este archivo pasa como lib/bots.ts.
 */
import { notFound, redirect } from 'next/navigation';
import { campanaDeRuta, entraAOrganizacion, rolEnCampana } from '@campaignsuite/platform';
import { nucleoActual, personaActual } from '@campaignsuite/platform/sesion';
import type { RolEfectivo } from '@campaignsuite/botmaker/dominio/tipos';
import type { ContextoPantalla } from '@campaignsuite/botmaker/ui/contexto';

export type Parametros = Promise<{ org: string; campana: string }>;
export type ParametrosBusqueda = Promise<Record<string, string | string[] | undefined>>;

export async function contextoBots(params: Parametros, busqueda?: ParametrosBusqueda): Promise<ContextoPantalla> {
  const { org, campana: slug } = await params;
  const persona = await personaActual();
  if (!persona) redirect('/ingresar');
  const nucleo = await nucleoActual();
  const organizacion = nucleo.organizaciones.find((o) => o.slug === org);
  if (!organizacion || !entraAOrganizacion(nucleo, persona.id, organizacion.id)) notFound();
  const campana = campanaDeRuta(nucleo, persona.id, organizacion.id, slug);
  if (!campana) notFound();
  const inicio = `/${org}/${campana.slug}`;
  // Sin rol en BotMaker (o con el producto suspendido en la campaña), vuelve al inicio de la campaña.
  const rol = rolEnCampana(nucleo, persona.id, campana.id, 'botmaker') as RolEfectivo | null;
  if (!rol) redirect(inicio);
  const sp = busqueda ? await busqueda : {};
  const parametros: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) parametros[k] = Array.isArray(v) ? v[0] : v;
  return {
    persona: { id: persona.id, nombre: persona.nombre, iniciales: persona.iniciales },
    organizacion: { slug: organizacion.slug, nombre: organizacion.nombre, demo: !!organizacion.demo },
    campana: {
      id: campana.id,
      organizacionId: campana.organizacionId,
      slug: campana.slug,
      nombre: campana.nombre,
      paisIso: campana.ubicacion.paisIso,
      pais: campana.ubicacion.pais,
      zonaHoraria: campana.ubicacion.zonaHoraria,
      fechaEleccion: campana.fechaEleccion,
    },
    rol,
    base: `${inicio}/bots`,
    // La configuración de la campaña es una pantalla de CampaignSuite: en este repositorio no existe.
    plataforma: { inicio, configuracion: null },
    nucleo,
    parametros,
  };
}
