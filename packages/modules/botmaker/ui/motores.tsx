/** Motores: la ficha de cada motor y los motores por defecto. Solo dibuja VistaMotores. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import type { VistaMotores } from '../vistas/motores';

export function PantallaMotores({ v }: { v: VistaMotores }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Motores" enfasis="de IA" bajada="Qué modelo puede hacer cada función, qué condiciones pone su empresa y cuánto cuesta. El motor de cada bot se elige en sus ajustes." />
      {v.simulado ? <div className="aviso" role="status">Esta instalación usa el motor simulado: las respuestas salen por reglas y no cuestan nada.</div> : null}
      <Caja titulo="Motores por defecto de los bots nuevos" nota="elegidos con la prueba de motores del 28/9/2026">
        <div className="tabla-envoltura">
          <table className="tabla">
            <caption className="oculto-visual">Motores por defecto</caption>
            <thead><tr><th scope="col">Función</th><th scope="col">Principal</th><th scope="col">Respaldo</th><th scope="col">Tiempo máximo</th></tr></thead>
            <tbody>
              {v.porDefecto.map((m) => <tr key={m.funcion}><td style={{ fontWeight: 700 }}>{m.funcion}</td><td>{m.principal}</td><td>{m.respaldo}</td><td className="num">{m.tiempo}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Caja>
      <Caja titulo="Ficha de cada motor">
        <div className="tabla-envoltura">
          <table className="tabla bots-tabla-fichas">
            <caption className="oculto-visual">Ficha de cada motor</caption>
            <thead>
              <tr>
                <th scope="col">Motor</th><th scope="col">Funciones</th><th scope="col">Bots electorales</th><th scope="col">Bots políticos</th>
                <th scope="col">Aviso de IA</th><th scope="col">Personalización</th><th scope="col">Entrena</th><th scope="col">Datos</th><th scope="col">USD / millón</th>
              </tr>
            </thead>
            <tbody>
              {v.fichas.map((f) => (
                <tr key={f.id}>
                  <td><span style={{ display: 'block', fontWeight: 700 }}>{f.nombre}</span><span className="texto-mini apagado">{f.empresa}</span></td>
                  <td className="texto-chico">{f.funciones}</td>
                  <td className="texto-chico">{f.electoral}</td>
                  <td className="texto-chico">{f.politico}</td>
                  <td className="texto-chico">{f.avisoIa}</td>
                  <td className="texto-chico">{f.personalizacion}</td>
                  <td className={`texto-chico${f.entrena.startsWith('Sí') ? ' est-atencion' : ''}`}>{f.entrena}</td>
                  <td className="texto-chico secundario">{f.region} · {f.retencion}</td>
                  <td className="texto-chico num">{f.precios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lista-filas">
          {v.fichas.map((f) => (
            <div key={f.id} className="pila" style={{ gap: 2 }}>
              <span className="texto-chico" style={{ fontWeight: 700 }}>{f.nombre}</span>
              <span className="texto-chico secundario">{f.condiciones}</span>
            </div>
          ))}
        </div>
        <p className="texto-mini apagado" style={{ margin: 0 }}>{v.nota}</p>
      </Caja>
    </>
  );
}
