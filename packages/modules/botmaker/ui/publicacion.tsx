/** Publicación: lo publicado, los requisitos del borrador, el pedido pendiente y el historial. Solo dibuja VistaPublicacion. */
import { Caja } from '@campaignsuite/ui';
import { pausarBot } from '../acciones/bandeja';
import { pedirPublicacion, resolverPublicacion } from '../acciones/publicacion';
import type { Diferencia } from '../dominio/diferencias';
import type { VistaPublicacion } from '../vistas/publicacion';
import { EncabezadoBot } from './encabezado-bot';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';

const TIPO: Record<Diferencia['tipo'], { texto: string; clase: string }> = {
  agregado: { texto: 'Agrega', clase: 'est-bien' },
  quitado: { texto: 'Quita', clase: 'est-critico' },
  cambiado: { texto: 'Cambia', clase: 'est-atencion' },
};

function Cambios({ cambios, vacio }: { cambios: Diferencia[]; vacio: string }) {
  if (!cambios.length) return <p className="texto-chico apagado">{vacio}</p>;
  const lista = (xs: Diferencia[]) => (
    <ul className="bots-diferencias">
      {xs.map((d, i) => (
        <li key={i}>
          <span className={`bots-diferencia__tipo ${TIPO[d.tipo].clase}`}>{TIPO[d.tipo].texto}</span>{' '}
          <strong>{d.parte === 'caja' ? d.donde : `${d.parte} ${d.donde}`}</strong>{d.detalle ? ` · ${d.detalle}` : ''}
        </li>
      ))}
    </ul>
  );
  if (cambios.length <= 12) return lista(cambios);
  return (
    <>
      {lista(cambios.slice(0, 12))}
      <details className="bots-fila-detalle">
        <summary>Ver los otros {cambios.length - 12} cambios</summary>
        {lista(cambios.slice(12))}
      </details>
    </>
  );
}

