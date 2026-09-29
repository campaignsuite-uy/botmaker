/** Pruebas: casos, correr, corridas, una corrida y la comparación de dos. Solo dibuja las vistas de vistas/pruebas.ts. */
import { Caja } from '@campaignsuite/ui';
import { cambiarBorrador } from '../acciones/borrador';
import type { VistaComparar, VistaCorrida, VistaPruebas, FilaCorrida } from '../vistas/pruebas';
import { EncabezadoBot } from './encabezado-bot';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';
import { CorrerPruebas } from './pruebas/correr';

function TablaCorridas({ filas, conCosto, comparar }: { filas: FilaCorrida[]; conCosto: boolean; comparar?: string }) {
  if (!filas.length) return <p className="texto-chico apagado">Todavía no hay corridas.</p>;
  return (
    <form method="get" action={comparar} className="pila">
      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              {comparar ? <th>Comparar</th> : null}
              <th>Fecha (UTC)</th><th>Versión</th><th>Motores</th><th>Estado</th><th>Acierto</th><th>Cuando coinciden</th><th>Aclaración</th><th>Con base</th><th>Cortadas</th>
              {conCosto ? <th>Costo</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => (
              <tr key={r.id}>
                {comparar ? <td>{r.estado === 'terminada' ? <input type="checkbox" name="corrida" value={r.id} aria-label={`Comparar la corrida del ${r.fecha}`} /> : null}</td> : null}
                <td className="num">{r.fecha}</td>
                <td>{r.version}{r.actual ? <span className="texto-mini est-bien"> · actual</span> : null}</td>
                <td className="texto-chico">{r.etiqueta}</td>
                <td>{r.estadoTexto}{r.estado === 'en_curso' ? ` (${r.avance})` : ''}</td>
                <td className="num">{r.acierto}</td><td className="num">{r.cuandoCoinciden}</td><td className="num">{r.aclaracion}</td>
                <td className="num">{r.base}</td><td className="num">{r.cortadas}</td>
                {conCosto ? <td className="num">{r.costo}</td> : null}
                <td><a href={r.href}>Ver</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparar ? <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Comparar las dos marcadas</button></div> : null}
    </form>
  );
}

export function PantallaPruebas({ v }: { v: VistaPruebas }) {
  const conCosto = v.corridas.some((r) => r.costo !== null);
  return (
    <>
      <EncabezadoBot e={v.encabezado} bajada="Cada versión se prueba con sus casos antes de publicarse: la intención de cada mensaje y qué hace con las preguntas al material. Con otra combinación de motores, para comparar." />
      <MensajeAccion m={v.mensaje} />
      {v.sinBorrador ? <div className="aviso" role="status">Este bot todavía no tiene borrador. <a href={v.sinBorrador.hrefFlujos}>Armalo en Flujos</a>.</div> : null}
      <Caja titulo="Correr las pruebas" nota="sobre el último cambio del borrador">
        {v.puedeCorrer ? <CorrerPruebas v={v} hrefCorridas={v.hrefComparar.replace(/\/comparar$/, '')} /> : <SoloLectura>Las pruebas las corren el editor y el administrador: cada caso que pasa por un motor tiene costo.</SoloLectura>}
      </Caja>
      <Caja titulo="Corridas" nota="para pedir publicar hace falta una terminada sobre el cambio actual">
        <TablaCorridas filas={v.corridas} conCosto={conCosto} comparar={v.hrefComparar} />
      </Caja>
      <Caja titulo={`Casos de prueba (${v.casos.total})`} nota={`${v.casos.intencion} de intención · ${v.casos.base} con base`} accion={v.casos.total ? { texto: 'Descargar los casos', href: v.hrefCasos } : undefined}>
        <details className="bots-fila-detalle">
          <summary>Ver los {v.casos.total} casos</summary>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th>Caso</th><th>Tipo</th><th>Mensaje o pregunta</th><th>Esperado</th>{v.editable ? <th /> : null}</tr></thead>
              <tbody>
                {v.casos.lista.map((k) => (
                  <tr key={k.id}>
                    <td className="num">{k.id}</td><td>{k.tipo}</td><td>{k.texto}</td><td className="texto-chico">{k.esperado}</td>
                    {v.editable ? (
                      <td>
                        <form action={cambiarBorrador}>
                          <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId, seq: String(v.seq), forma: 'caso_quitar', caso: k.id }} />
                          <button type="submit" className="ed-boton-icono" aria-label={`Quitar el caso ${k.id}`} title="Quitar">×</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {v.editable ? (
          <form action={cambiarBorrador} className="pila bots-form">
            <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId, seq: String(v.seq), forma: 'casos_cargar' }} />
            <div className="campo">
              <label htmlFor="casos-texto">Cargar casos, uno por renglón</label>
              <textarea id="casos-texto" name="texto" className="entrada bots-yaml" rows={6} placeholder={'¿Qué propone para la Caja? | propuesta | sobre_el_candidato\n? ¿Dónde nació el candidato? | si | En Ciudad de Panamá'} />
              <span className="texto-mini apagado">Intención: mensaje | intención | otras válidas (separadas por coma). Pregunta al material: ? pregunta | si, no o parcial | qué tiene que decir. También sirve pegar columnas de una planilla.</span>
            </div>
            <fieldset className="bots-opciones">
              <legend className="campo__etiqueta">Qué hacer con los que ya hay</legend>
              <label className="bots-opcion"><input type="radio" name="reemplazar" value="no" defaultChecked /> <span>Agregar</span></label>
              <label className="bots-opcion"><input type="radio" name="reemplazar" value="si" /> <span>Reemplazar todos</span></label>
            </fieldset>
            <div className="fila"><button type="submit" className="boton boton--chico">Cargar casos</button></div>
          </form>
        ) : null}
      </Caja>
    </>
  );
}

export function PantallaCorrida({ v }: { v: VistaCorrida }) {
  return (
    <>
      <EncabezadoBot e={v.base.encabezado} />
      <Caja titulo={`Corrida del ${v.corrida.fecha} (UTC)`} nota={`${v.corrida.version} · ${v.corrida.estadoTexto} · ${v.corrida.avance}`} accion={{ texto: 'Volver a Pruebas', href: v.hrefPruebas }}>
        <p className="texto-chico secundario">{v.corrida.etiqueta}</p>
        <div className="bots-resumen">
          {v.resumen.map((r) => (
            <div key={r.etiqueta} className="kpi"><div className="kpi__etiqueta">{r.etiqueta}</div><div className="kpi__numero">{r.valor}</div>{r.nota ? <div className="kpi__nota">{r.nota}</div> : null}</div>
          ))}
        </div>
      </Caja>
      <Caja titulo={v.soloErrores ? 'Casos que fallaron' : 'Cada caso'} accion={v.soloErrores ? { texto: 'Ver todos', href: v.hrefTodos } : { texto: 'Ver solo los que fallaron', href: v.hrefErrores }}>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Caso</th><th>Tipo</th><th>Mensaje o pregunta</th><th>Esperado</th><th>Obtenido</th><th>Resultado</th></tr></thead>
            <tbody>
              {v.filas.map((f) => (
                <tr key={f.caso}>
                  <td className="num">{f.caso}</td><td>{f.tipo}</td><td>{f.texto}</td><td className="texto-chico">{f.esperado}</td>
                  <td className="texto-chico">{f.obtenido}{f.detalle ? <div className="texto-mini apagado">{f.detalle}</div> : null}</td>
                  <td>{f.ok === true ? <span className="est-bien">Bien</span> : f.ok === false ? <span className="est-critico">Mal</span> : <span className="apagado">Sin respuesta del motor</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Caja>
    </>
  );
}

export function PantallaComparar({ v }: { v: VistaComparar }) {
  const lista = (titulo: string, xs: VistaComparar['mejoran']) => (
    <Caja titulo={`${titulo} (${xs.length})`}>
      {xs.length ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Caso</th><th>Mensaje o pregunta</th><th>Corrida A</th><th>Corrida B</th></tr></thead>
            <tbody>{xs.map((x) => <tr key={x.caso}><td className="num">{x.caso}</td><td>{x.texto}</td><td className="texto-chico">{x.a}</td><td className="texto-chico">{x.b}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="texto-chico apagado">Ninguno.</p>}
    </Caja>
  );
  return (
    <>
      <EncabezadoBot e={v.base.encabezado} />
      <Caja titulo="Comparar dos corridas" accion={{ texto: 'Volver a Pruebas', href: v.hrefPruebas }}>
        <form method="get" className="grilla-2">
          <label className="campo"><span className="campo__etiqueta">Corrida A</span>
            <select name="a" className="entrada" defaultValue={v.a?.id ?? ''}>{v.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Corrida B</span>
            <select name="b" className="entrada" defaultValue={v.b?.id ?? ''}>{v.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Comparar</button></div>
        </form>
        {v.a && v.b ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead><tr><th /><th>A · {v.a.version}<div className="texto-mini apagado">{v.a.etiqueta}</div></th><th>B · {v.b.version}<div className="texto-mini apagado">{v.b.etiqueta}</div></th></tr></thead>
              <tbody>{v.resumen.map((r) => <tr key={r.etiqueta}><td>{r.etiqueta}</td><td className="num">{r.a}</td><td className="num">{r.b}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="texto-chico apagado">Hacen falta dos corridas terminadas.</p>}
        {v.a && v.b ? <p className="texto-mini apagado">{v.enComun} casos en común.</p> : null}
      </Caja>
      {v.a && v.b ? <>{lista('Mejoran en B', v.mejoran)}{lista('Empeoran en B', v.empeoran)}</> : null}
    </>
  );
}
