/**
 * Motores: la ficha de cada motor (qué empresa, dónde procesa, qué permite en campañas, si exige avisar que es IA, si
 * entrena, precios) y los motores por defecto de los bots nuevos. Es de lectura para todos: elegir el motor de un bot
 * se hace en sus ajustes.
 */
import type { Repositorio } from '../datos/repositorio';
import { decimal } from '../dominio/formato';
import { ETIQUETA_FUNCION, ETIQUETA_PERMISO, fichaMotor } from '../dominio/motores';
import { simularMotores } from '../motores/claves';
import type { ContextoPantalla } from '../ui/contexto';

export interface FilaFicha {
  id: string;
  nombre: string;
  empresa: string;
  funciones: string;
  electoral: string;
  politico: string;
  avisoIa: string;
  personalizacion: string;
  entrena: string;
  retencion: string;
  region: string;
  precios: string;
  condiciones: string;
  simulado: boolean;
}

export interface VistaMotores {
  fichas: FilaFicha[];
  porDefecto: { funcion: string; principal: string; respaldo: string; tiempo: string }[];
  simulado: boolean;
  nota: string;
}

export async function vistaMotores(repo: Repositorio, _ctx: ContextoPantalla): Promise<VistaMotores> {
  const [fichas, defecto] = await Promise.all([repo.fichas(), repo.motoresPorDefecto()]);
  const precio = (x: number | null) => (x == null ? '—' : decimal(x, x < 0.1 ? 3 : 2));
  return {
    fichas: fichas.filter((f) => f.activo).map((f) => ({
      id: f.id,
      nombre: f.nombre,
      empresa: f.empresa,
      funciones: f.funciones.map((x) => ETIQUETA_FUNCION[x]).join(', '),
      electoral: ETIQUETA_PERMISO[f.permiteElectoral],
      politico: ETIQUETA_PERMISO[f.permitePolitico],
      avisoIa: f.exigeAvisoIa ? 'Lo exige' : 'No lo exige',
      personalizacion: f.permitePersonalizacion ? 'Permite' : 'No permite en campañas',
      entrena: f.entrena ? 'Sí, por defecto' : 'No',
      retencion: f.retencion,
      region: f.region,
      precios: f.ruta === 'simulado' ? 'Sin costo' : `${precio(f.precioEntrada)} / ${precio(f.precioSalida)}${f.precioCache != null ? ` · caché ${precio(f.precioCache)}` : ''}`,
      condiciones: f.condiciones,
      simulado: f.ruta === 'simulado',
    })),
    porDefecto: defecto.map((m) => ({
      funcion: ETIQUETA_FUNCION[m.funcion],
      principal: fichaMotor(m.principal, fichas)?.nombre ?? m.principal,
      respaldo: m.respaldo ? `${fichaMotor(m.respaldo, fichas)?.nombre ?? m.respaldo}${m.dobleLectura ? ', en doble lectura' : ''}` : 'Sin respaldo',
      tiempo: `${decimal(m.tiempoMaximoMs / 1000, 1)} s`,
    })),
    simulado: simularMotores(),
    nota: 'Precios en USD por millón de tokens (entrada / salida). Las condiciones salen de la evaluación de motores del 27/9/2026 y se usan para avisar, nunca para bloquear. Los motores por defecto salen de la prueba de motores del 28/9/2026. En doble lectura, los dos motores leen cada mensaje a la vez y, si no coinciden, el bot pregunta.',
  };
}
