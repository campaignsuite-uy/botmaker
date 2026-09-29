/**
 * Después de responder desde la bandeja: si la conversación es por WhatsApp, lo que quedó en la cola sale enseguida
 * (con after() de Next, después de contestarle a la pantalla). Si no sale ahora, lo reintenta la tarea programada.
 * No es un archivo 'use server': lo llaman las acciones.
 */
import { after } from 'next/server';
import { obtenerRepositorioPublico } from '../datos/publico';
import { prepararSimulado } from '../canal-whatsapp/http';
import { enviarPendientes } from '../canal-whatsapp/nucleo';
import { clienteWhatsapp } from '../canal-whatsapp/servidor';

const BASE_DEMO = '/publico';

export function enviarWhatsappDespues(conversacionId: string): void {
  if (!conversacionId) return;
  after(async () => {
    try {
      prepararSimulado(BASE_DEMO);
      await enviarPendientes(obtenerRepositorioPublico(), { ahora: () => new Date(), cliente: clienteWhatsapp(BASE_DEMO) }, { conversacionId });
    } catch (e) {
      console.error('[whatsapp] envío después de responder', e instanceof Error ? e.message : e);
    }
  });
}
