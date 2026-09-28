/** Costos de los motores en la campaña. Solo dibuja VistaCostos. */
import { Caja, Encabezado, Kpi } from '@campaignsuite/ui';
import type { VistaCostos } from '../vistas/costos';

function TablaSimple(props: { titulo: string; columnas: string[]; filas: string[][] }) {
  return (
    <Caja titulo={props.titulo}>
      {props.filas.length ? (
        <div className="tabla-envoltura">
          <table className="tabla">
            <caption className="oculto-visual">{props.titulo}</caption>
            <thead><tr>{props.columnas.map((c, i) => <th key={c} scope="col" className={i ? 'der' : undefined}>{c}</th>)}</tr></thead>
            <tbody>{props.filas.map((f) => <tr key={f[0]}>{f.map((x, i) => <td key={i} className={i ? 'der num' : undefined}>{x}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <p className="secundario" style={{ margin: 0 }}>Sin llamadas en el período.</p>}
    </Caja>
  );
}

export function PantallaCostos({ v }: { v: VistaCostos }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Costos" enfasis="de los motores" bajada={`Lo que gastaron los motores de IA en los últimos ${v.dias} días, en USD, según lo que informa cada proveedor. Días en UTC.`} />
      <div className="grilla-3">
        <Kpi etiqueta={`Gasto en ${v.dias} días`} valor={v.total} />
        <Kpi etiqueta="Llamadas" valor={v.llamadas} />
        <Kpi etiqueta="Llamadas fallidas" valor={v.fallidas} nota="Incluye las que resolvió el respaldo." />
      </div>
      <Caja titulo="Gasto por día">
        <div className="bots-barras" role="img" aria-label={`Gasto por día en los últimos ${v.dias} días`}>
          {v.porDia.map((d) => (
            <div key={d.dia} className="bots-barras__col" title={`${d.dia}: ${d.costo} · ${d.llamadas} llamadas`}>
              <div className="bots-barras__relleno" style={{ height: `${v.maximoDia ? Math.max(2, (100 * d.valor) / v.maximoDia) : 2}%` }} />
            </div>
          ))}
        </div>
        <div className="fila texto-mini apagado" style={{ justifyContent: 'space-between' }}><span>{v.porDia[0]?.dia}</span><span>{v.porDia[v.porDia.length - 1]?.dia}</span></div>
      </Caja>
      <div className="grilla-2">
        <TablaSimple titulo="Por bot" columnas={['Bot', 'Gasto', 'Llamadas']} filas={v.porBot.map((x) => [x.nombre, x.costo, x.llamadas])} />
        <TablaSimple titulo="Por uso" columnas={['Uso', 'Gasto', 'Llamadas']} filas={v.porUso.map((x) => [x.uso, x.costo, x.llamadas])} />
        <TablaSimple titulo="Por función" columnas={['Función', 'Gasto', 'Llamadas']} filas={v.porFuncion.map((x) => [x.funcion, x.costo, x.llamadas])} />
      </div>
      <TablaSimple titulo="Por motor" columnas={['Motor', 'Gasto', 'Llamadas', 'Demora media', 'Como respaldo']} filas={v.porMotor.map((x) => [x.motor, x.costo, x.llamadas, x.demora, x.respaldo])} />
      <Caja titulo="Últimas llamadas" nota="sin textos: ni el mensaje ni la respuesta">
        {v.ultimas.length ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <caption className="oculto-visual">Últimas llamadas a motores</caption>
              <thead><tr><th scope="col">Fecha</th><th scope="col">Bot</th><th scope="col">Uso</th><th scope="col">Función</th><th scope="col">Motor</th><th scope="col">Resultado</th><th scope="col" className="der">Demora</th><th scope="col" className="der">Costo</th></tr></thead>
              <tbody>
                {v.ultimas.map((l, i) => (
                  <tr key={i}>
                    <td className="texto-chico num">{l.fecha}</td>
                    <td className="texto-chico">{l.bot}</td>
                    <td className="texto-chico">{l.uso}</td>
                    <td className="texto-chico">{l.funcion}</td>
                    <td className="texto-chico">{l.motor}{l.respaldo ? <span className="texto-mini apagado"> · respaldo</span> : null}</td>
                    <td className="texto-chico">{l.ok ? <span className="est-bien">Bien</span> : <span className="est-critico" title={l.error}>Falló</span>}</td>
                    <td className="der num texto-chico">{l.demora}</td>
                    <td className="der num texto-chico">{l.costo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="secundario" style={{ margin: 0 }}>Todavía no hay llamadas.</p>}
      </Caja>
    </>
  );
}
