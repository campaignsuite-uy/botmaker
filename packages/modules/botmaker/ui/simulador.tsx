/** Simulador: la pantalla del servidor (quién puede y con qué borrador); el chat es del navegador. */
import { Caja } from '@campaignsuite/ui';
import type { VistaSimulador } from '../vistas/simulador';
import { EncabezadoBot } from './encabezado-bot';
import { SoloLectura } from './piezas';
import { ChatSimulador } from './simulador/chat';

export function PantallaSimulador({ v }: { v: VistaSimulador }) {
  return (
    <>
      <EncabezadoBot e={v.encabezado} bajada="Conversar con el borrador mientras se arma, con los mismos motores que producción. Debajo de cada respuesta, por qué salió." />
      {v.simulador ? (
        <Caja titulo={`Borrador v${v.simulador.numero}`} nota="la versión publicada se prueba acá cuando exista (etapa 4)">
          <ChatSimulador s={v.simulador} />
        </Caja>
      ) : (
        <Caja titulo="Simulador">
          <SoloLectura>{v.motivo}</SoloLectura>
          <a className="texto-chico" href={v.hrefFlujos}>Ir a Flujos</a>
        </Caja>
      )}
    </>
  );
}
