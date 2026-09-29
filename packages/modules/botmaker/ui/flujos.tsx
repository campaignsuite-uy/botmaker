/** Flujos: el editor del borrador (o el formulario para armarlo). Solo dibuja VistaEditor. */
import { Caja } from '@campaignsuite/ui';
import { crearBorrador } from '../acciones/borrador';
import type { VistaEditor } from '../vistas/editor';
import { EditorFlujos } from './editor/editor';
import { EncabezadoBot } from './encabezado-bot';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';

export function PantallaFlujos({ v }: { v: VistaEditor }) {
  return (
    <>
      <EncabezadoBot e={v.encabezado} />
      <MensajeAccion m={v.mensaje} />
      {v.editor ? <EditorFlujos e={v.editor} /> : null}
      {v.problemas ? (
        <Caja titulo="El borrador guardado tiene problemas">
          <p className="texto-chico">No se puede abrir en el editor. Se puede ver y corregir en YAML; si no, avisale al equipo de BotMaker.</p>
          <ul className="bots-avisos">{v.problemas.slice(0, 20).map((p, i) => <li key={i} className="bots-aviso bots-aviso--atencion">{p.donde}: {p.mensaje}</li>)}</ul>
        </Caja>
      ) : null}
      {!v.editor && !v.problemas ? (
        v.armar ? (
          <Caja titulo={v.armar.conVersiones ? 'No hay un borrador abierto' : 'Este bot todavía no tiene flujos'}>
            <form action={crearBorrador} className="pila bots-form">
              <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.armar.botId }} />
              {v.armar.conVersiones ? (
                <p className="texto-chico">El borrador nuevo copia la versión pedida para publicar, si hay una; si no, la publicada (o la última).</p>
              ) : (
                <>
                  <p className="texto-chico">Se arma con la plantilla política: 5 flujos (Inicio, Consultas, Sumarse y aportar, Atención y Datos personales) y 23 intenciones. Después se cambia todo.</p>
                  <div className="grilla-2">
                    <div className="campo">
                      <label htmlFor="ab-candidato">Candidato o dirigente</label>
                      <input id="ab-candidato" name="candidato" className="entrada" required maxLength={80} />
                    </div>
                    <div className="campo">
                      <label htmlFor="ab-partido">Partido (opcional)</label>
                      <input id="ab-partido" name="partido" className="entrada" maxLength={80} defaultValue={v.armar.partido} />
                    </div>
                  </div>
                </>
              )}
              <div className="fila"><button type="submit" className="boton">Armar el borrador</button></div>
            </form>
          </Caja>
        ) : (
          <Caja titulo="Este bot todavía no tiene flujos">
            <SoloLectura>Los flujos los arman el editor y el administrador de BotMaker.</SoloLectura>
          </Caja>
        )
      ) : null}
    </>
  );
}
