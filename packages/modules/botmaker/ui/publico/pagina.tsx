/** Páginas de la app pública: la del bot (también dentro del widget), sus condiciones y "no disponible". Solo dibujan. */
import '@fontsource-variable/inter';
import { inicialesDe } from '../../canal-web/nucleo';
import { ChatPublico } from './chat';

export interface DatosPaginaBot {
  nombre: string;
  candidato: string;
  partido: string | null;
  trato: 'usted' | 'tu';
  condiciones: { numero: number; texto: string } | null;
  pausado: boolean;
}

export function PaginaBot({ d, bot, base, incrustado, turnstile }: { d: DatosPaginaBot; bot: string; base: string; incrustado: boolean; turnstile: string | null }) {
  return (
    <main className={`pub-app ${incrustado ? 'pub-app--incrustado' : 'pub-app--pagina'}`}>
      <ChatPublico
        bot={bot} base={base} canal={incrustado ? 'web' : 'landing'} trato={d.trato} turnstile={turnstile} titulo={`Conversación con ${d.nombre}`}
        cabecera={{ candidato: d.candidato, partido: d.partido, iniciales: inicialesDe(d.candidato) }} incrustado={incrustado} pausado={d.pausado}
        hayCondiciones={!!d.condiciones}
      />
    </main>
  );
}

export function PaginaCondiciones({ d, bot, base }: { d: DatosPaginaBot; bot: string; base: string }) {
  return (
    <main className="pub-app pub-app--texto">
      <article className="pub-documento">
        <header className="pub-documento__cabecera">
          <div className="pub-avatar pub-avatar--cabecera" aria-hidden="true">{inicialesDe(d.candidato)}</div>
          <div>
            <h1 className="pub-documento__titulo">Condiciones</h1>
            <div className="pub-documento__sub">{d.nombre} · {d.candidato}</div>
          </div>
        </header>
        <div className="pub-documento__cuerpo">
          {d.condiciones ? d.condiciones.texto.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p>Este asistente todavía no publicó sus condiciones.</p>}
          {d.condiciones ? <p className="pub-documento__version">Versión {d.condiciones.numero}.</p> : null}
        </div>
        <a className="pub-boton" href={`${base}/b/${bot}`}>Volver a la conversación</a>
      </article>
    </main>
  );
}

export function PaginaNoDisponible() {
  return (
    <main className="pub-app pub-app--texto">
      <article className="pub-documento pub-documento--corto">
        <h1 className="pub-documento__titulo">Asistente no disponible</h1>
        <p>Este asistente no está disponible.</p>
      </article>
    </main>
  );
}

/**
 * Página de prueba con el widget pegado como lo pegaría una campaña (para probar el canal de punta a punta). Imita un
 * sitio cualquiera con bloques grises, para ver el botón y la ventana en contexto.
 */
export function PaginaPrueba({ bot, base }: { bot: string; base: string }) {
  return (
    <main className="pub-sitio">
      <header className="pub-sitio__barra">
        <span className="pub-sitio__marca">Sitio de prueba</span>
        <nav className="pub-sitio__menu" aria-label="Menú de ejemplo"><span>Propuestas</span><span>Agenda</span><span>Sumate</span></nav>
      </header>
      <section className="pub-sitio__portada">
        <p className="pub-sitio__ceja">BotMaker · canal web</p>
        <h1>Así se ve el asistente en el sitio de una campaña</h1>
        <p>Esta página simula el sitio de una campaña con el widget pegado. El botón está abajo a la derecha; a los pocos segundos aparece el saludo.</p>
        <pre className="pub-codigo">{`<script src="${base}/widget.js" data-bot="${bot}" async></script>`}</pre>
      </section>
      <section className="pub-sitio__bloques" aria-hidden="true">
        <div /><div /><div />
      </section>
      <script src={`${base}/widget.js`} data-bot={bot} async />
    </main>
  );
}
