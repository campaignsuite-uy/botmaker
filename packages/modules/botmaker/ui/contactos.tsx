/** Base de contactos: la lista con filtros, la ficha de cada contacto y, para el administrador, la descarga. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import { borrarContacto } from '../acciones/bandeja';
import type { VistaContactos, VistaFichaContacto } from '../vistas/contactos';
import { Dato, MensajeAccion, Ocultos } from './piezas';

const CLASE_ESTADO: Record<string, string> = { derivada: 'est-atencion', en_atencion: 'est-bien', bot: 'apagado', cerrada: 'apagado' };

export function PantallaContactos({ v }: { v: VistaContactos }) {
  return (
    <>
      <Encabezado
        ceja="BotMaker" titulo="Base" enfasis="de contactos"
        bajada="Quién le escribió a cada bot, qué datos dio y qué consultó. Lo que consultó queda como temas, consultas y opciones aunque el texto de los mensajes se borre a los días de guardado. Cada bot tiene su base. Horas en UTC."
      />
      <MensajeAccion m={v.mensaje} />
      <Caja titulo="Contactos">
        <form method="get" className="bots-filtros">
          <label className="campo"><span className="campo__etiqueta">Bot</span>
            <select name="bot" className="entrada" defaultValue={v.filtros.bot}><option value="">Todos</option>{v.opcionesBot.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Canal</span>
            <select name="canal" className="entrada" defaultValue={v.filtros.canal}><option value="">Todos</option>{v.opcionesCanal.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Consultó</span>
            <select name="consulta" className="entrada" defaultValue={v.filtros.consulta}>
              <option value="">Cualquier cosa</option>
              {v.filtros.consulta && !v.opcionesConsulta.some((g) => g.opciones.some((o) => o.valor === v.filtros.consulta)) ? <option value={v.filtros.consulta}>{v.consultaElegida}</option> : null}
              {v.opcionesConsulta.map((g) => <optgroup key={g.grupo} label={g.grupo}>{g.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Contacto</span>
            <input name="buscar" className="entrada" defaultValue={v.filtros.buscar} placeholder={v.verNumero ? 'Nombre, dato o número' : 'Nombre o dato'} maxLength={80} />
          </label>
          <div className="fila">
            <button type="submit" className="boton boton--sec boton--chico">Filtrar</button>
            {v.hayFiltro ? <a className="boton boton--sec boton--chico" href={v.hrefLimpiar}>Ver todos</a> : null}
          </div>
        </form>
        <p className="texto-chico apagado" role="status">
          {v.resumen}{v.verNumero ? '' : ' El número de WhatsApp lo ven el administrador y los agentes.'}
        </p>
        {v.filas.length ? (
          <div className="tabla-envoltura">
            <table className="tabla bots-tabla-contactos">
              <thead><tr><th>Contacto</th><th>Bot y canal</th><th>Consultó</th><th>Datos que dio</th><th>Conversaciones</th><th>Última (UTC)</th></tr></thead>
              <tbody>
                {v.filas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <a href={f.href}>{f.nombre}</a>
                      {f.perfil ? <div className="texto-mini apagado">Perfil: {f.perfil}</div> : null}
                      {f.numero ? <div className="texto-mini num">{f.numero}</div> : null}
                    </td>
                    <td className="texto-chico">{f.bot}<div className="texto-mini apagado">{f.canal}</div></td>
                    <td>
                      {f.consultas.length ? (
                        <ul className="bots-chips" aria-label="Lo que consultó">
                          {f.consultas.map((c) => <li key={c.href}><a className={`bots-chip bots-chip--${c.tipo}`} href={c.href} title={c.titulo}>{c.texto}</a></li>)}
                          {f.masConsultas ? <li className="texto-mini apagado">y {f.masConsultas} más</li> : null}
                        </ul>
                      ) : <span className="apagado texto-chico">—</span>}
                    </td>
                    <td className="texto-chico">{f.datos || <span className="apagado">—</span>}</td>
                    <td className="num">{f.conversaciones}<div className="texto-mini apagado">desde {f.primera}</div></td>
                    <td className="num">{f.ultima}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="texto-chico apagado">{v.hayFiltro ? 'No hay contactos con ese filtro.' : 'Todavía nadie le escribió a los bots de la campaña.'}</p>}
        {v.paginas ? (
          <nav className="fila bots-paginas" aria-label="Páginas">
            {v.paginas.anterior ? <a className="boton boton--sec boton--chico" href={v.paginas.anterior}>Anterior</a> : null}
            <span className="texto-chico apagado">{v.paginas.texto}</span>
            {v.paginas.siguiente ? <a className="boton boton--sec boton--chico" href={v.paginas.siguiente}>Siguiente</a> : null}
          </nav>
        ) : null}
      </Caja>
      {v.descarga ? (
        <Caja titulo="Descargar la base">
          <p className="texto-chico">Baja en una planilla (CSV) los contactos que muestra el filtro, con el número, los datos que dieron y lo que consultaron. Queda registrado quién la bajó y cuándo.</p>
          <p className="texto-mini apagado">Tiene datos personales, y lo que consultó cada persona puede mostrar sus preferencias políticas. Guardala donde solo la vea quien la necesita.</p>
          <div className="fila"><a className="boton boton--chico" href={v.descarga.href} download>Descargar (CSV)</a></div>
          {v.descarga.registro.length ? (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead><tr><th>Fecha (UTC)</th><th>Quién</th><th>Bot</th><th>Filtro</th><th>Contactos</th></tr></thead>
                <tbody>{v.descarga.registro.map((r, i) => <tr key={i}><td className="num">{r.fecha}</td><td>{r.quien}</td><td>{r.bot}</td><td className="texto-chico">{r.filtro}</td><td className="num">{r.cantidad}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="texto-mini apagado">Todavía nadie la descargó.</p>}
        </Caja>
      ) : null}
    </>
  );
}

export function PantallaFichaContacto({ v }: { v: VistaFichaContacto }) {
  return (
    <>
      <Encabezado ceja={<a href={v.hrefBase}>Base de contactos</a>} titulo={v.nombre} bajada={v.bajada} />
      <MensajeAccion m={v.mensaje} />
      <div className="bots-conversacion">
        <div className="pila">
          <Caja titulo="Lo que consultó">
            {v.borrado ? <p className="texto-chico apagado">Sus datos se borraron a pedido: no se muestra lo que consultó.</p> : v.consultas.length ? (
              v.consultas.map((g) => (
                <div key={g.tipo} className="bots-consultas">
                  <h3 className="bots-consultas__titulo">{g.tipo}</h3>
                  <ul className="bots-consultas__lista">
                    {g.items.map((k) => (
                      <li key={k.href}><a href={k.href} title="Ver quiénes más lo consultaron">{k.texto}</a> <span className="texto-mini apagado">· {k.veces} · la última el {k.ultima}</span></li>
                    ))}
                  </ul>
                </div>
              ))
            ) : <p className="texto-chico apagado">Todavía no consultó nada que el bot haya reconocido (solo saludó o usó mensajes que no se entendieron).</p>}
          </Caja>
          <Caja titulo="Conversaciones">
            {v.conversaciones.length ? (
              <div className="tabla-envoltura">
                <table className="tabla">
                  <thead><tr><th>Empezó (UTC)</th><th>Estado</th><th>Mensajes</th><th>Última (UTC)</th><th>Atiende</th></tr></thead>
                  <tbody>
                    {v.conversaciones.map((c) => (
                      <tr key={c.href}>
                        <td className="num"><a href={c.href}>{c.iniciada}</a></td>
                        <td><span className={CLASE_ESTADO[c.estado]}>{c.estadoTexto}</span></td>
                        <td className="num">{c.mensajes}</td><td className="num">{c.actualizada}</td>
                        <td>{c.atiende ?? <span className="apagado">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="texto-chico apagado">Sin conversaciones.</p>}
          </Caja>
        </div>
        <div className="pila">
          <Caja titulo="Datos">
            <div className="bots-datos bots-datos--una">
              {v.datos.map((d) => <Dato key={d.etiqueta} etiqueta={d.etiqueta}>{d.valor}</Dato>)}
            </div>
          </Caja>
          {v.pedidos ? (
            <Caja titulo="Si la persona lo pide">
              <p className="texto-mini apagado">Cuando una persona pide expresamente sus datos o que se borren. Cada paso queda registrado en Bandeja › Datos de contactos, sin el dato.</p>
              <div className="fila"><a className="boton boton--sec boton--chico" href={v.pedidos.hrefExportar}>Exportar sus datos (JSON)</a></div>
              {v.pedidos.puedeBorrar ? (
                <details className="bots-fila-detalle">
                  <summary className="texto-chico">Borrar sus datos</summary>
                  <form action={borrarContacto} className="pila bots-form">
                    <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ contactoId: v.id }} />
                    <div className="campo"><label htmlFor="ficha-nota">Cómo lo pidió (sin datos personales)</label><input id="ficha-nota" name="nota" className="entrada" maxLength={500} /></div>
                    <div className="campo"><label htmlFor="ficha-confirmar">Escribí BORRAR para confirmar</label><input id="ficha-confirmar" name="confirmar" className="entrada" required autoComplete="off" /></div>
                    <p className="texto-mini apagado">Se borran el nombre, el número, los datos y el texto de todos sus mensajes, y sale de la base. No se puede deshacer. Quedan los eventos de analítica, que no tienen textos.</p>
                    <div className="fila"><button type="submit" className="boton boton--chico">Borrar los datos</button></div>
                  </form>
                </details>
              ) : null}
            </Caja>
          ) : null}
        </div>
      </div>
    </>
  );
}
