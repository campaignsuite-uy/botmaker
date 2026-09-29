'use server';
/**
 * El simulador del borrador: un turno de conversación por llamada, sin recargar la página. Sesión y permiso en el
 * servidor (correr_pruebas: editor y administrador) → núcleo sin Next (ejecutar-simulador.ts) → capa de motores.
 */
import { SinPermiso, SoloLectura } from '../dominio/permisos';
import { capaMotores } from '../motores';
import { campanaDelNucleo } from './campana';
import { contextoAccion, SinSesion } from './comun';
import { ejecutarTurnoSimulador, type PedidoTurno, type ResultadoSimulador } from './ejecutar-simulador';

export async function turnoSimulador(p: PedidoTurno & { campanaId: string }): Promise<ResultadoSimulador> {
  let c;
  try {
    c = await contextoAccion(String(p.campanaId), 'correr_pruebas');
  } catch (e) {
    return { ok: false, codigo: e instanceof SinPermiso ? 'sin_permiso' : e instanceof SoloLectura ? 'solo_lectura' : e instanceof SinSesion ? 'sesion' : 'no_se_pudo' };
  }
  const campana = campanaDelNucleo(c.nucleo, String(p.campanaId)) ?? { nombre: '' };
  return ejecutarTurnoSimulador({ repo: c.repo, rol: c.rol, personaId: c.persona.id, campanaId: String(p.campanaId), campana }, capaMotores(c.repo), {
    botId: String(p.botId), sesion: p.sesion, entrada: p.entrada, horario: p.horario === 'fuera' ? 'fuera' : 'dentro',
    variables: p.variables && typeof p.variables === 'object' ? p.variables : undefined,
  });
}
