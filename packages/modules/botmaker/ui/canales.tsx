/** Canales del bot: canal web (widget y página), condiciones y límites. Solo dibuja VistaCanales. */
import { Caja } from '@campaignsuite/ui';
import { guardarCanalWeb, publicarCondiciones } from '../acciones/bandeja';
import { borrarPlantilla, conectarWhatsapp, prenderWhatsapp, revisarPlantillas } from '../acciones/whatsapp';
import { NuevaPlantilla } from './whatsapp/nueva-plantilla';
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
      <Caja titulo="Condiciones del bot" nota={v.condiciones ? `versión ${v.condiciones.numero}, publicada el ${v.condiciones.fecha} por ${v.condiciones.por}` : 'sin publicar'}>
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
            <ul className="bots-diferencias">{v.historial.slice(1).map((h) => <li key={h.numero}>Versión {h.numero} · {h.fecha} · {h.por}</li>)}</ul>
          </details>
        ) : null}
      </Caja>
      <Caja titulo="Protección del canal" nota="pasarse de un límite deja la conversación en solo menús, sin llamar a los motores">
        <dl className="bots-decision">{v.limites.map((l) => <div key={l.etiqueta}><dt>{l.etiqueta}</dt><dd>{l.valor}</dd></div>)}</dl>
        <p className="texto-mini apagado">Además: verificación anti-robots al abrir la conversación (Cloudflare Turnstile, en la app pública) y el tope de gasto diario del bot (Ajustes). Sin verificación, solo menús.</p>
      </Caja>
      <CajaWhatsapp v={v} ocultos={ocultos} />
      <CajaPlantillas v={v} ocultos={ocultos} />
    </>
  );
}

function CajaWhatsapp({ v, ocultos }: { v: VistaCanales; ocultos: React.ReactNode }) {
  const w = v.whatsapp;
  return (
    <Caja titulo="WhatsApp" nota={`${w.estadoTexto} · con la cuenta de 360dialog de la campaña`}>
      <div className="pila">
        <div className="aviso" role="note"><strong>Política de WhatsApp.</strong> {w.avisoPolitica}</div>
        {w.simulado ? (
          <p className="texto-mini apagado">
            Esta instalación usa 360dialog simulado: sirve cualquier clave de prueba de 20 letras o números (no pegues una clave real acá) y nada sale a WhatsApp.
            {w.urlTelefono ? <> Probalo con el <a href={w.urlTelefono} target="_blank" rel="noreferrer">teléfono de prueba</a>.</> : null}
          </p>
        ) : null}
        {w.estado === 'desconectado' ? <div className="aviso aviso--error" role="alert">El canal está desconectado: 360dialog no aceptó la clave. Lo que el bot quiera decir no sale hasta volver a conectarlo. {w.ultimoError ? `Último error: ${w.ultimoError}.` : ''}</div> : null}
        {w.datos.length ? <dl className="bots-decision">{w.datos.map((d) => <div key={d.etiqueta}><dt>{d.etiqueta}</dt><dd>{d.valor}</dd></div>)}</dl> : null}
        {w.salud.length ? (
          <div>
            <div className="campo__etiqueta">Salud de los últimos 7 días</div>
            <dl className="bots-salud">{w.salud.map((x) => <div key={x.etiqueta} className={x.alerta ? 'bots-salud--alerta' : undefined}><dt>{x.etiqueta}</dt><dd>{x.valor}</dd></div>)}</dl>
          </div>
        ) : null}
        {w.consumo ? <p className="texto-chico">{w.consumo}</p> : null}
        {w.puedeConfigurar ? (
          <>
            {w.faltaUrlPublica ? <div className="aviso aviso--error" role="alert">Para conectar un número real falta la dirección de la app pública (BOTS_URL_PUBLICA, con https): 360dialog necesita saber adónde avisar.</div> : null}
            <form action={conectarWhatsapp} className="pila bots-form" autoComplete="off">
              {ocultos}
              <div className="bots-form__fila">
                <div className="campo">
                  <label htmlFor="wa-clave">Clave de 360dialog (D360-API-KEY)</label>
                  <input id="wa-clave" name="clave" type="password" className="entrada" autoComplete="off" spellCheck={false} minLength={16} maxLength={256} required />
                </div>
                <div className="campo">
                  <label htmlFor="wa-numero">Número, como lo ve la gente</label>
                  <input id="wa-numero" name="numero" className="entrada" inputMode="tel" maxLength={30} placeholder="+507 6000-1234" />
                </div>
              </div>
              <p className="texto-mini apagado">La clave se pega acá, nunca por chat ni por correo. Se guarda cifrada y no se vuelve a mostrar. BotMaker la prueba con 360dialog y le indica adónde avisar cada mensaje, con una contraseña propia de este bot.</p>
              <div className="fila"><button type="submit" className="boton boton--chico">{w.estado ? 'Reconectar con esta clave' : 'Conectar WhatsApp'}</button></div>
            </form>
            {w.estado === 'activo' || w.estado === 'apagado' ? (
              <form action={prenderWhatsapp}>
                {ocultos}
                <input type="hidden" name="activo" value={w.estado === 'activo' ? 'no' : 'si'} />
                <button type="submit" className="boton boton--sec boton--chico">{w.estado === 'activo' ? 'Apagar WhatsApp' : 'Prender WhatsApp'}</button>
              </form>
            ) : null}
          </>
        ) : <SoloLectura>WhatsApp lo conecta el administrador de BotMaker.</SoloLectura>}
      </div>
    </Caja>
  );
}

