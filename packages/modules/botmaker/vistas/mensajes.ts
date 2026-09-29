/**
 * Textos de los avisos que aparecen arriba de una pantalla después de una acción (?ok=código o ?error=código). Las
 * acciones vuelven con un código; el texto se arma acá, así la dirección nunca lleva texto armado por alguien.
 */
const OK: Record<string, string> = {
  bot_creado: 'Listo: el bot quedó creado en borrador, con la plantilla y los motores por defecto.',
  borrador_creado: 'Listo: el borrador quedó armado. Ya se puede editar.',
  bot_guardado: 'Listo: se guardaron los datos del bot.',
  motores_guardados: 'Listo: se guardaron los motores y los topes de gasto.',
  datos_personales_guardados: 'Listo: se guardaron la personalización y los días de guardado.',
  bot_archivado: 'El bot quedó archivado. Sus datos se conservan.',
  rol_guardado: 'Listo: se guardó el rol.',
  sin_acceso: 'Listo: la persona quedó sin acceso a BotMaker.',
  prueba_ok: 'El motor respondió. El resultado está en Motores y gasto.',
};

const ERROR: Record<string, string> = {
  sin_permiso: 'Tu rol no permite esa acción.',
  solo_lectura: 'Demo online de solo lectura: no se guarda ningún cambio.',
  sesion: 'Tenés que ingresar de nuevo.',
  demo: 'Es una organización de demostración: se puede mirar, no cambiar.',
  nombre_vacio: 'Poné un nombre para el bot.',
  nombre_largo: 'El nombre puede tener hasta 80 caracteres.',
  caso: 'Elegí si el bot es electoral o político.',
  mercado: 'Elegí un mercado de la lista.',
  trato: 'Elegí el trato: usted o tú.',
  aviso_largo: 'El aviso de IA puede tener hasta 300 caracteres.',
  candidato_vacio: 'Poné el nombre del candidato o de quien representa el bot.',
  candidato_largo: 'El nombre del candidato puede tener hasta 80 caracteres.',
  partido_largo: 'El nombre del partido puede tener hasta 80 caracteres.',
  sin_borrador: 'Este bot todavía no tiene borrador. Armalo primero.',
  sin_version: 'El bot no tiene una versión de la que partir: armá el borrador con la plantilla.',
  no_borrador: 'Esa versión ya no es un borrador: no se puede cambiar.',
  borrador_cambio: 'Otra persona cambió el borrador mientras lo editabas. Recargá para ver lo último.',
  borrador_invalido: 'El borrador guardado tiene un problema y no se puede editar así. Avisale al equipo de BotMaker.',
  operacion_invalida: 'Ese cambio no es válido.',
  definicion_invalida: 'Ese cambio dejaría el bot con un error, así que no se aplicó.',
  nada_que_deshacer: 'No hay nada para deshacer.',
  nada_que_rehacer: 'No hay nada para rehacer.',
  tope: 'Los topes tienen que ser montos en dólares, de 0 en adelante.',
  tope_diario_mayor: 'El tope diario no puede ser mayor que el mensual.',
  dias: 'Los días de guardado van de 1 a 365.',
  motor: 'Ese motor no existe o está apagado.',
  motor_funcion: 'Ese motor no sirve para esa función: mirá en Motores para qué funciones es candidato cada uno.',
  respaldo_igual: 'El respaldo tiene que ser otro motor.',
  doble_lectura: 'La doble lectura necesita un motor de respaldo, y es solo para interpretar.',
  archivado: 'El bot está archivado: no se puede cambiar.',
  no_existe: 'Ese bot no existe o no es de esta campaña.',
  campana: 'BotMaker no está preparado en esta campaña: pedíselo a quien administra la organización.',
  no_integrante: 'Esa persona no está en la campaña.',
  admin_campana: 'Quien administra la campaña es administrador de BotMaker: su rol no se cambia acá.',
  rol: 'Ese rol no existe en BotMaker.',
  clave: 'El formulario ya se usó en otra campaña. Recargá la página y probá de nuevo.',
  datos: 'Algún dato no es válido. Revisalo y probá de nuevo.',
  producto: 'BotMaker no está habilitado en esta campaña.',
  prueba_falla: 'El motor no respondió bien. El detalle está en Motores y gasto.',
  no_se_pudo: 'No se pudo guardar. Probá de nuevo; si sigue, avisale al administrador.',
};

export interface MensajePantalla {
  tipo: 'ok' | 'error';
  texto: string;
}

export function mensajeDe(parametros: Record<string, string | undefined>): MensajePantalla | null {
  if (parametros.ok) return { tipo: 'ok', texto: OK[parametros.ok] ?? 'Listo.' };
  if (parametros.error) return { tipo: 'error', texto: ERROR[parametros.error] ?? ERROR.no_se_pudo! };
  return null;
}

export const CODIGOS_OK = Object.keys(OK);
export const CODIGOS_ERROR = Object.keys(ERROR);
