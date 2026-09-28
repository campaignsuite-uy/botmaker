import { notFound } from 'next/navigation';
import { campanaDeRuta, productosDeCampana } from '@campaignsuite/platform';
import { BarraPlataforma, contextoOrganizacion } from '@/lib/plataforma';

const ETIQUETA_ROL: Record<string, string> = {
  administrador: 'Administrador', editor: 'Editor', agente: 'Agente', lector: 'Lector', observador: 'Observador', revisor: 'Revisor',
};

/**
 * Inicio de la campaña: los productos habilitados, con el rol de la persona en cada uno. Versión mínima de este
 * repositorio (en CampaignSuite es una pantalla completa de la plataforma): al mudarse, se descarta. Solo BotMaker tiene
 * pantallas acá.
 */
export default async function InicioCampana({ params }: { params: Promise<{ org: string; campana: string }> }) {
  const { org, campana: slug } = await params;
  const { persona, nucleo, organizacion } = await contextoOrganizacion(org);
  const campana = campanaDeRuta(nucleo, persona.id, organizacion.id, slug);
  if (!campana) notFound();
  const productos = productosDeCampana(nucleo, persona.id, campana.id);
  return (
    <div className="plataforma">
      <BarraPlataforma persona={persona} organizacion={organizacion} nucleo={nucleo} titulo={`${organizacion.nombre} · ${campana.nombre}`} />
      <div className="plataforma__contenido">
        <div className="encabezado__texto">
          <div className="ceja"><a href={`/${organizacion.slug}`}>{organizacion.nombre}</a> · {campana.ubicacion.pais}</div>
          <h1 className="titulo">{campana.nombre}</h1>
        </div>
        <div className="grilla-3">
          {productos.map(({ producto, estado, rol }) => {
            const entra = !!rol && estado === 'activo' && producto.id === 'botmaker';
            const contenido = (
              <>
                <div className="mayus apagado">{producto.capa}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{producto.nombre}</div>
                <div className="texto-chico secundario">{producto.descripcion}</div>
                <div className="texto-mini apagado">{estado === 'suspendido' ? 'Suspendido en esta campaña' : rol ? `Tu rol: ${ETIQUETA_ROL[rol] ?? rol}` : 'Sin acceso'}</div>
                {entra ? <span className="enlace-mayus" style={{ marginTop: 'auto' }}>Entrar →</span> : null}
              </>
            );
            return entra
              ? <a key={producto.id} className="producto producto--activo" href={`/${organizacion.slug}/${campana.slug}/${producto.ruta}`}>{contenido}</a>
              : <div key={producto.id} className="producto producto--apagado">{contenido}</div>;
          })}
        </div>
        {!productos.length ? <p className="secundario">Esta campaña no tiene productos habilitados.</p> : null}
      </div>
    </div>
  );
}
