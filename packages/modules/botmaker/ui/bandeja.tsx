/** Bandeja: conversaciones, una conversación con su registro de decisiones, revisión por muestreo y datos de contactos. */
import { Caja, Encabezado, Pestanas } from '@campaignsuite/ui';
import { borrarContacto, cerrarConversacion, devolverConversacion, responderConversacion, revisarRespuesta, tomarConversacion } from '../acciones/bandeja';
import { ResponderConPlantilla } from './whatsapp/responder-plantilla';
import type { VistaBandeja, VistaConversacion, VistaDatosContactos, VistaRevision } from '../vistas/bandeja';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';

type Enlaces = VistaBandeja['enlaces'];

function Navegacion({ e, activa }: { e: Enlaces; activa: 'bandeja' | 'revision' | 'datos' }) {
  const items = [
    { texto: 'Conversaciones', href: e.bandeja, activa: activa === 'bandeja' },
    ...(e.revision ? [{ texto: 'Revisión por muestreo', href: e.revision, activa: activa === 'revision' }] : []),
    ...(e.datos ? [{ texto: 'Datos de contactos', href: e.datos, activa: activa === 'datos' }] : []),
  ];
  return <Pestanas items={items} etiqueta="Partes de la bandeja" />;
}

const CLASE_ESTADO: Record<string, string> = { derivada: 'est-atencion', en_atencion: 'est-bien', bot: 'apagado', cerrada: 'apagado' };

