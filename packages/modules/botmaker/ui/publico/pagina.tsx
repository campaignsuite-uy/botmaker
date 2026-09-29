/** Páginas de la app pública: la del bot (también dentro del widget), sus condiciones y "no disponible". Solo dibujan. */
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
    <main className={`pub-app${incrustado ? ' pub-app--incrustado' : ''}`}>
      {incrustado ? null : (
        <header className="pub-cabecera">
          <div className="pub-cabecera__nombre">{d.candidato}</div>
          <div className="pub-cabecera__sub">{d.partido ? `${d.partido} · ` : ''}{d.nombre}</div>
        </header>
      )}
      <ChatPublico bot={bot} base={base} canal={incrustado ? 'web' : 'landing'} trato={d.trato} turnstile={turnstile} titulo={`Conversación con ${d.nombre}`} />
      {incrustado ? null : (
        <footer className="pub-pie">
          Asistente virtual con inteligencia artificial: puede equivocarse. {d.condiciones ? <a href={`${base}/b/${bot}/condiciones`}>Condiciones</a> : null}
        </footer>
      )}
    </main>
  );
}

export function PaginaCondiciones({ d, bot, base }: { d: DatosPaginaBot; bot: string; base: string }) {
  return (
    <main className="pub-app pub-app--texto">
      <header className="pub-cabecera">
        <div className="pub-cabecera__nombre">Condiciones</div>
        <div className="pub-cabecera__sub">{d.nombre} · {d.candidato}</div>
      </header>
      <article className="pub-condiciones">
        {d.condiciones ? d.condiciones.texto.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p>Este asistente todavía no publicó sus condiciones.</p>}
        {d.condiciones ? <p className="pub-pie">Versión {d.condiciones.numero}.</p> : null}
        <p><a href={`${base}/b/${bot}`}>Volver a la conversación</a></p>
      </article>
    </main>
  );
}

export function PaginaNoDisponible() {
  return (
    <main className="pub-app pub-app--texto">
      <article className="pub-condiciones">
        <p>Este asistente no está disponible.</p>
      </article>
    </main>
  );
}

/** Página de prueba con el widget pegado como lo pegaría una campaña (para probar el canal de punta a punta). */
export function PaginaPrueba({ bot, base }: { bot: string; base: string }) {
  return (
    <main className="pub-app pub-app--texto">
      <article className="pub-condiciones">
        <h1>Sitio de prueba</h1>
        <p>Esta página simula el sitio de una campaña con el widget de BotMaker pegado. El botón está abajo a la derecha.</p>
        <pre className="pub-codigo">{`<script src="${base}/widget.js" data-bot="${bot}" async></script>`}</pre>
      </article>
      <script src={`${base}/widget.js`} data-bot={bot} async />
    </main>
  );
}
