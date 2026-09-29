/** Copiloto: el panel del navegador y lo que ya hizo en este borrador. Solo dibuja VistaCopiloto. */
import { Caja } from '@campaignsuite/ui';
import type { VistaCopiloto } from '../vistas/copiloto';
import { PanelCopiloto } from './copiloto/panel';
import { EncabezadoBot } from './encabezado-bot';
import { BarraBorrador } from './partes';
import { MensajeAccion, SoloLectura } from './piezas';

export function PantallaCopiloto({ v }: { v: VistaCopiloto }) {
  return (
    <>
      <EncabezadoBot e={v.encabezado} bajada="La IA propone cambios al borrador y vos elegís cuáles aplicar. Nunca publica: todo queda en el borrador y se deshace como cualquier cambio." />
      <MensajeAccion m={v.mensaje} />
      <BarraBorrador b={v} />
      {v.sinBorrador ? <div className="aviso" role="status">Este bot todavía no tiene borrador. <a href={v.sinBorrador.hrefFlujos}>Armalo en Flujos</a>.</div> : null}
      <Caja titulo="Pedirle al copiloto" nota={v.simulado ? 'motor simulado: entiende pocos pedidos, por reglas' : v.motor}>
        {v.puedeUsar ? <PanelCopiloto v={v} /> : <SoloLectura>El copiloto lo usan el editor y el administrador de BotMaker.</SoloLectura>}
      </Caja>
      <Caja titulo="Lo que hizo el copiloto en este borrador">
        {v.historial.length ? (
          <ul className="bots-diferencias">
            {v.historial.map((h) => <li key={h.seq}>{h.fecha} (UTC) · {h.quien} · {h.resumen}</li>)}
          </ul>
        ) : <p className="texto-chico apagado">Todavía nada.</p>}
        <p className="texto-mini apagado">Cada cambio también está en el historial del borrador, con los del editor. <a href={v.hrefFlujos}>Ver en Flujos</a>.</p>
      </Caja>
    </>
  );
}
