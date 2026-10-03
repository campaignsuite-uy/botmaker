'use client';
/**
 * La conversación del canal web, en el navegador de quien le escribe al bot (página del bot y widget). Guarda un id al
 * azar en el navegador para seguir la misma conversación (nunca un dato de la persona), verifica que no sea un robot
 * con Cloudflare Turnstile si está configurado, y mientras la atiende el equipo pregunta cada 5 segundos si hay algo
 * nuevo. Nada de lo que escribe la persona queda en el navegador más allá de la pantalla.
 *
 * Se ve como un chat de mensajería: cabecera con las iniciales del candidato, burbujas agrupadas por quién habla,
 * opciones como píldoras (o como lista, si tienen descripción) y la entrada abajo. Dentro del widget, la cruz de la
 * cabecera y Escape le piden al sitio que cierre la ventana (postMessage; el sitio lo escucha en canal-web/widget.ts).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MensajePublico, RespuestaWeb } from '../../canal-web/nucleo';

interface Props {
  bot: string;
  /** Dónde viven las rutas de la app pública ('' en la app pública; '/publico' en la demo). */
  base: string;
  canal: 'web' | 'landing';
  trato: 'usted' | 'tu';
  turnstile: string | null;
  titulo: string;
  cabecera: { candidato: string; partido: string | null; iniciales: string };
  /** Dentro del widget: la cabecera lleva la cruz para cerrar. */
  incrustado: boolean;
  pausado: boolean;
  hayCondiciones: boolean;
}

type Linea = MensajePublico & { propio?: boolean; clave: string };

const T = {
  usted: {
    placeholder: 'Escriba su mensaje…', demasiados: 'Demasiados mensajes seguidos. Espere un momento y vuelva a intentar.', error: 'No se pudo enviar. Vuelva a intentar.',
    noDisponible: 'Este asistente no está disponible ahora.', verificando: 'Preparando la conversación…', equipo: 'Una persona del equipo le va a responder por acá.',
    atiende: 'Le atiende una persona del equipo', derivada: 'Pasó al equipo de la campaña', pausa: 'En pausa: le responde el equipo',
  },
  tu: {
    placeholder: 'Escribe tu mensaje…', demasiados: 'Demasiados mensajes seguidos. Espera un momento y vuelve a intentar.', error: 'No se pudo enviar. Vuelve a intentar.',
    noDisponible: 'Este asistente no está disponible ahora.', verificando: 'Preparando la conversación…', equipo: 'Una persona del equipo te va a responder por acá.',
    atiende: 'Te atiende una persona del equipo', derivada: 'Pasó al equipo de la campaña', pausa: 'En pausa: te responde el equipo',
  },
};

function azar(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[x & 63]).join('');
}

function idContacto(bot: string): string {
  const clave = `botmaker:contacto:${bot}`;
  try {
    const ya = window.localStorage.getItem(clave);
    if (ya && /^[A-Za-z0-9_-]{16,64}$/.test(ya)) return ya;
    const nuevo = azar(24);
    window.localStorage.setItem(clave, nuevo);
    return nuevo;
  } catch {
    // Sin almacenamiento (navegación privada, marcos bloqueados): la conversación dura lo que dura la página.
    return azar(24);
  }
}

/** Le pide al sitio que cierre el widget (solo dentro del marco). */
function cerrarWidget() {
  if (window.parent !== window) window.parent.postMessage({ botmaker: 'cerrar' }, '*');
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'error-callback'?: () => void; appearance?: string; size?: string }) => string };
  }
}

