import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacidad · BotMaker' };

/**
 * Privacidad del entorno de desarrollo de BotMaker. BotMaker es un producto de CampaignSuite: rige su política de
 * privacidad. Al mudarse al monorepo, esta página se descarta.
 */
export default function Privacidad() {
  return (
    <div className="plataforma">
      <div className="plataforma__barra">
        <a className="plataforma__marca" href="/">CampaignSuite</a>
        <span className="barra-sup__espacio" />
        <a className="texto-mini" href="/ingresar">Ingresar</a>
      </div>
      <main className="plataforma__contenido legal">
        <div className="encabezado__texto">
          <div className="ceja">BotMaker</div>
          <h1 className="titulo">Política de <em>privacidad</em></h1>
          <p className="bajada">BotMaker es un producto de CampaignSuite. Para el equipo que lo usa rige la política de privacidad de CampaignSuite.</p>
        </div>
        <section>
          <p><a href="https://campaignsuite.vercel.app/privacidad">Política de privacidad de CampaignSuite</a></p>
          <p>Este es un entorno de desarrollo: se usa con cuentas de prueba del equipo, sin datos de ciudadanos.</p>
        </section>
      </main>
    </div>
  );
}
