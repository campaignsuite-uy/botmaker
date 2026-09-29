'use client';
/**
 * El teléfono de prueba (SOLO LA DEMO): escribe al WhatsApp de un bot como lo haría una persona. Lo que manda pasa por
 * el 360dialog simulado, que arma el aviso de Meta y lo entrega a la misma ruta del webhook que usa 360dialog; lo que
 * contesta el bot vuelve por el mismo simulado. Al mirar la conversación, los mensajes quedan entregados y leídos.
 *
 * Los controles de la derecha prueban lo que no se ve en una conversación normal: un reintento de 360dialog, que pasen
 * 24 horas (la ventana se cierra), una clave que deja de valer y que Meta decida las plantillas en revisión.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface Cuenta { idPublico: string; nombre: string; numero: string | null; estado: string; simulada: boolean; revocada: boolean }
type Interactivo =
  | { type: 'button'; body: { text: string }; action: { buttons: { reply: { id: string; title: string } }[] } }
  | { type: 'list'; body: { text: string }; action: { button: string; sections: { rows: { id: string; title: string; description?: string }[] }[] } };
interface MensajeTel {
  id: string;
  sentido: 'de' | 'para';
  mensaje: { type: 'entrante'; texto: string } | { type: 'text'; text: { body: string } } | { type: 'interactive'; interactive: Interactivo } | { type: 'template'; template: { name: string } };
  textoPlantilla?: string;
  hora: string;
}
interface Estado { cuentas: Cuenta[]; mensajes: MensajeTel[]; conversacion: { estado: string; ventanaHasta: string | null } | null }

const hora = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export function TelefonoPrueba({ base, botInicial }: { base: string; botInicial: string | null }) {
  const [bot, setBot] = useState<string | null>(botInicial);
  const [telefono, setTelefono] = useState('+507 6123-4567');
  const [nombre, setNombre] = useState('Persona de prueba');
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>({ cuentas: [], mensajes: [], conversacion: null });
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [listaAbierta, setListaAbierta] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);
  const cuantos = useRef(0);

  const leer = useCallback(async () => {
    const q = new URLSearchParams({ ...(bot ? { bot } : {}), telefono });
    try {
      const r = await fetch(`${base}/api/telefono?${q}`, { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as Estado;
      setEstado(j);
      if (!bot && j.cuentas[0]) setBot(j.cuentas[0].idPublico);
    } catch { /* sin conexión: se vuelve a intentar */ }
  }, [base, bot, telefono]);

  useEffect(() => {
    void leer();
    const id = setInterval(() => void leer(), 1500);
    return () => clearInterval(id);
  }, [leer]);

  useEffect(() => {
    if (estado.mensajes.length !== cuantos.current) {
      cuantos.current = estado.mensajes.length;
      fin.current?.scrollIntoView({ block: 'end' });
    }
  }, [estado.mensajes.length]);

  const pedir = async (cuerpo: Record<string, unknown>, listo?: string) => {
    if (!bot) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await fetch(`${base}/api/telefono`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bot, telefono, ...cuerpo }) });
      const j = (await r.json()) as { ok: boolean; aviso?: number; error?: string };
      if (!j.ok) setAviso(j.error === 'sin_cuenta' ? 'Ese bot no tiene WhatsApp conectado a la cuenta simulada.' : 'No se pudo.');
      else if (j.aviso !== undefined && j.aviso !== 200) setAviso(`El aviso a BotMaker volvió con ${j.aviso}: ${j.aviso === 401 ? 'la contraseña del aviso no coincide (reconectá el canal)' : 'revisá el canal en Canales'}.`);
      else if (listo) setAviso(listo);
      await leer();
    } finally {
      setOcupado(false);
    }
  };
  const escribir = (contenido: Record<string, unknown>) => pedir({ accion: 'escribir', nombre, contenido });
  const mandar = (e: React.FormEvent) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || ocupado) return;
    setTexto('');
    void escribir({ tipo: 'texto', texto: t });
  };

  const cuenta = estado.cuentas.find((c) => c.idPublico === bot) ?? null;
  const ultimoInteractivo = [...estado.mensajes].reverse().find((m) => m.sentido === 'para' && m.mensaje.type === 'interactive')?.id;
  const ventana = estado.conversacion?.ventanaHasta ? new Date(estado.conversacion.ventanaHasta) : null;
  const ventanaAbierta = !!ventana && ventana.getTime() > Date.now();

  return (
    <main className="tel-pagina">
      <section className="tel" aria-label="Teléfono de prueba">
        <header className="tel__cabecera">
          <div className="tel__nombre">{cuenta ? cuenta.nombre : 'Sin bots con WhatsApp'}</div>
          <div className="tel__sub">{cuenta?.numero ?? '—'} · WhatsApp (360dialog simulado)</div>
        </header>
        <div className="tel__mensajes" role="log" aria-live="polite">
          {estado.mensajes.length ? null : <p className="tel__vacio">Escribí algo para empezar la conversación con el bot.</p>}
          {estado.mensajes.map((m) => {
            const propio = m.sentido === 'de';
            const cuerpo = m.mensaje.type === 'entrante' ? m.mensaje.texto : m.mensaje.type === 'text' ? m.mensaje.text.body : m.mensaje.type === 'interactive' ? m.mensaje.interactive.body.text : m.textoPlantilla ?? '[plantilla]';
            const inter = m.mensaje.type === 'interactive' ? m.mensaje.interactive : null;
            const activo = m.id === ultimoInteractivo;
            return (
              <div key={m.id} className={`tel__burbuja${propio ? ' tel__burbuja--propia' : ''}${m.mensaje.type === 'template' ? ' tel__burbuja--plantilla' : ''}`}>
                {m.mensaje.type === 'template' ? <div className="tel__etiqueta">Plantilla</div> : null}
                <div className="tel__texto">{cuerpo}</div>
                <div className="tel__hora">{hora(m.hora)} UTC</div>
                {inter?.type === 'button' ? (
                  <div className="tel__botones">
                    {inter.action.buttons.map((b) => (
                      <button key={b.reply.id} type="button" className="tel__boton" disabled={ocupado || !activo} onClick={() => void escribir({ tipo: 'boton', id: b.reply.id, titulo: b.reply.title })}>{b.reply.title}</button>
                    ))}
                  </div>
                ) : null}
                {inter?.type === 'list' ? (
                  <div className="tel__botones">
                    <button type="button" className="tel__boton" disabled={ocupado || !activo} aria-expanded={listaAbierta === m.id} onClick={() => setListaAbierta(listaAbierta === m.id ? null : m.id)}>{inter.action.button}</button>
                    {listaAbierta === m.id && activo ? (
                      <ul className="tel__lista">
                        {inter.action.sections.flatMap((s) => s.rows).map((f) => (
                          <li key={f.id}>
                            <button type="button" className="tel__fila" disabled={ocupado} onClick={() => { setListaAbierta(null); void escribir({ tipo: 'fila', id: f.id, titulo: f.title }); }}>
                              <span>{f.title}</span>{f.description ? <span className="tel__desc">{f.description}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div ref={fin} />
        </div>
        {aviso ? <div className="tel__aviso" role="alert">{aviso}</div> : null}
        <form className="tel__entrada" onSubmit={mandar}>
          <input className="tel__campo" aria-label="Mensaje" placeholder="Mensaje" value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)} disabled={!cuenta} />
          <button type="submit" className="tel__enviar" disabled={ocupado || !texto.trim() || !cuenta}>Enviar</button>
        </form>
      </section>

      <aside className="tel-controles" aria-label="Controles de la demo">
        <h1>Teléfono de prueba</h1>
        <p>Solo en la demo. Escribe al WhatsApp del bot como una persona; el mensaje pasa por el 360dialog simulado y llega a la bandeja como una conversación de WhatsApp.</p>
        <label className="tel-campo">
          <span>Bot</span>
          <select value={bot ?? ''} onChange={(e) => { setBot(e.target.value); cuantos.current = 0; }}>
            {estado.cuentas.map((c) => <option key={c.idPublico} value={c.idPublico}>{c.nombre} ({c.numero ?? 'sin número'})</option>)}
          </select>
        </label>
        <label className="tel-campo">
          <span>Número de la persona</span>
          <input value={telefono} onChange={(e) => { setTelefono(e.target.value); cuantos.current = 0; }} inputMode="tel" />
        </label>
        <label className="tel-campo">
          <span>Nombre de perfil de WhatsApp</span>
          <input value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <dl className="tel-datos">
          <div><dt>Canal</dt><dd>{cuenta ? (cuenta.revocada ? 'clave revocada' : cuenta.estado) : '—'}</dd></div>
          <div><dt>Conversación</dt><dd>{estado.conversacion?.estado ?? 'sin empezar'}</dd></div>
          <div><dt>Ventana de 24 horas</dt><dd>{ventana ? (ventanaAbierta ? `abierta hasta ${ventana.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'cerrada: solo plantillas') : '—'}</dd></div>
        </dl>
        <div className="tel-acciones">
          <button type="button" disabled={ocupado || !cuenta} onClick={() => void escribir({ tipo: 'audio' })}>Mandar un audio</button>
          <button type="button" disabled={ocupado || !cuenta} onClick={() => void escribir({ tipo: 'imagen' })}>Mandar una foto</button>
          <button type="button" disabled={ocupado || !cuenta} onClick={() => void pedir({ accion: 'reintentar' }, '360dialog reenvió el último mensaje: BotMaker lo descartó por repetido (mirá la salud del canal).')}>Reenviar el último (reintento)</button>
          <button type="button" disabled={ocupado || !estado.conversacion} onClick={() => void pedir({ accion: 'cerrar_ventana' }, 'Listo: para la demo pasaron 24 horas. La bandeja solo deja escribir con una plantilla.')}>Que pasen 24 horas</button>
          <button type="button" disabled={ocupado || !cuenta} onClick={() => void pedir({ accion: 'revocar', revocada: !cuenta?.revocada }, cuenta?.revocada ? 'La clave vuelve a valer. Reconectá el canal en Canales.' : 'La clave dejó de valer: el próximo mensaje del bot no sale y el canal queda desconectado.')}>{cuenta?.revocada ? 'Devolver la clave' : 'Revocar la clave (360dialog)'}</button>
          <button type="button" disabled={ocupado || !cuenta} onClick={() => void pedir({ accion: 'decidir_plantillas' }, 'Meta decidió las plantillas en revisión (se aprueban, salvo las que empiezan con rechazar_).')}>Que Meta decida las plantillas</button>
        </div>
      </aside>
    </main>
  );
}
