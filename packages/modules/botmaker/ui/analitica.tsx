/** Analítica: conversaciones, cómo terminan, qué consultan, por dónde pasan y dónde dejan. Solo dibuja VistaAnalitica. */
import { Caja, Encabezado, Kpi } from '@campaignsuite/ui';
import type { FilaRanking, VistaAnalitica } from '../vistas/analitica';
import { MensajeAccion } from './piezas';

function Ranking({ filas, vacio, etiqueta, largo = false }: { filas: FilaRanking[]; vacio: string; etiqueta: string; largo?: boolean }) {
  if (!filas.length) return <p className="texto-chico apagado">{vacio}</p>;
  return (
    <ol className={`bots-ranking${largo ? ' bots-ranking--largo' : ''}`} aria-label={etiqueta}>
      {filas.map((f) => (
        <li key={f.texto} className="bots-ranking__fila">
          <span className="bots-ranking__texto">{f.href ? <a href={f.href} title="Ver quiénes lo consultaron en la base de contactos">{f.texto}</a> : f.texto}</span>
          <span className="bots-ranking__barra" aria-hidden="true"><span style={{ width: `${f.ancho}%` }} /></span>
          <span className="bots-ranking__n num">{f.n}</span>
          <span className="bots-ranking__pct num texto-mini apagado">{f.porcentaje}</span>
        </li>
      ))}
    </ol>
  );
}

