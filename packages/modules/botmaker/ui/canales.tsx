/** Canales del bot: canal web (widget y página), condiciones y límites. Solo dibuja VistaCanales. */
import { Caja } from '@campaignsuite/ui';
import { guardarCanalWeb, publicarCondiciones } from '../acciones/bandeja';
import type { VistaCanales } from '../vistas/canales';
import { EncabezadoBot } from './encabezado-bot';
import { MensajeAccion, Ocultos, SoloLectura } from './piezas';

export function PantallaCanales({ v }: { v: VistaCanales }) {
  const ocultos = <Ocultos campanaId={v.campanaId} volver={v.volver} extra={{ botId: v.botId }} />;
  return (
    <>
      <EncabezadoBot e={v.encabezado} bajada="Dónde conversa el bot. El widget y la página del bot conversan con la versión publicada; una conversación en curso sigue aunque se publique otra." />
      <MensajeAccion m={v.mensaje} />
      {!v.publicado ? <div className="aviso" role="status">Este bot todavía no tiene una versión publicada: el canal web va a conversar cuando la tenga (se publica en Publicación).</div> : null}
      {v.pausado ? <div className="aviso aviso--error" role="status">El bot está en pausa: no contesta y lo que llega va a la bandeja. Se reanuda en Publicación.</div> : null}
      <Caja titulo="Canal web" nota={v.canal.activo ? 'prendido' : 'apagado'}>
        <div className="pila">
          <div>
            <div className="campo__etiqueta">Página del bot</div>
            <a href={v.urlLanding} target="_blank" rel="noreferrer">{v.urlLanding}</a>
            <p className="texto-mini apagado">Para compartir por enlace o con un código QR.</p>
          </div>
          <div>
            <div className="campo__etiqueta">Widget: se pega una vez en el sitio de la campaña</div>
            <code className="bots-snippet">{v.snippet}</code>
            {v.urlDeDemo ? <p className="texto-mini apagado">Demo: la app pública corre dentro de esta misma app, en /publico. Con la app pública en su dirección (BOTS_URL_PUBLICA), el código trae esa dirección.</p> : null}
          </div>
          {v.puedeConfigurar ? (
            <form action={guardarCanalWeb} className="pila bots-form">
              {ocultos}
              <label className="bots-opcion"><input type="checkbox" name="activo" value="si" defaultChecked={v.canal.activo} /> <span>Canal web prendido</span></label>
              <fieldset className="bots-opciones">
                <legend className="campo__etiqueta">Cómo se aceptan las condiciones</legend>
                <label className="bots-opcion"><input type="radio" name="modoCondiciones" value="aviso" defaultChecked={v.canal.modoCondiciones === 'aviso'} /> <span>Aviso con enlace en el primer mensaje: seguir es aceptar</span></label>
                <label className="bots-opcion"><input type="radio" name="modoCondiciones" value="acepto" defaultChecked={v.canal.modoCondiciones === 'acepto'} /> <span>Botón «Acepto» antes de empezar</span></label>
              </fieldset>
              <div className="fila"><button type="submit" className="boton boton--chico">Guardar el canal</button></div>
            </form>
          ) : <SoloLectura>El canal lo configura el administrador de BotMaker.</SoloLectura>}
        </div>
      </Caja>
      <Caja titulo="Condiciones del bot" nota={v.condiciones ? `versión ${v.condiciones.numero}, publicada el ${v.condiciones.fecha} (UTC) por ${v.condiciones.por}` : 'sin publicar'}>
        {v.puedeConfigurar ? (
          <form action={publicarCondiciones} className="pila bots-form">
            {ocultos}
            <div className="campo">
              <label htmlFor="condiciones-texto">{v.condiciones ? 'Texto (al publicar, queda como versión nueva)' : 'Texto propuesto: revisalo y adaptalo antes de publicarlo'}</label>
              <textarea id="condiciones-texto" name="texto" className="entrada" rows={12} maxLength={20000} defaultValue={v.textoPropuesto} required />
            </div>
            <p className="texto-mini apagado">Es un texto de partida, no asesoramiento legal: cada campaña lo revisa con quien corresponda. Cada contacto guarda qué versión aceptó y cuándo.</p>
            <div className="fila"><button type="submit" className="boton boton--chico">Publicar las condiciones</button></div>
          </form>
        ) : v.condiciones ? <p className="texto-chico bots-nota">{v.condiciones.texto}</p> : <SoloLectura>Las publica el administrador.</SoloLectura>}
        {v.historial.length > 1 ? (
          <details className="bots-fila-detalle">
            <summary className="texto-chico">Versiones anteriores ({v.historial.length - 1})</summary>
            <ul className="bots-diferencias">{v.historial.slice(1).map((h) => <li key={h.numero}>Versión {h.numero} · {h.fecha} (UTC) · {h.por}</li>)}</ul>
          </details>
        ) : null}
      </Caja>
      <Caja titulo="Protección del canal" nota="pasarse de un límite deja la conversación en solo menús, sin llamar a los motores">
        <dl className="bots-decision">{v.limites.map((l) => <div key={l.etiqueta}><dt>{l.etiqueta}</dt><dd>{l.valor}</dd></div>)}</dl>
        <p className="texto-mini apagado">Además: verificación anti-robots al abrir la conversación (Cloudflare Turnstile, en la app pública) y el tope de gasto diario del bot (Ajustes). Sin verificación, solo menús.</p>
      </Caja>
      <Caja titulo="WhatsApp">
        <p className="texto-chico apagado">Se conecta con la cuenta de 360dialog de la campaña (etapa 7).</p>
      </Caja>
    </>
  );
}
