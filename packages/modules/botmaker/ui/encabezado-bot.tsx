/** Encabezado y pestañas de las pantallas de un bot. Solo dibuja. */
import { Encabezado, Pestanas } from '@campaignsuite/ui';
import type { EncabezadoBotVista } from '../vistas/bot-comun';

export function EncabezadoBot({ e, bajada }: { e: EncabezadoBotVista; bajada?: string }) {
  return (
    <>
      <Encabezado
        ceja={<><a href={e.hrefLista}>Bots</a> · {e.estadoTexto}{e.version ? ` · ${e.version}` : ''}</>}
        titulo={e.nombre}
        bajada={bajada}
        lado={<span className={`bots-estado bots-estado--${e.estado}`}>{e.estadoTexto}</span>}
      />
      <Pestanas etiqueta="Partes del bot" items={e.pestanas} />
      {e.archivado ? <div className="aviso" role="status">Este bot está archivado: se puede mirar, no cambiar.</div> : null}
    </>
  );
}
