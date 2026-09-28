/** Piezas comunes de las pantallas de BotMaker. Solo dibujan. */
import type { ReactNode } from 'react';
import { Aviso } from '@campaignsuite/ui';
import type { MensajePantalla } from '../vistas/mensajes';

export function MensajeAccion({ m }: { m: MensajePantalla | null }) {
  return m ? <Aviso tipo={m.tipo === 'ok' ? 'ok' : 'error'}>{m.texto}</Aviso> : null;
}

/** Campos ocultos de todo formulario de acción: la campaña, a dónde volver y lo que haga falta. */
export function Ocultos(props: { campanaId: string; volver: string; extra?: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="campanaId" value={props.campanaId} />
      <input type="hidden" name="volver" value={props.volver} />
      {Object.entries(props.extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
}

export function SoloLectura({ children }: { children: ReactNode }) {
  return <p className="texto-mini apagado bots-solo-lectura">{children}</p>;
}

export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="bots-dato">
      <span className="bots-dato__etiqueta">{etiqueta}</span>
      <span className="bots-dato__valor">{children}</span>
    </div>
  );
}

export function Si() {
  return <><span className="est-bien" aria-hidden="true">✓</span><span className="oculto-visual">Sí</span></>;
}

export function No() {
  return <><span className="apagado" aria-hidden="true">—</span><span className="oculto-visual">No</span></>;
}
