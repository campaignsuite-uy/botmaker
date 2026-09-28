/** Equipo y roles de BotMaker en la campaña, y la matriz de permisos. Solo dibuja VistaEquipo. */
import { Caja, Encabezado } from '@campaignsuite/ui';
import { guardarRolEquipo } from '../acciones/equipo';
import { ORDEN_ROLES } from '../dominio/permisos';
import type { VistaEquipo } from '../vistas/equipo';
import { MensajeAccion, No, Ocultos, Si, SoloLectura } from './piezas';

export function PantallaEquipo({ v }: { v: VistaEquipo }) {
  return (
    <>
      <Encabezado ceja="BotMaker" titulo="Equipo" enfasis="y roles" bajada="Quién de la campaña entra a BotMaker y qué puede hacer cada rol." />
      <MensajeAccion m={v.mensaje} />
      <Caja id="equipo" titulo="Equipo de BotMaker" nota="una fila por persona de la campaña">
        <p className="texto-chico secundario" style={{ margin: 0 }}>{v.nota}{v.equipoCampana ? <> <a href={v.equipoCampana}>Equipo de la campaña →</a></> : null}</p>
        <div className="tabla-envoltura">
          <table className="tabla">
            <caption className="oculto-visual">Equipo de BotMaker en la campaña</caption>
            <thead><tr><th scope="col">Persona</th><th scope="col">En la campaña</th><th scope="col">Rol en BotMaker</th></tr></thead>
            <tbody>
              {v.filas.map((f) => (
                <tr key={f.personaId}>
                  <td>
                    <span style={{ display: 'block', fontWeight: 700 }}>{f.nombre}{f.esVos ? <span className="texto-mini apagado" style={{ fontWeight: 400 }}> · vos</span> : null}</span>
                    {f.email ? <span className="texto-mini apagado">{f.email}</span> : null}
                  </td>
                  <td className="texto-chico secundario">{f.enCampana}</td>
                  <td>
                    {v.puedeEditar && !f.fijo ? (
                      <form action={guardarRolEquipo} className="fila bots-fila-form" aria-label={`Rol de ${f.nombre} en BotMaker`}>
                        <Ocultos campanaId={v.campanaId} volver={`${v.volver}#equipo`} extra={{ personaId: f.personaId }} />
                        <label htmlFor={`rol-${f.personaId}`} className="oculto-visual">Rol de {f.nombre} en BotMaker</label>
                        <select id={`rol-${f.personaId}`} name="rol" className="entrada" defaultValue={f.rol ?? ''}>
                          {v.opcionesRol.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                        </select>
                        <button type="submit" className="boton boton--sec boton--chico">Guardar<span className="oculto-visual"> el rol de {f.nombre}</span></button>
                      </form>
                    ) : (
                      <span className="texto-chico" style={f.fijo ? { color: 'var(--lavanda)' } : undefined}>{f.rolTexto}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!v.puedeEditar ? <SoloLectura>El equipo de BotMaker lo arma su administrador en la campaña.</SoloLectura> : null}
        {v.pendientes.length ? (
          <div className="pila" style={{ gap: 6 }}>
            <h3 className="subtitulo" style={{ margin: 0 }}>Invitaciones pendientes a la campaña</h3>
            <ul className="bots-lista">{v.pendientes.map((p) => <li key={p.email} className="texto-chico">{p.email} · {p.rolTexto}</li>)}</ul>
          </div>
        ) : null}
      </Caja>
      <Caja id="roles" titulo="Roles de BotMaker" nota="qué puede cada rol en la campaña">
        <div className="lista-filas">
          {v.roles.map((r) => (
            <div key={r.rol} className="pila" style={{ gap: 4 }}>
              <span className="subtitulo">{r.texto}</span>
              <span className="texto-chico secundario">{r.descripcion}</span>
            </div>
          ))}
        </div>
        <div className="tabla-envoltura">
          <table className="tabla">
            <caption className="oculto-visual">Qué puede hacer cada rol de BotMaker</caption>
            <thead>
              <tr><th scope="col">Acción</th>{ORDEN_ROLES.map((r) => <th key={r} scope="col" className="centro">{v.roles.find((x) => x.rol === r)?.texto}</th>)}</tr>
            </thead>
            <tbody>
              {v.matriz.map((m) => (
                <tr key={m.accion}>
                  <td>{m.texto}</td>
                  {ORDEN_ROLES.map((r) => <td key={r} className="centro">{m.roles[r] ? <Si /> : <No />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="texto-mini apagado" style={{ margin: 0 }}>Los permisos se aplican en la pantalla, en el servidor y en la base de datos. En una organización de demostración todos son observadores: miran y nadie cambia nada.</p>
      </Caja>
    </>
  );
}
