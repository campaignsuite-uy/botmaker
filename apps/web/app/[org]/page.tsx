import { campanasDe, productosDeCampana } from '@campaignsuite/platform';
import { BarraPlataforma, contextoOrganizacion } from '@/lib/plataforma';

/**
 * Inicio de la organización: sus campañas a las que entra la persona, con los productos de cada una. Versión mínima de
 * este repositorio (en CampaignSuite es una pantalla completa de la plataforma): al mudarse, se descarta.
 */
export default async function InicioOrganizacion({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const { persona, nucleo, organizacion } = await contextoOrganizacion(org);
  const campanas = campanasDe(nucleo, persona.id, organizacion.id);
  return (
    <div className="plataforma">
      <BarraPlataforma persona={persona} organizacion={organizacion} nucleo={nucleo} />
      <div className="plataforma__contenido">
        <div className="encabezado__texto">
          <div className="ceja">{organizacion.nombre}</div>
          <h1 className="titulo">Campañas</h1>
        </div>
        {campanas.length ? (
          <div className="grilla-3">
            {campanas.map((c) => {
              const productos = productosDeCampana(nucleo, persona.id, c.id);
              return (
                <a key={c.id} className={`producto ${c.estado === 'activa' ? 'producto--activo' : 'producto--apagado'}`} href={`/${organizacion.slug}/${c.slug}`}>
                  <div className="mayus apagado">{c.ubicacion.pais}{c.estado === 'archivada' ? ' · archivada' : ''}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{c.nombre}</div>
                  <div className="texto-chico secundario">{productos.map((p) => p.producto.nombre).join(' · ') || 'Sin productos'}</div>
                  <span className="enlace-mayus" style={{ marginTop: 'auto' }}>Entrar →</span>
                </a>
              );
            })}
          </div>
        ) : (
          <p className="secundario">No estás en ninguna campaña de esta organización. Pedile acceso a quien la administra.</p>
        )}
      </div>
    </div>
  );
}