export function PantallaBandeja({ v }: { v: VistaBandeja }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Bandeja" enfasis="de conversaciones" bajada="Las conversaciones de los bots de la campaña. Las derivadas esperan a alguien del equipo; en cada una se ve por qué el bot contestó lo que contestó. Horas en UTC." />
      <Navegacion e={v.enlaces} activa="bandeja" />
      <MensajeAccion m={v.mensaje} />
      {v.alertas.length ? (
        <div className="aviso aviso--error" role="alert">
          <strong>{v.alertas.length === 1 ? 'Una alerta abierta' : `${v.alertas.length} alertas abiertas`}:</strong>{' '}
          {v.alertas.map((a, i) => (
            <span key={i}>{i ? ' · ' : ''}{a.href ? <a href={a.href}>{a.texto}</a> : a.texto} ({a.bot}, desde {a.desde})</span>
          ))}
        </div>
      ) : null}
      <div className="bots-conteos">
        {v.conteos.map((c) => <a key={c.estado} href={c.href} className="bots-conteo"><span className="bots-conteo__n">{c.n}</span><span className="texto-chico">{c.texto}</span></a>)}
      </div>
      <Caja titulo="Conversaciones">
        <form method="get" className="bots-filtros">
          <label className="campo"><span className="campo__etiqueta">Bot</span>
            <select name="bot" className="entrada" defaultValue={v.filtros.bot}><option value="">Todos</option>{v.opcionesBot.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Estado</span>
            <select name="estado" className="entrada" defaultValue={v.filtros.estado}><option value="">Todos</option>{v.opcionesEstado.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Contacto</span>
            <input name="buscar" className="entrada" defaultValue={v.filtros.buscar} placeholder="Nombre o dato" maxLength={80} />
          </label>
          {v.puedeAtender ? <label className="bots-opcion texto-chico"><input type="checkbox" name="mias" value="si" defaultChecked={v.filtros.mias} /> <span>Solo las mías</span></label> : null}
          <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Filtrar</button></div>
        </form>
        {v.filas.length ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Contacto</th><th>Bot</th><th>Canal</th><th>Estado</th><th>Último mensaje</th><th>Fecha (UTC)</th><th>Atiende</th></tr></thead>
              <tbody>
                {v.filas.map((f) => (
                  <tr key={f.id}>
                    <td><a href={f.href}>{f.contacto}</a>{f.alerta ? <span className="texto-mini est-critico"> · sin respuesta</span> : null}</td>
                    <td>{f.bot}</td><td>{f.canal}</td>
                    <td><span className={CLASE_ESTADO[f.estado]}>{f.estadoTexto}</span></td>
                    <td className="texto-chico">{f.ultimoAutor ? <span className="apagado">{f.ultimoAutor}: </span> : null}{f.ultimo}</td>
                    <td className="num">{f.fecha}</td>
                    <td>{f.asignada ?? <span className="apagado">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="texto-chico apagado">No hay conversaciones con esos filtros.</p>}
      </Caja>
    </>
  );
}

export function PantallaConversacion({ v }: { v: VistaConversacion }) {
  const ocultos = <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ conversacionId: v.id }} />;
  return (
    <>
      <Encabezado ceja={<a href={v.enlaces.bandeja}>Bandeja</a>} titulo={v.contacto.nombre} enfasis={`· ${v.bot.nombre}`} bajada={`${v.contacto.canal} · empezó el ${v.iniciada} · ${v.estadoTexto}${v.asignada ? `, atiende ${v.asignada}` : ''}`} />
      <MensajeAccion m={v.mensaje} />
      <div className="bots-conversacion">
        <Caja titulo="Mensajes" className="bots-conversacion__mensajes">
          <ol className="bots-hilo">
            {v.mensajes.map((m) => (
              <li key={m.n} className={`bots-hilo__mensaje bots-hilo__mensaje--${m.autor}`}>
                <div className="texto-mini apagado">{m.quien} · {m.fecha}{m.muestra ? ' · en la muestra' : ''}{m.plantilla ? ` · plantilla ${m.plantilla}` : ''}</div>
                <div className="bots-hilo__texto">{m.texto ?? <span className="apagado">(texto borrado)</span>}</div>
                {m.envio ? <div className={`bots-envio${m.envio.estado === 'fallido' ? ' bots-envio--fallido' : ''}`}>WhatsApp: {m.envio.texto}</div> : null}
                {m.opciones.length ? <div className="texto-mini apagado">Opciones: {m.opciones.join(' · ')}</div> : null}
                {m.decision ? (
                  <details className="bots-hilo__decision">
                    <summary className="texto-mini">Por qué contestó esto</summary>
                    <dl className="bots-decision">{m.decision.map((d) => <div key={d.etiqueta}><dt>{d.etiqueta}</dt><dd>{d.valor}</dd></div>)}</dl>
                  </details>
                ) : null}
              </li>
            ))}
          </ol>
          {v.whatsapp ? <div className={`bots-ventana${v.whatsapp.ventanaAbierta ? '' : ' bots-ventana--cerrada'}`} role="status">{v.whatsapp.ventanaTexto}</div> : null}
          {v.acciones.plantilla && v.whatsapp ? <ResponderConPlantilla ocultos={ocultos} plantillas={v.whatsapp.plantillas} hrefPlantillas={v.whatsapp.hrefPlantillas} /> : null}
          {v.acciones.responder ? (
            <form action={responderConversacion} className="pila bots-form">
              {ocultos}
              <div className="campo">
                <label htmlFor="bandeja-respuesta">Responder como la campaña</label>
                <textarea id="bandeja-respuesta" name="texto" className="entrada" rows={3} maxLength={4096} required />
              </div>
              <div className="fila"><button type="submit" className="boton">Enviar</button></div>
            </form>
          ) : null}
        </Caja>
        <div className="pila">
          <Caja titulo="Contacto">
            <dl className="bots-decision">
              {v.contacto.datos.map((d) => <div key={d.etiqueta}><dt>{d.etiqueta}</dt><dd>{d.valor}</dd></div>)}
              <div><dt>Condiciones</dt><dd>{v.contacto.condiciones}</dd></div>
            </dl>
            {v.contacto.borrado ? <p className="texto-mini apagado">Sus datos se borraron a pedido.</p> : <p className="texto-mini"><a href={v.contacto.hrefFicha}>Su ficha en la base de contactos</a>: todas sus conversaciones y lo que consultó.</p>}
          </Caja>
          <Caja titulo="Atención" nota={v.derivacion ?? undefined}>
            {v.motivoSinAcciones ? <SoloLectura>{v.motivoSinAcciones}</SoloLectura> : (
              <div className="pila">
                {v.acciones.tomar ? <form action={tomarConversacion}>{ocultos}<button type="submit" className="boton boton--chico">{v.estado === 'bot' ? 'Tomar (el bot deja de contestar)' : 'Tomar la conversación'}</button></form> : null}
                {v.acciones.devolver ? <form action={devolverConversacion}>{ocultos}<button type="submit" className="boton boton--sec boton--chico">Devolver al bot</button></form> : null}
                {v.acciones.cerrar ? <form action={cerrarConversacion}>{ocultos}<button type="submit" className="boton boton--sec boton--chico">Cerrar</button></form> : null}
                <p className="texto-mini apagado">Mientras la atiende el equipo, el bot no contesta en esta conversación.</p>
              </div>
            )}
            <p className="texto-mini"><a href={v.bot.href}>Ver el bot</a></p>
          </Caja>
        </div>
      </div>
    </>
  );
}

export function PantallaRevision({ v }: { v: VistaRevision }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Revisión" enfasis="por muestreo" bajada="Las respuestas con base que entraron en la muestra: todas las de la primera semana de cada bot publicado y el 20 % después. Una correcta se puede convertir en contenido fijo del borrador." />
      <Navegacion e={v.enlaces} activa="revision" />
      <MensajeAccion m={v.mensaje} />
      <Caja titulo={v.soloPendientes ? 'Para revisar' : 'Todas'} accion={v.soloPendientes ? { texto: 'Ver también las revisadas', href: v.hrefTodas } : { texto: 'Ver solo las pendientes', href: v.hrefPendientes }}>
        {v.filas.length ? (
          <ul className="bots-muestra">
            {v.filas.map((f) => (
              <li key={`${f.conversacion}-${f.n}`} className="bots-muestra__item">
                <div className="texto-mini apagado">{f.bot} · {f.fecha} · secciones {f.secciones} · <a href={f.href}>ver la conversación</a></div>
                <p className="texto-chico"><strong>Pregunta:</strong> {f.pregunta}</p>
                <p className="texto-chico"><strong>Respuesta:</strong> {f.respuesta}</p>
                {f.veredicto ? (
                  <p className="texto-mini">{f.veredicto}{f.convertida ? ', convertida en contenido' : ''}{f.revisadaPor ? ` · ${f.revisadaPor}` : ''}</p>
                ) : v.puedeRevisar ? (
                  <div className="fila">
                    {([['correcta', 'no', 'Correcta'], ['correcta', 'si', 'Correcta y convertir en contenido'], ['incorrecta', 'no', 'Incorrecta']] as const).map(([veredicto, convertir, texto]) => (
                      <form key={texto} action={revisarRespuesta}>
                        <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ conversacionId: f.conversacion, n: String(f.n), veredicto, convertir }} />
                        <button type="submit" className={`boton boton--chico${veredicto === 'incorrecta' ? ' boton--sec' : ''}`}>{texto}</button>
                      </form>
                    ))}
                  </div>
                ) : <SoloLectura>Revisan el editor y el administrador.</SoloLectura>}
              </li>
            ))}
          </ul>
        ) : <p className="texto-chico apagado">{v.soloPendientes ? 'No hay respuestas para revisar.' : 'Todavía no hay respuestas en la muestra.'}</p>}
      </Caja>
    </>
  );
}

