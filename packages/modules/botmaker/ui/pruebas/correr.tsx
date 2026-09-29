'use client';
/**
 * Correr las pruebas desde el navegador: empieza la corrida y pide tandas hasta terminar, con el avance a la vista. Si
 * se cierra la pestaña, la corrida queda en curso y se sigue desde acá donde quedó.
 */
import { useRef, useState } from 'react';
import { avanzarCorrida, cancelarCorrida, iniciarCorrida } from '../../acciones/pruebas';
import type { VistaPruebas } from '../../vistas/pruebas';
import { textoError } from '../../vistas/mensajes';

export function CorrerPruebas({ v, hrefCorridas }: { v: Pick<VistaPruebas, 'campanaId' | 'botId' | 'opcionesMotores' | 'motoresBot' | 'enCurso' | 'casos'>; hrefCorridas: string }) {
  const hrefCorrida = (id: string) => `${hrefCorridas}/${encodeURIComponent(id)}`;
  const [modo, setModo] = useState<'bot' | 'otros'>('bot');
  const [interpretar, setInterpretar] = useState(v.motoresBot.interpretar);
  const [responder, setResponder] = useState(v.motoresBot.responder);
  const [estado, setEstado] = useState<{ id: string; hechos: number; total: number; terminada: boolean } | null>(v.enCurso ? { ...v.enCurso, terminada: false } : null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parar = useRef(false);

  const seguir = async (id: string, total: number) => {
    setCorriendo(true);
    parar.current = false;
    for (;;) {
      if (parar.current) break;
      const r = await avanzarCorrida({ campanaId: v.campanaId, corridaId: id });
      if (r.tipo !== 'ok') {
        setError(textoError(r.codigo));
        break;
      }
      setEstado({ id, hechos: r.hechos ?? 0, total: r.total ?? total, terminada: !!r.terminada });
      if (r.terminada) break;
    }
    setCorriendo(false);
  };

  const empezar = async () => {
    setError(null);
    const motores = modo === 'bot' ? null : {
      interpretar: { principal: interpretar.principal, respaldo: interpretar.respaldo || null, dobleLectura: interpretar.doble && !!interpretar.respaldo },
      responder: { principal: responder.principal, respaldo: responder.respaldo || null },
    };
    const r = await iniciarCorrida({ campanaId: v.campanaId, botId: v.botId, motores });
    if (r.tipo !== 'ok' || !r.corridaId) return setError(textoError(r.codigo));
    setEstado({ id: r.corridaId, hechos: 0, total: r.total ?? 0, terminada: false });
    await seguir(r.corridaId, r.total ?? 0);
  };

  const opciones = (xs: { valor: string; texto: string }[], vacio?: string) => (
    <>
      {vacio !== undefined ? <option value="">{vacio}</option> : null}
      {xs.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </>
  );
  const pct = estado && estado.total ? Math.round((100 * estado.hechos) / estado.total) : 0;

  return (
    <div className="pila">
      <fieldset className="bots-opciones">
        <legend className="campo__etiqueta">Con qué motores</legend>
        <label className="bots-opcion"><input type="radio" name="modo" checked={modo === 'bot'} onChange={() => setModo('bot')} /> <span>Los del bot (lo que se va a publicar)</span></label>
        <label className="bots-opcion"><input type="radio" name="modo" checked={modo === 'otros'} onChange={() => setModo('otros')} /> <span>Otra combinación, para comparar</span></label>
      </fieldset>
      {modo === 'otros' ? (
        <div className="grilla-2">
          <div className="pila">
            <div className="mayus apagado">Interpretar</div>
            <select className="entrada" aria-label="Interpretar: principal" value={interpretar.principal} onChange={(e) => setInterpretar({ ...interpretar, principal: e.target.value })}>{opciones(v.opcionesMotores.interpretar)}</select>
            <select className="entrada" aria-label="Interpretar: respaldo" value={interpretar.respaldo} onChange={(e) => setInterpretar({ ...interpretar, respaldo: e.target.value })}>{opciones(v.opcionesMotores.interpretar, 'Sin respaldo')}</select>
            <label className="texto-chico"><input type="checkbox" checked={interpretar.doble} onChange={(e) => setInterpretar({ ...interpretar, doble: e.target.checked })} /> Doble lectura</label>
          </div>
          <div className="pila">
            <div className="mayus apagado">Responder con base</div>
            <select className="entrada" aria-label="Responder: principal" value={responder.principal} onChange={(e) => setResponder({ ...responder, principal: e.target.value })}>{opciones(v.opcionesMotores.responder)}</select>
            <select className="entrada" aria-label="Responder: respaldo" value={responder.respaldo} onChange={(e) => setResponder({ ...responder, respaldo: e.target.value })}>{opciones(v.opcionesMotores.responder, 'Sin respaldo')}</select>
          </div>
        </div>
      ) : null}
      {estado ? (
        <div className="pila" role="status">
          <div className="bots-avance" aria-label={`Avance: ${estado.hechos} de ${estado.total}`}><div className="bots-avance__relleno" style={{ width: `${pct}%` }} /></div>
          <div className="fila texto-chico">
            <span>{estado.terminada ? 'Terminó' : corriendo ? 'Corriendo' : 'En pausa'}: {estado.hechos} de {estado.total} casos.</span>
            {estado.terminada ? <a href={hrefCorrida(estado.id)}>Ver el resultado</a> : null}
            {!estado.terminada && !corriendo ? <button type="button" className="boton boton--chico" onClick={() => seguir(estado.id, estado.total)}>Seguir</button> : null}
            {!estado.terminada && corriendo ? <button type="button" className="boton boton--sec boton--chico" onClick={() => { parar.current = true; }}>Pausar</button> : null}
            {!estado.terminada && !corriendo ? <button type="button" className="boton boton--sec boton--chico" onClick={async () => { await cancelarCorrida({ campanaId: v.campanaId, corridaId: estado.id }); setEstado(null); }}>Cancelar la corrida</button> : null}
          </div>
          {corriendo ? <span className="texto-mini apagado">No cierres esta pestaña mientras corre: si la cerrás, queda en pausa y se sigue desde acá.</span> : null}
        </div>
      ) : null}
      {error ? <div className="aviso aviso--error" role="alert">{error}</div> : null}
      {!estado || estado.terminada ? (
        <div className="fila">
          <button type="button" className="boton" disabled={corriendo || !v.casos.total} onClick={empezar}>Correr las pruebas ({v.casos.total} casos)</button>
        </div>
      ) : null}
    </div>
  );
}
