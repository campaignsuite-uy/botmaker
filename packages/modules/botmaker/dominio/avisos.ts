/**
 * Avisos que el creador muestra al elegir los motores de un bot: salen de la ficha de cada motor y de los ajustes del
 * bot. Informan; nunca bloquean (principio de la definición: avisar, no bloquear).
 */
import { ETIQUETA_FUNCION, fichaMotor, type FichaMotor } from './motores';
import type { Bot, FuncionMotor, MotorFuncion } from './tipos';

export interface AvisoMotor {
  nivel: 'atencion' | 'info';
  funcion: FuncionMotor | null;
  motorId: string | null;
  texto: string;
}

/** Los avisos de los motores de un bot, sin repetir el mismo texto. */
export function avisosMotores(
  bot: Pick<Bot, 'caso' | 'personalizacion'>,
  motores: readonly MotorFuncion[],
  fichas?: readonly FichaMotor[],
): AvisoMotor[] {
  const avisos: AvisoMotor[] = [];
  const vistos = new Set<string>();
  const sumar = (a: AvisoMotor) => {
    if (vistos.has(a.texto)) return;
    vistos.add(a.texto);
    avisos.push(a);
  };
  for (const m of motores) {
    const principal = fichaMotor(m.principal, fichas);
    const respaldo = m.respaldo ? fichaMotor(m.respaldo, fichas) : undefined;
    for (const f of [principal, respaldo]) {
      if (!f) continue;
      // El copiloto lo usa el equipo, no los ciudadanos: las condiciones de cara al público no le aplican.
      if (m.funcion !== 'copiloto') {
        const permiso = bot.caso === 'electoral' ? f.permiteElectoral : f.permitePolitico;
        const caso = bot.caso === 'electoral' ? 'bots electorales' : 'bots políticos';
        if (permiso === 'no') {
          sumar({ nivel: 'atencion', funcion: m.funcion, motorId: f.id, texto: `${f.nombre}: sus condiciones no permiten ${caso}. Lo podés elegir igual; queda a tu criterio.` });
        } else if (permiso === 'con_condiciones') {
          sumar({ nivel: 'info', funcion: m.funcion, motorId: f.id, texto: `${f.nombre} permite ${caso} con condiciones: ${f.condiciones}` });
        }
        if (f.exigeAvisoIa) {
          sumar({ nivel: 'info', funcion: m.funcion, motorId: f.id, texto: `${f.nombre} exige avisar que es una IA al empezar cada conversación: el primer mensaje del bot lo va a incluir.` });
        }
        if (bot.personalizacion && !f.permitePersonalizacion) {
          sumar({ nivel: 'atencion', funcion: m.funcion, motorId: f.id, texto: `${f.nombre} no permite personalizar según el perfil de cada persona en campañas, y este bot tiene la personalización encendida. Apagala o elegí otro motor.` });
        }
        if (/menores de 18/.test(f.condiciones)) {
          sumar({ nivel: 'atencion', funcion: m.funcion, motorId: f.id, texto: `${f.nombre}: ${f.condiciones}` });
        }
      }
      if (f.entrena) {
        sumar({ nivel: 'atencion', funcion: m.funcion, motorId: f.id, texto: `${f.nombre} usa los datos para entrenar por defecto: hay que apagarlo en el panel del proveedor antes de usarlo en un bot real.` });
      }
    }
    if (principal && respaldo && principal.empresa === respaldo.empresa) {
      sumar({ nivel: 'atencion', funcion: m.funcion, motorId: null, texto: `${ETIQUETA_FUNCION[m.funcion]}: el respaldo es de la misma empresa que el principal (${principal.empresa}). Si esa empresa corta el servicio, se caen los dos.` });
    }
    if (!respaldo && principal?.ruta !== 'simulado') {
      sumar({ nivel: 'atencion', funcion: m.funcion, motorId: null, texto: `${ETIQUETA_FUNCION[m.funcion]} no tiene motor de respaldo: si el principal falla, el bot responde solo con menús.` });
    }
  }
  return avisos;
}

/** ¿Algún motor de cara al público exige el aviso de IA? Entonces el primer mensaje lo incluye siempre. */
export function exigeAvisoIa(motores: readonly MotorFuncion[], fichas?: readonly FichaMotor[]): boolean {
  return motores.some((m) => m.funcion !== 'copiloto' && [m.principal, m.respaldo].some((id) => id && fichaMotor(id, fichas)?.exigeAvisoIa));
}