export function PantallaPublicacion({ v }: { v: VistaPublicacion }) {
  return (
    <>
      <EncabezadoBot e={v.encabezado} bajada="Publicar lleva dos pasos: el editor pide publicar el borrador probado y el administrador revisa los cambios y lo aprueba o lo devuelve con un comentario." />
      <MensajeAccion m={v.mensaje} />

      <Caja titulo="Lo que está publicado" nota={v.publicada ? `acierto de intenciones: ${v.publicada.acierto}` : undefined} accion={v.publicada ? { texto: 'Probarla en el simulador', href: v.publicada.hrefSimular } : undefined}>
        {v.publicada ? (
          <>
            <p className="texto-chico">Versión {v.publicada.numero}: es la que conversa en los canales del bot.{v.pausa?.pausado ? ' El bot está en pausa: no contesta y lo que llega va a la bandeja.' : ''}</p>
            {v.pausa?.puede ? (
              <form action={pausarBot}>
                <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId, pausar: v.pausa.pausado ? 'no' : 'si' }} />
                <button type="submit" className="boton boton--sec boton--chico">{v.pausa.pausado ? 'Reanudar el bot' : 'Pausar el bot'}</button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="texto-chico apagado">Este bot todavía no tiene una versión publicada.</p>
        )}
      </Caja>

      {v.pedida ? (
        <Caja titulo={`Pedido de publicación: versión ${v.pedida.numero}`} nota={`lo pidió ${v.pedida.pidio} el ${v.pedida.fecha} (UTC)`} accion={v.pedida.hrefCorrida ? { texto: 'Ver la corrida', href: v.pedida.hrefCorrida } : undefined}>
          {v.pedida.nota ? <blockquote className="bots-nota">{v.pedida.nota}</blockquote> : null}
          {v.pedida.corrida.length ? (
            <div className="bots-resumen">
              {v.pedida.corrida.map((r) => (
                <div key={r.etiqueta} className="kpi"><div className="kpi__etiqueta">{r.etiqueta}</div><div className="kpi__numero">{r.valor}</div>{r.nota ? <div className="kpi__nota">{r.nota}</div> : null}</div>
              ))}
            </div>
          ) : null}
          <h3 className="bots-subtitulo">Qué cambia contra lo publicado</h3>
          <Cambios cambios={v.pedida.cambios} vacio="No cambia nada contra lo publicado." />
          {v.pedida.puedeResolver ? (
            <form action={resolverPublicacion} className="pila bots-form">
              <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId, versionId: v.pedida.versionId }} />
              <div className="campo">
                <label htmlFor="pub-nota">Comentario (obligatorio para devolver)</label>
                <textarea id="pub-nota" name="nota" className="entrada" rows={3} maxLength={2000} />
              </div>
              <div className="fila">
                <button type="submit" name="decision" value="aprobar" className="boton">Aprobar y publicar</button>
                <button type="submit" name="decision" value="devolver" className="boton boton--sec">Devolver con el comentario</button>
              </div>
            </form>
          ) : (
            <SoloLectura>Lo aprueba o lo devuelve el administrador de BotMaker de la campaña.</SoloLectura>
          )}
        </Caja>
      ) : null}

      {v.sinBorrador && !v.pedida ? <div className="aviso" role="status">Este bot no tiene borrador. <a href={v.sinBorrador.hrefFlujos}>Armalo en Flujos</a>.</div> : null}

      {v.borrador ? (
        <Caja titulo={`Borrador v${v.borrador.numero}`} nota={v.borrador.listo ? 'listo para pedir publicar' : 'le falta algo para pedir publicar'}>
          <ul className="bots-requisitos">
            {v.borrador.requisitos.map((r) => (
              <li key={r.texto} className="bots-requisito">
                <span className={r.ok ? 'est-bien' : 'est-critico'} aria-hidden="true">{r.ok ? '✓' : '✗'}</span>
                <span><span className="oculto-visual">{r.ok ? 'Cumple: ' : 'Falta: '}</span>{r.texto} <span className="apagado">({r.detalle})</span>{r.href ? <> · <a href={r.href}>Ver</a></> : null}</span>
              </li>
            ))}
          </ul>
          <h3 className="bots-subtitulo">Qué cambia contra lo publicado</h3>
          <Cambios cambios={v.borrador.cambios} vacio="No cambia nada contra lo publicado." />
          {v.borrador.puedePedir ? (
            <form action={pedirPublicacion} className="pila bots-form">
              <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId, seq: String(v.seq) }} />
              <div className="campo">
                <label htmlFor="pub-pedido">Nota para quien aprueba (opcional)</label>
                <textarea id="pub-pedido" name="nota" className="entrada" rows={3} maxLength={2000} placeholder="Qué cambió y por qué" />
              </div>
              <div className="fila"><button type="submit" className="boton">Pedir publicar</button></div>
            </form>
          ) : v.editable ? null : (
            <SoloLectura>Piden publicar el editor y el administrador de BotMaker.</SoloLectura>
          )}
        </Caja>
      ) : null}

      <Caja titulo="Historial" nota="pedidos, aprobaciones y devoluciones">
        {v.eventos.length ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Fecha (UTC)</th><th>Qué</th><th>Versión</th><th>Quién</th><th>Comentario</th></tr></thead>
              <tbody>
                {v.eventos.map((e, i) => (
                  <tr key={i}><td className="num">{e.fecha}</td><td>{e.accion}</td><td>{e.version}</td><td>{e.quien}</td><td className="texto-chico">{e.nota || <span className="apagado">—</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="texto-chico apagado">Todavía no hubo pedidos.</p>}
        <details className="bots-fila-detalle">
          <summary>Versiones ({v.versiones.length})</summary>
          <ul className="bots-diferencias">
            {v.versiones.map((x) => <li key={x.numero}>v{x.numero} · {x.estado}{x.publicada ? ' (la que conversa)' : ''} · creada el {x.fecha} (UTC)</li>)}
          </ul>
        </details>
      </Caja>
    </>
  );
}
