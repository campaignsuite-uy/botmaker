'use client';
/**
 * La conversación del canal web, en el navegador de quien le escribe al bot (página del bot y widget). Guarda un id al
 * azar en el navegador para seguir la misma conversación (nunca un dato de la persona), verifica que no sea un robot
 * con Cloudflare Turnstile si está configurado, y mientras la atiende el equipo pregunta cada 5 segundos si hay algo
 * nuevo. Nada de lo que escribe la persona queda en el navegador más allá de la pantalla.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MensajePublico, RespuestaWeb } from '../../canal-web/nucleo';

interface Props {
  bot: string;
  /** Dónde viven las rutas de la app pública ('' en la app pública; '/publico' en la demo). */
  base: string;
  canal: 'web' | 'landing';
  trato: 'usted' | 'tu';
  turnstile: string | null;
  titulo: string;
}

type Linea = MensajePublico & { propio?: boolean; clave: string };

const T = {
  usted: { placeholder: 'Escriba su mensaje', enviar: 'Enviar', demasiados: 'Demasiados mensajes seguidos. Espere un momento y vuelva a intentar.', error: 'No se pudo enviar. Vuelva a intentar.', noDisponible: 'Este asistente no está disponible ahora.', verificando: 'Verificando que no es un robot…', equipo: 'Una persona del equipo le va a responder por acá.' },
  tu: { placeholder: 'Escribe tu mensaje', enviar: 'Enviar', demasiados: 'Demasiados mensajes seguidos. Espera un momento y vuelve a intentar.', error: 'No se pudo enviar. Vuelve a intentar.', noDisponible: 'Este asistente no está disponible ahora.', verificando: 'Verificando que no es un robot…', equipo: 'Una persona del equipo te va a responder por acá.' },
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

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'error-callback'?: () => void; appearance?: string; size?: string }) => string };
  }
}

export function ChatPublico({ bot, base, canal, trato, turnstile, titulo }: Props) {
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
  const fin = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [lineas]);

  const mandarTexto = (e: React.FormEvent) => {
    e.preventDefault();
    const x = texto.trim();
    if (!x || ocupado) return;
    setTexto('');
    void enviar({ tipo: 'texto', texto: x }, x);
  };
  const tocar = (m: MensajePublico, o: { letra: string; texto: string }) => {
    if (ocupado) return;
    if (m.opcionesDe === 'condiciones' && condiciones) void enviar({ tipo: 'aceptar', numero: condiciones }, o.texto);
    else void enviar({ tipo: 'opcion', cajaId: m.opcionesDe ?? '', letra: o.letra, titulo: o.texto }, o.texto);
  };
  const ultimaConOpciones = [...lineas].reverse().find((l) => l.opciones?.length && !l.propio);

  return (
    <div className="pub-chat" aria-label={titulo}>
      <div className="pub-chat__mensajes" role="log" aria-live="polite">
        {lineas.map((l) => (
          <div key={l.clave} className={`pub-msj pub-msj--${l.autor}`}>
            <div className="pub-msj__texto">{l.texto}</div>
            {l.enlace === 'condiciones' ? <a className="pub-msj__enlace" href={`${base}/b/${bot}/condiciones`} target="_blank" rel="noreferrer">Leer las condiciones</a> : null}
            {l.opciones?.length && l === ultimaConOpciones ? (
              <div className={`pub-opciones pub-opciones--${l.modo ?? 'botones'}`}>
                {l.opciones.map((o) => (
                  <button key={o.letra} type="button" className="pub-opcion" onClick={() => tocar(l, o)} disabled={ocupado}>
                    <span>{o.texto}</span>{o.descripcion ? <span className="pub-opcion__desc">{o.descripcion}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {verificando ? <div className="pub-msj pub-msj--sistema">{t.verificando}</div> : null}
        {ocupado && !verificando ? <div className="pub-escribiendo" aria-label="Escribiendo"><span /><span /><span /></div> : null}
        {estado === 'derivada' || estado === 'en_atencion' ? <div className="pub-nota">{t.equipo}</div> : null}
        <div ref={fin} />
      </div>
      <div ref={cajaTurnstile} className="pub-turnstile" />
      {aviso ? <div className="pub-aviso" role="alert">{aviso}</div> : null}
      <form className="pub-chat__entrada" onSubmit={mandarTexto}>
        <input className="pub-chat__campo" aria-label="Mensaje" placeholder={t.placeholder} value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="pub-chat__enviar" disabled={ocupado || !texto.trim() || !!condiciones}>{t.enviar}</button>
      </form>
    </div>
  );
}