export function PantallaAnalitica({ v }: { v: VistaAnalitica }) {
  return (
    <>
      <Encabezado
        ceja="BotMaker" titulo="Analítica" enfasis="de las conversaciones"
        bajada={`Cuántas conversaciones hubo y cómo terminaron, qué consultó la gente, por dónde pasó y dónde dejó. Sale de los eventos del bot, que no tienen textos de personas. Período: ${v.rango}.`}
      />
      <MensajeAccion m={v.mensaje} />
      <Caja titulo="Qué mirar">
        <form method="get" className="bots-filtros">
          <label className="campo"><span className="campo__etiqueta">Bot</span>
            <select name="bot" className="entrada" defaultValue={v.filtros.bot}>{v.opcionesBot.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          <label className="campo"><span className="campo__etiqueta">Canal</span>
            <select name="canal" className="entrada" defaultValue={v.filtros.canal}><option value="">Todos</option>{v.opcionesCanal.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
          </label>
          {v.opcionesVersion.length ? (
            <label className="campo"><span className="campo__etiqueta">Versión</span>
              <select name="version" className="entrada" defaultValue={v.filtros.version}><option value="">Todas</option>{v.opcionesVersion.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
            </label>
          ) : null}
          <label className="campo"><span className="campo__etiqueta">Período</span>
            <select name="periodo" className="entrada" defaultValue={v.filtros.periodo}>
              {v.filtros.periodo ? null : <option value="">Fechas elegidas</option>}
              {v.opcionesPeriodo.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
            </select>
          </label>
          <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Ver</button></div>
        </form>
        <details className="bots-fila-detalle">
          <summary className="texto-chico">Elegir las fechas (UTC)</summary>
          <form method="get" className="bots-filtros">
            <input type="hidden" name="bot" value={v.filtros.bot} />
            {v.filtros.canal ? <input type="hidden" name="canal" value={v.filtros.canal} /> : null}
            {v.filtros.version ? <input type="hidden" name="version" value={v.filtros.version} /> : null}
            <label className="campo"><span className="campo__etiqueta">Desde</span><input type="date" name="desde" className="entrada" defaultValue={v.filtros.desde} required /></label>
            <label className="campo"><span className="campo__etiqueta">Hasta</span><input type="date" name="hasta" className="entrada" defaultValue={v.filtros.hasta} required /></label>
            <div className="fila"><button type="submit" className="boton boton--sec boton--chico">Ver esas fechas</button></div>
          </form>
        </details>
        <p className="texto-mini apagado">{v.actualizada}</p>
      </Caja>

      {v.vacia ? (
        <Caja titulo="Sin conversaciones">
          <p className="texto-chico apagado">No hubo conversaciones con este filtro. Probá con otro período o con todos los bots.</p>
        </Caja>
      ) : (
        <>
          <div className="grilla-4 bots-kpis">
            {v.kpis.map((k) => <Kpi key={k.etiqueta} etiqueta={k.etiqueta} valor={k.valor} nota={k.nota} />)}
          </div>

          <div className="grilla-2">
            <Caja titulo="Conversaciones por día">
              <div className="bots-barras" role="img" aria-label="Conversaciones que empezaron cada día">
                {v.porDia.map((d) => (
                  <div key={d.dia} className="bots-barras__col" title={d.titulo}>
                    <div className="bots-barras__relleno" style={{ height: `${d.n ? d.alto : 1}%` }} />
                  </div>
                ))}
              </div>
              <div className="fila texto-mini apagado" style={{ justifyContent: 'space-between' }}><span>{v.porDia[0]?.dia}</span><span>{v.porDia.at(-1)?.dia}</span></div>
            </Caja>
            <Caja titulo="Cómo terminaron" nota="30 minutos sin movimiento">
              <ol className="bots-ranking" aria-label="Cómo terminaron las conversaciones">
                {v.resultados.map((x) => (
                  <li key={x.clave} className={`bots-ranking__fila bots-ranking__fila--${x.clave}`}>
                    <span className="bots-ranking__texto">{x.texto}</span>
                    <span className="bots-ranking__barra" aria-hidden="true"><span style={{ width: `${x.ancho}%` }} /></span>
                    <span className="bots-ranking__n num">{x.n}</span>
                    <span className="bots-ranking__pct num texto-mini apagado">{x.porcentaje}</span>
                  </li>
                ))}
              </ol>
              <p className="texto-mini apagado">Resuelta: una respuesta con base completa sin derivar, una conversación que atendió alguien del equipo o un «gracias» después de consultar.</p>
            </Caja>
          </div>

          <div className="grilla-2">
            <Caja titulo="Qué consultan">
              <Ranking filas={v.consultas} etiqueta="Consultas más frecuentes" vacio="Todavía no hay consultas que el bot haya interpretado." />
            </Caja>
            <Caja titulo="Temas">
              <Ranking filas={v.temas} etiqueta="Temas más consultados" vacio="Todavía no hay temas de agenda en las consultas." />
            </Caja>
          </div>

          {v.bot ? (
            <>
              <Caja titulo="Recorridos más frecuentes" nota="las primeras cajas de cada conversación">
                <Ranking filas={v.bot.recorridos} etiqueta="Recorridos más frecuentes" vacio="Todavía no hay conversaciones terminadas." largo />
              </Caja>
              <Caja titulo="Embudo por flujo" nota={v.bot.nombre}>
                <p className="texto-chico">Cuántas veces se mostró cada caja, cuántas conversaciones terminaron ahí sin resolver y qué eligió la gente. <a href={v.bot.hrefDiagrama}>Verlo sobre el diagrama</a>.</p>
                {v.bot.embudo.map((f) => (
                  <div key={f.flujo} className="bots-embudo">
                    <h3 className="bots-consultas__titulo">{f.flujo}</h3>
                    <div className="tabla-envoltura">
                      <table className="tabla">
                        <thead><tr><th>Caja</th><th className="der">Visitas</th><th className="der">Terminaron acá</th><th className="der">Abandono</th><th>Opciones elegidas</th></tr></thead>
                        <tbody>
                          {f.cajas.map((c) => (
                            <tr key={c.direccion}>
                              <td><a href={c.hrefCaja}><span className="num apagado">{c.direccion}</span> {c.nombre}</a></td>
                              <td className="der num">{c.visitas}</td>
                              <td className="der num">{c.abandonos}</td>
                              <td className={`der num${c.alerta ? ' est-atencion' : ''}`}>{c.abandono}</td>
                              <td className="texto-chico">{c.opciones || <span className="apagado">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </Caja>
            </>
          ) : (
            <Caja titulo="Recorridos y embudo">
              <p className="texto-chico apagado">Elegí un bot para ver los recorridos, el embudo por flujo y los números sobre el diagrama: las cajas de cada bot son suyas.</p>
            </Caja>
          )}

          <div className="grilla-2">
            <Caja titulo="Lo que no entendió">
              <dl className="bots-decision bots-decision--cifras">
                {v.noEntendidas.map((x) => <div key={x.texto}><dt>{x.texto}</dt><dd className="num">{x.n}</dd></div>)}
              </dl>
            </Caja>
            {v.costos ? (
              <Caja titulo="Costo en vivo" nota={`${v.costos.total} · ${v.costos.porConversacion} por conversación`}>
                {v.costos.filas.length ? (
                  <div className="tabla-envoltura">
                    <table className="tabla">
                      <thead><tr><th>Función</th><th>Motor</th><th className="der">Llamadas</th><th className="der">Costo</th></tr></thead>
                      <tbody>{v.costos.filas.map((c) => <tr key={`${c.funcion}${c.motor}`}><td>{c.funcion}</td><td>{c.motor}</td><td className="der num">{c.llamadas}</td><td className="der num">{c.costo}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : <p className="texto-chico apagado">Sin llamadas en vivo en el período.</p>}
                <p className="texto-mini apagado">Solo las conversaciones con la gente (sin simulador, pruebas ni copiloto). El detalle, en <a href={v.costos.hrefCostos}>Costos</a>.</p>
              </Caja>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
