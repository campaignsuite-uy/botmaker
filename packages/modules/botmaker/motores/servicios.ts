/**
 * Los servicios que el motor de conversación (dominio/motor.ts → turno) necesita, armados sobre la capa de motores:
 * interpretar y responder pasan por la capa (con su elección de motores, respaldo, doble lectura, topes y registro de
 * cada llamada con su uso: simulador, pruebas o en vivo); el material y el horario los pone quien llama.
 */
import type { Definicion } from '../dominio/definicion';
import type { Servicios } from '../dominio/motor';
import type { Bot, UsoMotor } from '../dominio/tipos';
import type { CapaMotores } from './capa';
import type { SeccionMaterial } from './contratos';
import type { ContextoBot } from './prompts';

export interface OpcionesServicios {
  bot: Pick<Bot, 'id' | 'campanaId' | 'nombre' | 'mercado' | 'caso' | 'trato'>;
  campana: { nombre: string };
  definicion: Definicion;
  uso: UsoMotor;
  personaId: string | null;
  /** El material del bot en secciones (etapa 3). Sin material, responder con base dice que no tiene el dato. */
  material?: (temas: string[]) => SeccionMaterial[];
  dentroDeHorario: () => boolean;
}

export function contextoDeBot(o: Pick<OpcionesServicios, 'bot' | 'campana' | 'definicion'>): ContextoBot {
  return {
    nombreBot: o.bot.nombre, campana: o.campana.nombre, mercado: o.bot.mercado, caso: o.bot.caso, trato: o.bot.trato,
    identidad: o.definicion.identidad,
  };
}

export function serviciosDeCapa(capa: CapaMotores, o: OpcionesServicios): Servicios {
  const contexto = contextoDeBot(o);
  const bot = { id: o.bot.id, campanaId: o.bot.campanaId };
  return {
    async interpretar(entrada) {
      const r = await capa.llamar({ funcion: 'interpretar', uso: o.uso, bot, contexto, entrada, personaId: o.personaId });
      return { salida: r.salida, lectura: r.lectura, motorId: r.motorId, costoUsd: r.costoUsd };
    },
    async responder(entrada) {
      // Sin material no hay de dónde responder: no se gasta una llamada para que diga que no sabe.
      if (!entrada.material.length) return { salida: { respuesta: '', secciones: [], tiene_respuesta: 'no' }, motorId: null, costoUsd: 0 };
      const r = await capa.llamar({ funcion: 'responder', uso: o.uso, bot, contexto, entrada, personaId: o.personaId });
      return { salida: r.salida, motorId: r.motorId, costoUsd: r.costoUsd };
    },
    material: (temas) => o.material?.(temas) ?? [],
    dentroDeHorario: o.dentroDeHorario,
  };
}
