import { redirect } from 'next/navigation';
import { modoDatos, organizacionesDe } from '@campaignsuite/platform';
import { aceptarInvitaciones, nucleoActual, personaActual } from '@campaignsuite/platform/sesion';
import { BarraPlataforma } from '@/lib/plataforma';

/**
 * Entrada: sin sesión → /ingresar. Con el ingreso real acepta primero las invitaciones pendientes de su correo
 * (2.3). Con una sola organización (y sin la consola) → su inicio (sus campañas). Sin ninguna organización: "Tu cuenta no tiene
 * acceso" (2.1) y ningún dato. El Administrador de CampaignSuite ve además sus demos y el enlace a la consola (2.16).
 */
export default async function Inicio() {
  const persona = await personaActual();
  if (!persona) redirect('/ingresar');
  if (modoDatos() === 'supabase') await aceptarInvitaciones();
  const nucleo = await nucleoActual();
  const orgs = organizacionesDe(nucleo, persona.id);
  if (orgs.length === 1 && !nucleo.adminProducto) redirect(`/${orgs[0]!.organizacion.slug}`);
  const clientes = orgs.filter((o) => !o.organizacion.demo);
  const demos = orgs.filter((o) => o.organizacion.demo);
  return (
    <div className="plataforma">
      <BarraPlataforma persona={persona} nucleo={nucleo} inicio="/" titulo="Inicio" />
      <div className="plataforma__contenido">
        {!orgs.length && !nucleo.adminProducto ? (
          <div className="caja" style={{ maxWidth: 640 }}>
            <h1 className="caja__titulo">Tu cuenta no tiene acceso</h1>
            <p className="secundario" style={{ margin: 0 }}>Entraste como {persona.email}. Tu cuenta no tiene acceso: pedíselo al Administrador de tu organización. Cuando te invite con este correo, volvé a ingresar.</p>
            <a className="enlace-mayus" href="/salir">Salir →</a>
          </div>
        ) : (
          <>
            <div className="encabezado">
              <div className="encabezado__texto">
                <div className="ceja">CampaignSuite</div>
                <h1 className="titulo">Elegí <em>organización</em></h1>
              </div>
              {nucleo.adminProducto ? <a className="boton boton--sec" href="/consola">Consola del producto</a> : null}
            </div>
            {clientes.length ? (
              <div className="grilla-3">
                {clientes.map((o) => (
                  <a key={o.organizacion.id} className="producto producto--activo" href={`/${o.organizacion.slug}`}>
                    <div className="mayus apagado">Organización</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{o.organizacion.nombre}</div>
                    <span className="enlace-mayus" style={{ marginTop: 'auto' }}>Entrar →</span>
                  </a>
                ))}
              </div>
            ) : null}
            {demos.length ? (
              <>
                <h2 className="subtitulo">Demos · solo para mirar</h2>
                <div className="grilla-3">
                  {demos.map((o) => (
                    <a key={o.organizacion.id} className={`producto ${o.organizacion.estadoDemo === 'lista' ? 'producto--activo' : 'producto--apagado'}`} href={`/${o.organizacion.slug}`}>
                      <div className="mayus apagado">Demo{o.organizacion.estadoDemo === 'cargando' ? ' · se está cargando' : ''}</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{o.organizacion.nombre}</div>
                      {o.organizacion.origenDemo ? <div className="texto-mini apagado">{o.organizacion.origenDemo}</div> : null}
                      <span className="enlace-mayus" style={{ marginTop: 'auto' }}>Entrar →</span>
                    </a>
                  ))}
                </div>
              </>
            ) : null}
            {!orgs.length ? <p className="secundario">Todavía no sos parte de ninguna organización. Desde la consola del producto creás organizaciones y demos.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