export function PantallaDatosContactos({ v }: { v: VistaDatosContactos }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Datos" enfasis="de contactos" bajada="Cuando una persona lo pide expresamente, el administrador busca, exporta o borra sus datos. El bot no lo ofrece. Cada paso queda registrado, sin el dato." />
      <Navegacion e={v.enlaces} activa="datos" />
      <MensajeAccion m={v.mensaje} />
      <Caja titulo="Buscar un contacto">
        <form method="get" className="bots-filtros">
          <label className="campo"><span className="campo__etiqueta">Nombre, dato o texto de un mensaje</span><input name="buscar" className="entrada" defaultValue={v.buscar} minLength={2} maxLength={80} required /></label>
          <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Buscar</button></div>
        </form>
        {v.resultados === null ? null : v.resultados.length ? (
          <ul className="bots-muestra">
            {v.resultados.map((r) => (
              <li key={r.id} className="bots-muestra__item">
                <p className="texto-chico"><strong>{r.nombre}</strong> · {r.canal} · {r.conversaciones} {r.conversaciones === 1 ? 'conversación' : 'conversaciones'} · última {r.ultima}</p>
                <p className="texto-mini apagado">{r.datos}</p>
                <div className="fila">
                  <a className="boton boton--sec boton--chico" href={r.hrefExportar}>Exportar (JSON)</a>
                </div>
                {v.puedeBorrar ? (
                  <details className="bots-fila-detalle">
                    <summary className="texto-chico">Borrar sus datos</summary>
                    <form action={borrarContacto} className="pila bots-form">
                      <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ contactoId: r.id }} />
                      <div className="campo"><label htmlFor={`nota-${r.id}`}>Cómo lo pidió (sin datos personales)</label><input id={`nota-${r.id}`} name="nota" className="entrada" maxLength={500} /></div>
                      <div className="campo"><label htmlFor={`confirmar-${r.id}`}>Escribí BORRAR para confirmar</label><input id={`confirmar-${r.id}`} name="confirmar" className="entrada" required autoComplete="off" /></div>
                      <p className="texto-mini apagado">Se borran el nombre, los datos y el texto de todos sus mensajes. No se puede deshacer. Quedan los eventos de analítica, que no tienen textos.</p>
                      <div className="fila"><button type="submit" className="boton boton--chico">Borrar los datos</button></div>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="texto-chico apagado">No hay contactos que coincidan.</p>}
      </Caja>
      <Caja titulo="Registro de pedidos">
        {v.pedidos.length ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Fecha (UTC)</th><th>Qué</th><th>Contacto</th><th>Quién</th><th>Nota</th></tr></thead>
              <tbody>{v.pedidos.map((p, i) => <tr key={i}><td className="num">{p.fecha}</td><td>{p.tipo}</td><td className="texto-mini">{p.contacto}</td><td>{p.quien}</td><td className="texto-chico">{p.nota || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="texto-chico apagado">Todavía no hubo pedidos.</p>}
      </Caja>
    </>
  );
}
