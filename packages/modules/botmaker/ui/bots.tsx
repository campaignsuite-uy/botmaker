/** Bots: la lista de bots de la campaña. Solo dibuja VistaBots. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import type { VistaBots } from '../vistas/bots';
import { MensajeAccion } from './piezas';

export function PantallaBots({ v }: { v: VistaBots }) {
  return (
    <>
      <Encabezado
        ceja="BotMaker"
        titulo="Bots"
        enfasis="de la campaña"
        bajada="Cada bot atiende a los ciudadanos en la web y, más adelante, en WhatsApp. Acá se crean y se configuran; el editor de flujos llega en la etapa 2."
        lado={v.puedeCrear ? <a className="boton" href={v.hrefNuevo}>Nuevo bot</a> : undefined}
      />
      <MensajeAccion m={v.mensaje} />
      {!v.preparada ? (
        <div className="aviso" role="status">BotMaker todavía no está preparado en esta campaña. Lo prepara quien administra la organización al habilitar el producto.</div>
      ) : null}
      <Caja titulo="Bots" nota={v.archivados ? undefined : 'ninguno archivado'} accion={v.archivados ? { texto: v.verArchivados ? 'Ocultar archivados' : `Ver archivados (${v.archivados})`, href: v.hrefArchivados } : undefined}>
        {v.filas.length ? (
          <div className="tabla-envoltura">
            <table className="tabla">
              <caption className="oculto-visual">Bots de la campaña</caption>
              <thead>
                <tr><th scope="col">Bot</th><th scope="col">Caso</th><th scope="col">Mercado</th><th scope="col">Estado</th><th scope="col">Motores</th><th scope="col">Creado</th></tr>
              </thead>
              <tbody>
                {v.filas.map((f) => (
                  <tr key={f.id}>
                    <td><a href={f.href} style={{ fontWeight: 700 }}>{f.nombre}</a></td>
                    <td className="texto-chico">{f.caso}</td>
                    <td className="texto-chico">{f.mercado}</td>
                    <td><span className={`bots-estado bots-estado--${f.estado}`}>{f.estadoTexto}</span></td>
                    <td className="texto-chico secundario">{f.motores.map((m) => <span key={m.funcion} className="bots-motor-corto">{m.funcion}: {m.texto}</span>)}</td>
                    <td className="texto-chico secundario num">{f.creado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="secundario" style={{ margin: 0 }}>
            {v.demo ? 'Esta demo no tiene bots.' : v.puedeCrear ? 'Todavía no hay bots. Creá el primero con «Nuevo bot».' : 'Todavía no hay bots en esta campaña.'}
          </p>
        )}
      </Caja>
    </>
  );
}
