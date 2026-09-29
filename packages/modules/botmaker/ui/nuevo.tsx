/** Nuevo bot. Solo dibuja VistaNuevoBot. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import { crearBot } from '../acciones/bots';
import type { VistaNuevoBot } from '../vistas/nuevo';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';

export function PantallaNuevoBot({ v }: { v: VistaNuevoBot }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Nuevo" enfasis="bot" bajada="El bot nace en borrador, con la plantilla política y los motores por defecto. Después se ajusta todo en el editor y en su configuración." />
      <MensajeAccion m={v.mensaje} />
      {v.puedeCrear ? (
        <Caja titulo="Datos del bot">
          <form action={crearBot} className="pila bots-form">
            <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ clave: v.clave }} />
            <div className="campo">
              <label htmlFor="nb-nombre">Nombre</label>
              <input id="nb-nombre" name="nombre" className="entrada" required maxLength={v.largoNombre} placeholder="Por ejemplo: Asistente de la campaña" />
            </div>
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="nb-candidato">Candidato o dirigente</label>
                <input id="nb-candidato" name="candidato" className="entrada" required maxLength={v.largoCandidato} placeholder="Nombre y apellido" />
              </div>
              <div className="campo">
                <label htmlFor="nb-partido">Partido (opcional)</label>
                <input id="nb-partido" name="partido" className="entrada" maxLength={v.largoCandidato} defaultValue={v.partidoInicial} />
              </div>
            </div>
            <fieldset className="bots-opciones">
              <legend className="campo__etiqueta">Caso</legend>
              {v.casos.map((c, i) => (
                <label key={c.valor} className="bots-opcion">
                  <input type="radio" name="caso" value={c.valor} defaultChecked={i === 0} required />
                  <span><strong>{c.texto}</strong><span className="texto-chico secundario"> {c.descripcion}</span></span>
                </label>
              ))}
            </fieldset>
            <div className="grilla-2">
              <div className="campo">
                <label htmlFor="nb-mercado">Mercado</label>
                <select id="nb-mercado" name="mercado" className="entrada" defaultValue={v.mercadoInicial}>
                  {v.mercados.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="nb-trato">Trato</label>
                <select id="nb-trato" name="trato" className="entrada" defaultValue="usted">
                  {v.tratos.map((t) => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                </select>
              </div>
            </div>
            <div className="texto-chico secundario">
              Motores por defecto:
              <ul className="bots-lista">{v.motores.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
            <div className="fila">
              <button type="submit" className="boton">Crear bot</button>
              <a className="boton boton--sec" href={v.hrefLista}>Cancelar</a>
            </div>
          </form>
        </Caja>
      ) : (
        <SoloLectura>Los bots los crean el editor y el administrador de BotMaker.</SoloLectura>
      )}
    </>
  );
}
