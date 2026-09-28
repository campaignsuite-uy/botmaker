/**
 * Marco de BotMaker: menú lateral + barra superior + contenido, con las clases del marco de CampaignSuite
 * (@campaignsuite/ui). Lo usa el layout de la app (apps/web/app/[org]/[campana]/bots/layout.tsx).
 */
import type { ReactNode } from 'react';
import { etiquetaDatos, tituloEtiquetaDatos } from '@campaignsuite/platform';
import { EtiquetaDatos } from '@campaignsuite/ui';
import type { DatosMarco } from '../vistas/marco';
import type { ContextoPantalla } from './contexto';

export function Marco(props: { ctx: ContextoPantalla; datos: DatosMarco; children: ReactNode }) {
  const { ctx, datos } = props;
  const etiqueta = etiquetaDatos(ctx.organizacion);
  return (
    <div className="marco">
      <nav className="menu" aria-label="Navegación de BotMaker">
        <a className="menu__marca" href={`/${ctx.organizacion.slug}`}>CampaignSuite</a>
        <ContenidoMenu ctx={ctx} datos={datos} />
      </nav>
      <div className="columna">
        <header className="barra-sup">
          {/* En el celular el menú lateral no entra: se abre desde acá (details, sin JavaScript). */}
          <details className="menu-movil">
            <summary className="menu-movil__boton" aria-label="Abrir el menú de BotMaker">Menú</summary>
            <nav className="menu-movil__panel" aria-label="Navegación de BotMaker">
              <a className="menu__item" href={ctx.plataforma.inicio}><span>← {ctx.campana.nombre}: productos</span></a>
              <ContenidoMenu ctx={ctx} datos={datos} />
              <div className="menu-movil__pie"><a className="menu__item" href="/salir"><span>Salir</span></a></div>
            </nav>
          </details>
          <span className="barra-sup__campana" title={ctx.campana.nombre}>
            {datos.pais === 'PA' ? <span className="barra-sup__bandera" aria-hidden="true" /> : null}
            <span className="recorte">{ctx.campana.nombre}</span>
          </span>
          <span className="barra-sup__contexto">{datos.contexto}</span>
          <span className="barra-sup__espacio" />
          {etiqueta ? <EtiquetaDatos etiqueta={etiqueta} titulo={tituloEtiquetaDatos(ctx.organizacion)} /> : null}
          <span className="barra-sup__persona">
            <span className="avatar" title={ctx.persona.nombre}>{ctx.persona.iniciales}</span>
            <span className="barra-sup__nombre">{ctx.persona.nombre}</span>
            <a className="texto-mini" href="/salir">Salir</a>
          </span>
        </header>
        <main className="contenido">{props.children}</main>
      </div>
      <MarcarActiva />
    </div>
  );
}

function ContenidoMenu({ ctx, datos }: { ctx: ContextoPantalla; datos: DatosMarco }) {
  return (
    <>
      <div className="menu__modulo">
        <div className="menu__nombre">BotMaker</div>
        <div className="menu__estado">{datos.estado}</div>
      </div>
      <div className="menu__grupos">
        {datos.grupos.map((g) => (
          <div className="menu__grupo" key={g.titulo}>
            <div className="menu__titulo">{g.titulo}</div>
            {g.items.map((i) => (
              <a key={i.id} className="menu__item" href={i.href} data-seccion={i.id} suppressHydrationWarning>
                <span>{i.texto}</span>
                {i.insignia ? <span className="menu__insignia">{i.insignia}</span> : null}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="menu__pie">
        <div className="menu__pie-titulo">Campaña</div>
        <a className="texto-chico secundario" href={ctx.plataforma.inicio}>{ctx.campana.nombre}</a>
        <div className="texto-mini apagado">{ctx.organizacion.nombre}</div>
        <div className="texto-mini apagado">Tu rol: {datos.rolTexto}</div>
        {ctx.plataforma.configuracion ? <a className="texto-mini" href={ctx.plataforma.configuracion}>Configuración de la campaña</a> : null}
      </div>
    </>
  );
}

/**
 * La sección activa se marca en el cliente leyendo la dirección (el layout no conoce la ruta hija). Script mínimo en
 * línea; corre antes de que React hidrate, por eso cada enlace lleva suppressHydrationWarning. La lista de bots marca
 * también las pantallas de cada bot.
 */
function MarcarActiva() {
  const js = `(function(){var p=location.pathname.replace(/\\/$/,'');var mejor=null,largo=-1;document.querySelectorAll('.menu__item[data-seccion]').forEach(function(a){var h=a.getAttribute('href').split('?')[0].replace(/\\/$/,'');if((p===h||p.indexOf(h+'/')===0)&&h.length>largo){mejor=h;largo=h.length;}});if(mejor===null)return;document.querySelectorAll('.menu__item[data-seccion]').forEach(function(a){var h=a.getAttribute('href').split('?')[0].replace(/\\/$/,'');if(h===mejor)a.setAttribute('aria-current','page');});})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