function CajaPlantillas({ v, ocultos }: { v: VistaCanales; ocultos: React.ReactNode }) {
  const w = v.whatsapp;
  if (!w.estado) return null;
  return (
    <Caja titulo="Plantillas de WhatsApp" nota="pasadas 24 horas del último mensaje de la persona, solo se le puede escribir con una plantilla aprobada">
      <div className="pila">
        {w.plantillas.length ? (
          <ul className="bots-plantillas">
            {w.plantillas.map((p) => (
              <li key={`${p.nombre}|${p.idioma}`} className="bots-plantilla">
                <div className="bots-plantilla__cabeza">
                  <strong>{p.nombre}</strong>
                  <span className="texto-mini apagado">{p.idioma} · {p.categoria}</span>
                  <span className={`bots-chip${p.usable ? " bots-chip--bien" : p.estado === "rechazada" ? " bots-chip--critico" : ""}`}>{p.estadoTexto}</span>
                  {p.creadaPor ? <span className="texto-mini apagado">creada por {p.creadaPor}</span> : null}
                </div>
                <div className="bots-plantilla__texto">{p.texto}</div>
                {p.nota ? <div className="texto-mini apagado">{p.nota}</div> : null}
                {w.puedeConfigurar ? (
                  <form action={borrarPlantilla}>
                    {ocultos}
                    <input type="hidden" name="nombre" value={p.nombre} />
                    <button type="submit" className="boton boton--sec boton--chico">Borrar en 360dialog</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="texto-chico apagado">La cuenta todavía no tiene plantillas.</p>}
        <form action={revisarPlantillas}>
          {ocultos}
          <button type="submit" className="boton boton--sec boton--chico">Actualizar los estados</button>
          {w.hayEnRevision ? <span className="texto-mini apagado"> Hay plantillas en revisión: Meta no avisa cuando decide; se actualiza solo cada tanto o con este botón.</span> : null}
        </form>
        {w.puedeConfigurar ? (
          <details className="bots-fila-detalle">
            <summary className="texto-chico">Nueva plantilla</summary>
            <NuevaPlantilla ocultos={ocultos} categorias={w.categorias} idiomas={w.idiomas} />
          </details>
        ) : null}
      </div>
    </Caja>
  );
}