const IconoEnviar = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconoCerrar = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const IconoFlecha = () => (
  <svg className="pub-opcion__flecha" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconoPersona = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

export function ChatPublico({ bot, base, canal, trato, turnstile, titulo, cabecera, incrustado, pausado, hayCondiciones }: Props) {
  const t = T[trato];
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [estado, setEstado] = useState<string>('nueva');
  const [condiciones, setCondiciones] = useState<number | null>(null);
  const [verificando, setVerificando] = useState(!!turnstile);
  const contacto = useRef<string>('');
  const ultimo = useRef(0);
  const token = useRef<string | undefined>(undefined);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const cajaTurnstile = useRef<HTMLDivElement>(null);

  const agregar = useCallback((ms: MensajePublico[]) => {
    setLineas((antes) => {
      const vistos = new Set(antes.filter((x) => x.n > 0).map((x) => x.n));
      return [...antes, ...ms.filter((m) => m.n === 0 || !vistos.has(m.n)).map((m) => ({ ...m, clave: `${m.n}-${azar(4)}` }))];
    });
  }, []);

  const enviar = useCallback(async (entrada: Record<string, unknown>, propio?: string) => {
    setAviso(null);
    if (propio) setLineas((a) => [...a, { n: 0, autor: 'contacto', texto: propio, propio: true, clave: azar(6) }]);
    setOcupado(true);
    try {
      const r = await fetch(`${base}/api/conversar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot, contacto: contacto.current, canal, id: azar(20), entrada, ...(token.current ? { verificacion: token.current } : {}) }),
      });
      token.current = undefined;
      const j = (await r.json()) as RespuestaWeb;
      if (!j.ok) {
        setAviso(j.status === 429 ? t.demasiados : j.status === 404 ? t.noDisponible : t.error);
        return;
      }
      ultimo.current = Math.max(ultimo.current, j.ultimo);
      setEstado(j.estado);
      setCondiciones(j.pedirCondiciones);
      agregar(j.mensajes);
    } catch {
      setAviso(t.error);
    } finally {
      setOcupado(false);
    }
  }, [agregar, base, bot, canal, t]);

  // Arranca: el id del navegador, la verificación (si hay) y el primer mensaje. Una sola vez.
  const arranco = useRef(false);
  useEffect(() => {
    if (arranco.current) return;
    arranco.current = true;
    contacto.current = idContacto(bot);
    if (!turnstile) {
      void enviar({ tipo: 'inicio' });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => {
      if (!window.turnstile || !cajaTurnstile.current) return;
      window.turnstile.render(cajaTurnstile.current, {
        sitekey: turnstile, size: 'flexible', appearance: 'interaction-only',
        callback: (tk) => {
          token.current = tk;
          setVerificando(false);
          void enviar({ tipo: 'inicio' });
        },
        'error-callback': () => {
          // Sin verificación el bot contesta igual, solo con menús.
          setVerificando(false);
          void enviar({ tipo: 'inicio' });
        },
      });
    };
    s.onerror = () => {
      setVerificando(false);
      void enviar({ tipo: 'inicio' });
    };
    document.head.appendChild(s);
  }, [bot, enviar, turnstile]);

  // Mientras la atiende el equipo, pregunta cada 5 segundos si hay algo nuevo.
  useEffect(() => {
    if (estado !== 'derivada' && estado !== 'en_atencion') return;
    const id = setInterval(async () => {
      try {
        const q = new URLSearchParams({ bot, contacto: contacto.current, desde: String(ultimo.current) });
        const r = (await (await fetch(`${base}/api/mensajes?${q}`)).json()) as RespuestaWeb;
        if (r.ok) {
          ultimo.current = Math.max(ultimo.current, r.ultimo);
          if (r.estado !== 'nueva') setEstado(r.estado);
          agregar(r.mensajes);
        }
      } catch { /* sin conexión: se vuelve a intentar */ }
    }, 5000);
    return () => clearInterval(id);
  }, [agregar, base, bot, estado]);

  // Lo último siempre a la vista: se mueve la lista, no la página (dentro del widget, la página es la del sitio).
  useEffect(() => {
    const c = lista.current;
    if (!c) return;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.scrollTo({ top: c.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
  }, [lineas, ocupado, estado]);

  // Dentro del widget, Escape cierra la ventana.
  useEffect(() => {
    if (!incrustado) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cerrarWidget();
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [incrustado]);

  const ajustarAlto = () => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight, 132)}px`;
    // La caja crece hacia arriba y achica la lista: lo último sigue a la vista.
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  };
  const mandarTexto = () => {
    const x = texto.trim();
    if (!x || ocupado || condiciones) return;
    setTexto('');
    if (campo.current) campo.current.style.height = '';
    void enviar({ tipo: 'texto', texto: x }, x);
  };
  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      mandarTexto();
    }
  };
  const tocar = (m: MensajePublico, o: { letra: string; texto: string }) => {
    if (ocupado) return;
    if (m.opcionesDe === 'condiciones' && condiciones) void enviar({ tipo: 'aceptar', numero: condiciones }, o.texto);
    else void enviar({ tipo: 'opcion', cajaId: m.opcionesDe ?? '', letra: o.letra, titulo: o.texto }, o.texto);
  };
  // Las opciones valen solo en el último mensaje que las trae, y hasta que la persona contesta algo.
  const ultimoIndice = (f: (l: Linea) => boolean) => lineas.reduce((ya, l, i) => (f(l) ? i : ya), -1);
  const conOpciones = ultimoIndice((l) => !!l.opciones?.length && !l.propio);
  const ultimaConOpciones = conOpciones > ultimoIndice((l) => l.autor === 'contacto') ? lineas[conOpciones] : undefined;
  const conEquipo = estado === 'derivada' || estado === 'en_atencion';
  const sub = estado === 'en_atencion' ? t.atiende : estado === 'derivada' ? t.derivada : pausado ? t.pausa : [cabecera.partido, 'Asistente virtual'].filter(Boolean).join(' · ');
  const opciones = (l: Linea) => (l.opciones?.length && l === ultimaConOpciones ? (
    <div className={`pub-opciones pub-opciones--${l.modo ?? 'botones'}`} role="group" aria-label="Opciones">
      {l.opciones.map((o) => (
        <button key={o.letra} type="button" className="pub-opcion" onClick={() => tocar(l, o)} disabled={ocupado}>
          <span className="pub-opcion__textos">
            <span className="pub-opcion__titulo">{o.texto}</span>
            {o.descripcion ? <span className="pub-opcion__desc">{o.descripcion}</span> : null}
          </span>
          {l.modo === 'lista' ? <IconoFlecha /> : null}
        </button>
      ))}
    </div>
  ) : null);
  const lado = (l: Linea | undefined) => (!l ? null : l.autor === 'contacto' ? 'propio' : l.autor === 'sistema' ? 'sistema' : l.autor);

  return (
    <div className={`pub-chat${incrustado ? ' pub-chat--incrustado' : ''}`} aria-label={titulo}>
      <header className="pub-cabecera">
        <div className="pub-avatar pub-avatar--cabecera" aria-hidden="true">
          {cabecera.iniciales}
          <span className={`pub-avatar__punto${pausado ? ' pub-avatar__punto--pausa' : ''}`} />
        </div>
        <div className="pub-cabecera__textos">
          <div className="pub-cabecera__nombre">{cabecera.candidato}</div>
          <div className="pub-cabecera__sub">{sub}</div>
        </div>
        {incrustado ? (
          <button type="button" className="pub-cabecera__cerrar" onClick={cerrarWidget} aria-label="Cerrar la conversación"><IconoCerrar /></button>
        ) : null}
      </header>

      <div className="pub-chat__mensajes" role="log" aria-live="polite" ref={lista}>
        {lineas.map((l, i) => {
          const quien = lado(l);
          const ultimaDelGrupo = lado(lineas[i + 1]) !== quien;
          const primeraDelGrupo = lado(lineas[i - 1]) !== quien;
          if (quien === 'sistema') {
            return (
              <div key={l.clave} className="pub-fila pub-fila--sistema">
                <div className="pub-fila__sistema">
                  <div className="pub-msj pub-msj--sistema">
                    <div className="pub-msj__texto">{l.texto}</div>
                    {l.enlace === 'condiciones' ? <a className="pub-msj__enlace" href={`${base}/b/${bot}/condiciones`} target="_blank" rel="noreferrer">Leer las condiciones</a> : null}
                  </div>
                  {opciones(l)}
                </div>
              </div>
            );
          }
          const izquierda = quien === 'bot' || quien === 'agente';
          return (
            <div key={l.clave} className={`pub-fila pub-fila--${quien}${primeraDelGrupo ? ' pub-fila--primera' : ''}${ultimaDelGrupo ? ' pub-fila--ultima' : ''}`}>
              {izquierda ? (
                <div className="pub-fila__avatar" aria-hidden="true">
                  {ultimaDelGrupo ? (quien === 'agente' ? <span className="pub-avatar pub-avatar--equipo"><IconoPersona /></span> : <span className="pub-avatar">{cabecera.iniciales}</span>) : null}
                </div>
              ) : null}
              <div className={`pub-fila__cuerpo${l.modo === 'lista' && l === ultimaConOpciones ? ' pub-fila__cuerpo--ancho' : ''}`}>
                {quien === 'agente' && primeraDelGrupo ? <div className="pub-quien">Equipo de la campaña</div> : null}
                <div className={`pub-msj pub-msj--${l.autor}`}>
                  <div className="pub-msj__texto">{l.texto}</div>
                  {l.enlace === 'condiciones' ? <a className="pub-msj__enlace" href={`${base}/b/${bot}/condiciones`} target="_blank" rel="noreferrer">Leer las condiciones</a> : null}
                </div>
                {opciones(l)}
              </div>
            </div>
          );
        })}
        {verificando ? <div className="pub-fila pub-fila--sistema"><div className="pub-msj pub-msj--sistema">{t.verificando}</div></div> : null}
        {ocupado && !verificando ? (
          <div className={`pub-fila pub-fila--bot pub-fila--ultima${lado(lineas[lineas.length - 1]) === 'bot' ? '' : ' pub-fila--primera'}`}>
            <div className="pub-fila__avatar" aria-hidden="true"><span className="pub-avatar">{cabecera.iniciales}</span></div>
            <div className="pub-escribiendo" aria-label="Escribiendo"><span /><span /><span /></div>
          </div>
        ) : null}
        {conEquipo ? <div className="pub-nota"><IconoPersona />{t.equipo}</div> : null}
      </div>

      <div ref={cajaTurnstile} className="pub-turnstile" />
      {aviso ? <div className="pub-aviso" role="alert">{aviso}</div> : null}
      <form className="pub-chat__entrada" onSubmit={(e) => { e.preventDefault(); mandarTexto(); }}>
        <div className="pub-chat__caja">
          <textarea
            ref={campo} className="pub-chat__campo" aria-label="Mensaje" placeholder={t.placeholder} value={texto} maxLength={2000} rows={1}
            onChange={(e) => { setTexto(e.target.value); ajustarAlto(); }} onKeyDown={alTeclear}
          />
          <button type="submit" className="pub-chat__enviar" disabled={ocupado || !texto.trim() || !!condiciones}>
            <IconoEnviar /><span className="pub-oculto">Enviar</span>
          </button>
        </div>
      </form>
      <footer className="pub-pie">
        Asistente virtual con IA: puede equivocarse
        {hayCondiciones ? <> · <a href={`${base}/b/${bot}/condiciones`} target={incrustado ? '_blank' : undefined} rel="noreferrer">Condiciones</a></> : '.'}
      </footer>
    </div>
  );
}
