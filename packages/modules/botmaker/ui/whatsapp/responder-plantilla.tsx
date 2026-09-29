'use client';
/**
 * Escribir con una plantilla desde la bandeja (WhatsApp, ventana de 24 horas cerrada): se elige una aprobada, se
 * completan sus espacios y se ve cómo le llega a la persona antes de mandarla.
 */
import { useState } from 'react';
import { responderConPlantilla } from '../../acciones/whatsapp';
import { completarPlantilla } from '../../dominio/whatsapp';

interface Props {
  ocultos: React.ReactNode;
  plantillas: { valor: string; nombre: string; texto: string; variables: string[] }[];
  hrefPlantillas: string;
}

export function ResponderConPlantilla({ ocultos, plantillas, hrefPlantillas }: Props) {
  const [elegida, setElegida] = useState(plantillas[0]?.valor ?? '');
  const [valores, setValores] = useState<Record<string, string>>({});
  const p = plantillas.find((x) => x.valor === elegida);
  if (!plantillas.length) {
    return <p className="texto-chico apagado">No hay plantillas aprobadas en la cuenta. Se crean y se mandan a aprobar en <a href={hrefPlantillas}>Canales › Plantillas de WhatsApp</a>.</p>;
  }
  const completa = !!p && p.variables.every((v) => (valores[v] ?? '').trim());
  return (
    <form action={responderConPlantilla} className="pila bots-form">
      {ocultos}
      <div className="campo">
        <label htmlFor="bandeja-plantilla">Escribir con una plantilla</label>
        <select id="bandeja-plantilla" name="plantilla" className="entrada" value={elegida} onChange={(e) => { setElegida(e.target.value); setValores({}); }}>
          {plantillas.map((x) => <option key={x.valor} value={x.valor}>{x.nombre}</option>)}
        </select>
      </div>
      {p?.variables.map((v) => (
        <div key={v} className="campo">
          <label htmlFor={`valor-${v}`}>{`{{${v}}}`}</label>
          <input id={`valor-${v}`} name={`valor:${v}`} className="entrada" maxLength={500} value={valores[v] ?? ''} onChange={(e) => setValores({ ...valores, [v]: e.target.value })} required />
        </div>
      ))}
      {p ? <div className="bots-burbuja bots-burbuja--wa">{completarPlantilla(p.texto, Object.fromEntries(p.variables.map((v) => [v, valores[v]?.trim() || `{{${v}}}`])))}</div> : null}
      <div className="fila"><button type="submit" className="boton" disabled={!completa}>Mandar la plantilla</button></div>
    </form>
  );
}
