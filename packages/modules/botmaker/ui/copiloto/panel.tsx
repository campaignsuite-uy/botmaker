'use client';
/**
 * El copiloto en el navegador: elegir qué pedir, escribir el pedido, ver la propuesta operación por operación y aplicar
 * las marcadas (un solo cambio del borrador, que se deshace entero). Después de aplicar, la página se recarga.
 */
import { useState, useTransition } from 'react';
import { aplicarCopiloto, pedirCopiloto } from '../../acciones/copiloto';
import type { ResultadoCopiloto } from '../../acciones/ejecutar-copiloto';
import type { VistaCopiloto } from '../../vistas/copiloto';
import { textoError } from '../../vistas/mensajes';

type Propuesta = Extract<ResultadoCopiloto, { ok: true }>;

const usd = (x: number) => (x === 0 ? 'USD 0' : x < 0.0001 ? 'menos de USD 0,0001' : `USD ${x.toFixed(4).replace('.', ',')}`);

export function PanelCopiloto({ v }: { v: Pick<VistaCopiloto, 'campanaId' | 'botId' | 'modos' | 'secciones' | 'hrefMaterial'> }) {
  const [modo, setModo] = useState(v.modos[0]!.id);
  const [pedido, setPedido] = useState('');
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const actual = v.modos.find((m) => m.id === modo)!;

  const pedir = () => {
    setError(null);
    setAplicado(null);
    iniciar(async () => {
      const r = await pedirCopiloto({ campanaId: v.campanaId, botId: v.botId, modo, pedido });
      if (!r.ok) {
        setError(textoError(r.codigo));
        return;
      }
      setPropuesta(r);
      setMarcadas(new Set(r.items.filter((i) => i.operacion).map((i) => i.indice)));
    });
  };

  const aplicar = () => {
    if (!propuesta) return;
    setError(null);
    const ops = propuesta.items.filter((i) => i.operacion && marcadas.has(i.indice)).map((i) => i.operacion);
    iniciar(async () => {
      const r = await aplicarCopiloto({ campanaId: v.campanaId, botId: v.botId, seq: propuesta.seq, operaciones: ops });
      if (!r.ok) {
        setError(r.mensaje ?? textoError(r.codigo));
        return;
      }
      setAplicado(r.resumen);
      setPropuesta(null);
      // Recarga la pantalla con el aviso: así se ven la barra de deshacer y el historial al día.
      window.location.assign(`${window.location.pathname}?ok=copiloto_aplicado`);
    });
  };

  const alternar = (i: number) => setMarcadas((m) => {
    const n = new Set(m);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const aplicables = propuesta?.items.filter((i) => i.operacion) ?? [];

  return (
    <div className="pila">
      <fieldset className="bots-opciones" disabled={ocupado}>
        <legend className="campo__etiqueta">Qué pedirle</legend>
        {v.modos.map((m) => (
          <label key={m.id} className="bots-opcion">
            <input type="radio" name="modo" value={m.id} checked={modo === m.id} onChange={() => setModo(m.id)} /> <span>{m.titulo}</span>
          </label>
        ))}
      </fieldset>
      <p className="texto-chico apagado">{actual.ayuda}{modo === 'armar' && !v.secciones ? <> El bot todavía no tiene material: <a href={v.hrefMaterial}>cargalo en Material</a> para que el copiloto arme con eso.</> : null}</p>
      <div className="campo">
        <label htmlFor="copiloto-pedido">Pedido</label>
        <textarea id="copiloto-pedido" className="entrada" rows={4} maxLength={4000} value={pedido} placeholder={actual.ejemplo} onChange={(e) => setPedido(e.target.value)} />
        <span className="texto-mini apagado">Las cajas se nombran por su dirección: 2.4, o 2.4 › B para una opción.</span>
      </div>
      <div className="fila">
        <button type="button" className="boton" onClick={pedir} disabled={ocupado || !pedido.trim()}>{ocupado && !propuesta ? 'Pensando…' : 'Pedir al copiloto'}</button>
        {!pedido.trim() ? <button type="button" className="boton boton--sec boton--chico" onClick={() => setPedido(actual.ejemplo)} disabled={ocupado}>Usar el ejemplo</button> : null}
      </div>
      {error ? <p className="aviso aviso--error" role="alert">{error}</p> : null}
      {aplicado ? <p className="aviso aviso--ok" role="status">Aplicado: {aplicado}. Se deshace con Deshacer, arriba.</p> : null}

      {propuesta ? (
        <section className="bots-copiloto" aria-label="Propuesta del copiloto">
          <p className="texto-chico">{propuesta.explicacion || 'Propuesta del copiloto.'}</p>
          <p className="texto-mini apagado">
            {propuesta.simulado ? 'Motor simulado' : propuesta.motor ?? 'Motor'} · {usd(propuesta.costoUsd)} · {(propuesta.demoraMs / 1000).toFixed(1).replace('.', ',')} s
            {propuesta.materialRecortado ? ' · el material era muy largo: fue una parte' : ''}
          </p>
          {propuesta.dudas.length ? (
            <div>
              <h3 className="bots-subtitulo">Dudas y sugerencias</h3>
              <ul className="bots-diferencias">{propuesta.dudas.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          ) : null}
          {propuesta.items.length ? (
            <div>
              <h3 className="bots-subtitulo">Operaciones propuestas ({aplicables.length} de {propuesta.items.length} se pueden aplicar)</h3>
              <ul className="bots-copiloto__items">
                {propuesta.items.map((i) => (
                  <li key={i.indice} className={i.operacion ? 'bots-copiloto__item' : 'bots-copiloto__item bots-copiloto__item--mal'}>
                    <label className="bots-opcion">
                      <input type="checkbox" checked={!!i.operacion && marcadas.has(i.indice)} disabled={!i.operacion || ocupado} onChange={() => alternar(i.indice)} />
                      <span>
                        <strong>{i.resumen || i.tipo}</strong>
                        {i.explicacion ? <span className="texto-chico"> · {i.explicacion}</span> : null}
                        {i.error ? <span className="texto-mini est-critico"> · {i.error}</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="texto-mini apagado">Se aplican juntas y en orden. Si una usa algo que crea otra, van las dos.</p>
              <div className="fila">
                <button type="button" className="boton" onClick={aplicar} disabled={ocupado || !marcadas.size}>Aplicar las {marcadas.size} marcadas</button>
                <button type="button" className="boton boton--sec boton--chico" onClick={() => setPropuesta(null)} disabled={ocupado}>Descartar</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
