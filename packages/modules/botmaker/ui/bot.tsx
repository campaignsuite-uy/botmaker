/** Ajustes de un bot: datos, motores y gasto, datos personales y archivar. Solo dibuja VistaBot. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import { archivarBot, guardarBot, guardarDatosPersonales, guardarMotores, probarMotor } from '../acciones/bots';
import type { VistaBot } from '../vistas/bot';
import { Dato, MensajeAccion, Ocultos, SoloLectura } from './piezas';

export function PantallaBot({ v }: { v: VistaBot }) {
  const b = v.bot;
  const oc = (ancla: string) => <Ocultos campanaId={v.campanaId} volver={`${v.volver}#${ancla}`} extra={{ botId: b.id }} />;
  return (
    <>
      <Encabezado
        ceja={<><a href={v.hrefLista}>Bots</a> · {b.estadoTexto}</>}
        titulo={b.nombre}
        bajada={b.resumen}
        lado={<span className={`bots-estado bots-estado--${b.estado}`}>{b.estadoTexto}</span>}
      />
      <MensajeAccion m={v.mensaje} />
      {b.archivado ? <div className="aviso" role="status">Este bot está archivado: se puede mirar, no cambiar.</div> : null}

      <Caja id="datos" titulo="Datos del bot" nota={`Dirección pública: ${b.idPublico}`}>
        {v.datos.editable ? (
          <form action={guardarBot} className="pila bots-form">
            {oc('datos')}
            <div className="campo">
              <label htmlFor="b-nombre">Nombre</label>
              <input id="b-nombre" name="nombre" className="entrada" required maxLength={v.datos.largoNombre} defaultValue={v.datos.nombre} />
            </div>
            <fieldset className="bots-opciones">
              <legend className="campo__etiqueta">Caso</legend>
              {v.datos.casos.map((c) => (
                <label key={c.valor} className="bots-opcion">
                  <input type="radio" name="caso" value={c.valor} defaultChecked={c.valor === v.datos.caso} />
                  <span><strong>{c.texto}</strong><span className="texto-chico secundario"> {c.descripcion}</span></span>
                </label>
              ))}
            </fieldset>
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="b-mercado">Mercado</label>
                <select id="b-mercado" name="mercado" className="entrada" defaultValue={v.datos.mercado}>
                  {v.datos.mercados.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="b-trato">Trato</label>
                <select id="b-trato" name="trato" className="entrada" defaultValue={v.datos.trato}>
                  {v.datos.tratos.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                </select>
              </div>
            </div>
            <div className="campo">
              <label htmlFor="b-aviso">Aviso de IA del primer mensaje</label>
              <textarea id="b-aviso" name="avisoIa" className="entrada" maxLength={v.datos.largoAviso} defaultValue={v.datos.avisoIa} placeholder={v.datos.avisoIaPorDefecto} />
              <span className="texto-mini apagado">
                {v.datos.avisoIaExigido
                  ? 'Algún motor de este bot exige avisar que es una IA: el primer mensaje lo va a incluir siempre. Si lo dejás vacío, va el texto de ejemplo.'
                  : 'Ningún motor de este bot lo exige. Si alguien pregunta si habla con una persona, el bot igual dice que es un asistente virtual.'}
              </span>
            </div>
            <div className="fila"><button type="submit" className="boton">Guardar datos</button></div>
          </form>
        ) : (
          <div className="bots-datos">
            <Dato etiqueta="Nombre">{v.datos.nombre}</Dato>
            <Dato etiqueta="Caso">{v.datos.casos.find((c) => c.valor === v.datos.caso)?.texto}</Dato>
            <Dato etiqueta="Mercado">{v.datos.mercados.find((m) => m.valor === v.datos.mercado)?.texto}</Dato>
            <Dato etiqueta="Trato">{v.datos.tratos.find((t) => t.valor === v.datos.trato)?.texto}</Dato>
            <Dato etiqueta="Aviso de IA">{v.datos.avisoIa || v.datos.avisoIaPorDefecto}</Dato>
            {!b.archivado ? <SoloLectura>Los datos del bot los cambian el editor y el administrador.</SoloLectura> : null}
          </div>
        )}
        <p className="texto-mini apagado" style={{ margin: 0 }}>Creado el {b.creado} · último cambio el {b.actualizado}</p>
      </Caja>

      <Caja id="motores" titulo="Motores y gasto" nota={v.motores.simulado ? 'esta instalación usa el motor simulado' : undefined}>
        {v.motores.simulado ? (
          <div className="aviso" role="status">Esta instalación usa el motor simulado (demo o BOTS_SIMULAR=1): las respuestas salen por reglas y no cuestan nada. La elección de motores se guarda igual.</div>
        ) : null}
        {v.motores.editable ? (
          <form action={guardarMotores} className="pila bots-form">
            {oc('motores')}
            <div className="tabla-envoltura">
              <table className="tabla bots-tabla-motores">
                <caption className="oculto-visual">Motor principal y de respaldo de cada función</caption>
                <thead><tr><th scope="col">Función</th><th scope="col">Principal</th><th scope="col">Respaldo</th><th scope="col">Tiempo máximo</th></tr></thead>
                <tbody>
                  {v.motores.filas.map((f) => (
                    <tr key={f.funcion}>
                      <th scope="row"><span style={{ display: 'block', fontWeight: 700 }}>{f.etiqueta}</span><span className="texto-mini apagado" style={{ textTransform: 'none', letterSpacing: 0, whiteSpace: 'normal' }}>{f.descripcion}</span></th>
                      <td>
                        <label htmlFor={`p-${f.funcion}`} className="oculto-visual">Motor principal para {f.etiqueta}</label>
                        <select id={`p-${f.funcion}`} name={`principal_${f.funcion}`} className="entrada" defaultValue={f.principal}>
                          {f.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                        </select>
                      </td>
                      <td>
                        <label htmlFor={`r-${f.funcion}`} className="oculto-visual">Motor de respaldo para {f.etiqueta}</label>
                        <select id={`r-${f.funcion}`} name={`respaldo_${f.funcion}`} className="entrada" defaultValue={f.respaldo}>
                          <option value="">Sin respaldo</option>
                          {f.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                        </select>
                      </td>
                      <td className="texto-chico secundario num">{f.tiempoMaximo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="b-tope-d">Tope de gasto diario en vivo (USD)</label>
                <input id="b-tope-d" name="topeDiario" className="entrada num" inputMode="decimal" defaultValue={v.motores.topeDiario} required />
              </div>
              <div className="campo">
                <label htmlFor="b-tope-m">Tope de gasto mensual en vivo (USD)</label>
                <input id="b-tope-m" name="topeMensual" className="entrada num" inputMode="decimal" defaultValue={v.motores.topeMensual} required />
              </div>
            </div>
            <p className="texto-mini apagado" style={{ margin: 0 }}>Al llegar a un tope, el bot sigue respondiendo solo con menús hasta el día (o el mes) siguiente, en UTC.</p>
            <div className="fila"><button type="submit" className="boton">Guardar motores y topes</button></div>
          </form>
        ) : (
          <>
            <div className="tabla-envoltura">
              <table className="tabla">
                <caption className="oculto-visual">Motor principal y de respaldo de cada función</caption>
                <thead><tr><th scope="col">Función</th><th scope="col">Principal</th><th scope="col">Respaldo</th><th scope="col">Tiempo máximo</th></tr></thead>
                <tbody>
                  {v.motores.filas.map((f) => (
                    <tr key={f.funcion}><td style={{ fontWeight: 700 }}>{f.etiqueta}</td><td>{f.principalTexto}</td><td>{f.respaldoTexto}</td><td className="texto-chico secundario num">{f.tiempoMaximo}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bots-datos">
              <Dato etiqueta="Tope diario en vivo">{v.motores.topeDiarioTexto}</Dato>
              <Dato etiqueta="Tope mensual en vivo">{v.motores.topeMensualTexto}</Dato>
            </div>
            {!b.archivado ? <SoloLectura>Los motores y los topes los elige el administrador.</SoloLectura> : null}
          </>
        )}
        {v.motores.gasto ? (
          <div className="bots-datos">
            <Dato etiqueta="Gasto de hoy">{v.motores.gasto.hoy}</Dato>
            <Dato etiqueta="Gasto del mes">{v.motores.gasto.mes}</Dato>
            <p className="texto-mini apagado" style={{ margin: 0, gridColumn: '1 / -1' }}>{v.motores.gasto.nota}</p>
          </div>
        ) : null}
        {v.motores.avisos.length ? (
          <div className="pila" style={{ gap: 8 }}>
            <h3 className="subtitulo" style={{ margin: 0 }}>Avisos de los motores elegidos</h3>
            <ul className="bots-avisos">
              {v.motores.avisos.map((a) => (
                <li key={a.texto} className={`bots-aviso bots-aviso--${a.nivel}`}>{a.texto}</li>
              ))}
            </ul>
            <p className="texto-mini apagado" style={{ margin: 0 }}>Los avisos informan; no bloquean ninguna elección.</p>
          </div>
        ) : null}
        {v.motores.probar ? (
          <form action={probarMotor} className="bots-probar" aria-label="Probar un motor">
            {oc('motores')}
            <span className="subtitulo">Probar un motor</span>
            <div className="fila">
              <label htmlFor="pr-funcion" className="oculto-visual">Función</label>
              <select id="pr-funcion" name="funcion" className="entrada" defaultValue="interpretar">
                {v.motores.probar.funciones.map((f) => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
              </select>
              <label htmlFor="pr-motor" className="oculto-visual">Motor</label>
              <select id="pr-motor" name="motor" className="entrada" defaultValue={v.motores.probar.motorInicial}>
                {v.motores.probar.motores.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
              </select>
              <button type="submit" className="boton boton--sec">Probar</button>
            </div>
            <span className="texto-mini apagado">Manda un pedido chico de prueba (no usa datos del bot) y muestra si respondió, cuánto tardó y cuánto costó. Queda en Costos como uso «Pruebas». El motor tiene que servir para esa función (ver Motores).</span>
          </form>
        ) : null}
        {v.motores.prueba ? (
          <div className={`aviso ${v.motores.prueba.ok ? 'aviso--ok' : 'aviso--error'}`} role="status">
            <strong>{v.motores.prueba.ok ? 'Respondió' : 'No respondió bien'}</strong> · {v.motores.prueba.motor} · {v.motores.prueba.funcion} · {v.motores.prueba.demora} · {v.motores.prueba.costo}
            {v.motores.prueba.detalle ? <div className="texto-chico" style={{ marginTop: 6 }}>{v.motores.prueba.detalle}</div> : null}
          </div>
        ) : null}
      </Caja>

      <Caja id="datos-personales" titulo="Datos personales">
        {v.datosPersonales.editable ? (
          <form action={guardarDatosPersonales} className="pila bots-form">
            {oc('datos-personales')}
            <label className="interruptor">
              <input type="checkbox" name="personalizacion" value="si" defaultChecked={v.datosPersonales.personalizacion} />
              <span>Personalizar las respuestas según lo que se sabe de la persona</span>
            </label>
            <div className="campo" style={{ maxWidth: 260 }}>
              <label htmlFor="b-dias">Días que se guarda el texto de las conversaciones</label>
              <input id="b-dias" name="dias" className="entrada num" inputMode="numeric" defaultValue={String(v.datosPersonales.dias)} required />
            </div>
            <p className="texto-mini apagado" style={{ margin: 0 }}>{v.datosPersonales.nota}</p>
            <div className="fila"><button type="submit" className="boton">Guardar</button></div>
          </form>
        ) : (
          <>
            <p className="texto-chico" style={{ margin: 0 }}>{v.datosPersonales.texto}</p>
            {!b.archivado ? <SoloLectura>Lo decide el administrador.</SoloLectura> : null}
          </>
        )}
      </Caja>

      {v.puedeArchivar ? (
        <Caja id="archivar" titulo="Archivar el bot">
          <form action={archivarBot} className="fila">
            {oc('archivar')}
            <label className="interruptor">
              <input type="checkbox" name="confirmar" value="si" required />
              <span>Sí, archivar «{b.nombre}»</span>
            </label>
            <button type="submit" className="boton boton--sec">Archivar</button>
          </form>
          <p className="texto-mini apagado" style={{ margin: 0 }}>Deja de aparecer en la lista y no se puede cambiar. Sus datos y su registro de costos se conservan.</p>
        </Caja>
      ) : null}
    </>
  );
}
