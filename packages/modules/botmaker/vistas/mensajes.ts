/**
 * Textos de los avisos que aparecen arriba de una pantalla después de una acción (?ok=código o ?error=código). Las
 * acciones vuelven con un código; el texto se arma acá, así la dirección nunca lleva texto armado por alguien.
 */
const OK: Record<string, string> = {
  bot_creado: 'Listo: el bot quedó creado en borrador, con la plantilla y los motores por defecto.',
  borrador_creado: 'Listo: el borrador quedó armado. Ya se puede editar.',
  yaml_importado: 'Listo: se importó el YAML. Si algo no quedó bien, se deshace desde Flujos.',
  publicacion_pedida: 'Listo: se pidió publicar. El administrador lo revisa y lo aprueba o lo devuelve.',
  publicacion_aprobada: 'Listo: la versión quedó publicada.',
  publicacion_devuelta: 'Listo: se devolvió el pedido con tu comentario.',
  conversacion_tomada: 'Listo: la conversación es tuya. El bot no contesta en ella hasta que la devuelvas.',
  respuesta_enviada: 'Listo: la respuesta le llega a la persona por el mismo canal.',
  conversacion_devuelta: 'Listo: la conversación volvió al bot.',
  conversacion_cerrada: 'Listo: la conversación quedó cerrada. Si la persona vuelve a escribir, empieza otra.',
  respuesta_revisada: 'Listo: quedó revisada.',
  respuesta_convertida: 'Listo: quedó revisada y la respuesta es un contenido nuevo del borrador (en Contenidos).',
  contacto_exportado: 'Listo: se descargaron los datos del contacto. Quedó registrado.',
  contacto_borrado: 'Listo: se borraron los datos del contacto y el texto de sus mensajes. Quedó registrado.',
  canal_guardado: 'Listo: se guardó el canal web.',
  condiciones_publicadas: 'Listo: se publicaron las condiciones nuevas. Quien ya conversaba las acepta al seguir (o con el botón, si se piden).',
  bot_pausado: 'El bot quedó en pausa: no contesta en ningún canal y lo que llega va a la bandeja.',
  bot_reanudado: 'Listo: el bot volvió a contestar.',
  copiloto_aplicado: 'Listo: se aplicó lo que marcaste de la propuesta del copiloto. Se deshace con Deshacer.',
  cambio_guardado: 'Listo: se guardó el cambio. Si algo no quedó bien, se deshace arriba.',
  deshecho: 'Listo: se deshizo el último cambio.',
  rehecho: 'Listo: se rehízo el cambio.',
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
  sin_publicada: 'Este bot no tiene una versión publicada.',
  operacion_invalida: 'Ese cambio no es válido.',
  definicion_invalida: 'Ese cambio dejaría el bot con un error, así que no se aplicó.',
  nada_que_deshacer: 'No hay nada para deshacer.',
  nada_que_rehacer: 'No hay nada para rehacer.',
  yaml: 'El YAML tiene problemas: mirá la lista de abajo, con la línea de cada uno.',
  yaml_desactualizado: 'El borrador cambió desde que se exportó este YAML. Si lo importás igual, se pierde lo que se cambió en el medio.',
  sin_cambios: 'No hay nada que cambiar: es igual a lo que ya está.',
  id_invalido: 'El id va en minúsculas, con números y guion bajo, y empieza con una letra.',
  variable_invalida: 'El nombre de la variable va en minúsculas, con números y guion bajo.',
  variable_inexistente: 'Esa variable no existe.',
  contenido_inexistente: 'Ese contenido ya no existe. Recargá para ver lo último.',
  contenido_invalido: 'El contenido no es válido: revisá el nombre, el texto y, si es imagen o documento, la dirección del archivo (https://…).',
  intencion_inexistente: 'Esa intención ya no existe. Recargá para ver lo último.',
  intencion_invalida: 'La intención no es válida: revisá el nombre y la descripción.',
  tema_inexistente: 'Ese tema ya no existe. Recargá para ver lo último.',
  tema_invalido: 'El tema no es válido: revisá el nombre.',
  flujo_inexistente: 'Ese flujo ya no existe. Recargá para ver lo último.',
  caja_invalida: 'La caja no quedaría válida con esos datos.',
  caja_de_otro_flujo: 'Esa caja es de otro flujo.',
  opcion_inexistente: 'Esa opción ya no existe. Recargá para ver lo último.',
  salida_inexistente: 'Esa salida no existe en la caja.',
  campo_fijo: 'Ese dato no se cambia así.',
  limite: 'Se llegó al máximo que admite el bot.',
  ultima_opcion: 'Un menú necesita al menos una opción.',
  sin_opciones: 'Esa caja no tiene opciones.',
  ultimo_flujo: 'El bot necesita al menos un flujo.',
  sin_corrida: 'Antes de pedir publicar hay que correr las pruebas sobre el último cambio del borrador.',
  baja_acierto: 'Esta versión baja 2 puntos o más de acierto contra la publicada: no se puede pedir publicar. Revisá los casos que empeoraron.',
  sin_pedido: 'Esa versión no tiene un pedido de publicación.',
  falta_comentario: 'Para devolver hace falta un comentario que diga qué cambiar.',
  corrida_terminada: 'Esa corrida ya terminó.',
  sin_casos: 'El bot no tiene casos de prueba: cargalos en Pruebas.',
  corrida_vieja: 'El borrador cambió desde que empezó la corrida: se canceló. Empezá otra.',
  errores_validador: 'El borrador tiene errores del validador: resolvelos en Flujos antes de pedir publicar.',
  caso_invalido: 'El caso no es válido: revisá el mensaje y la intención.',
  caso_inexistente: 'Ese caso ya no existe. Recargá para ver lo último.',
  casos_invalidos: 'Hay renglones que no se pueden leer: revisá el formato (mensaje | intención).',
  respuesta_vacia: 'Escribí la respuesta.',
  respuesta_larga: 'La respuesta puede tener hasta 4.096 caracteres.',
  no_derivada: 'La conversación no está derivada: para responder, primero tomala.',
  conversacion_cerrada: 'La conversación está cerrada.',
  conversacion_cambio: 'La conversación cambió mientras tanto. Recargá para ver lo último.',
  no_muestra: 'Ese mensaje no está en la muestra de revisión.',
  texto_borrado: 'El texto de ese mensaje ya se borró: no se puede convertir en contenido.',
  confirmar_borrado: 'Para borrar, escribí BORRAR en el campo de confirmación.',
  no_publicado: 'Solo se pausa un bot publicado.',
  no_pausado: 'El bot no está en pausa.',
  condiciones_vacias: 'Escribí el texto de las condiciones.',
  condiciones_largas: 'Las condiciones pueden tener hasta 20.000 caracteres.',
  condiciones_iguales: 'Es el mismo texto que ya está publicado.',
  pedido_vacio: 'Escribí qué querés que haga el copiloto.',
  pedido_largo: 'El pedido es muy largo: dividilo en partes.',
  copiloto_tope: 'El bot llegó a su tope de gasto: el copiloto no puede llamar a los motores hasta mañana (o hasta que se suba el tope).',
  copiloto_sin_motor: 'El bot no tiene un motor elegido para el copiloto: elegilo en Ajustes › Motores.',
  copiloto_fallo: 'Los motores del copiloto no respondieron. Probá de nuevo en un rato.',
  copiloto_viejo: 'El borrador cambió desde la propuesta: pedila de nuevo para aplicarla sobre lo último.',
  nada_marcado: 'No hay operaciones marcadas para aplicar.',
  material_vacio: 'No se encontró ninguna sección: cada una empieza con un título de segundo nivel ("## Título").',
  material_largo: 'El archivo pasa los 2 MB: partilo en varias cargas.',
  seccion_invalida: 'La sección no es válida: revisá el título y el texto.',
  seccion_inexistente: 'Esa sección ya no existe. Recargá para ver lo último.',
  caja_inexistente: 'Esa caja ya no existe. Recargá para ver lo último.',
  id_repetido: 'Ese id ya está en uso.',
  contenido_en_uso: 'Ese contenido lo usa alguna caja: cambiá esas cajas antes de quitarlo.',
  variable_en_uso: 'Esa variable se usa en algún texto o caja: cambialos antes de quitarla.',
  es_inicio: 'Esa caja es el inicio del bot o de su flujo: elegí otro inicio antes de quitarla.',
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

/** El texto de un código de error (para las pantallas que reciben el resultado sin recargar, como el editor). */
export function textoError(codigo: string): string {
  return ERROR[codigo] ?? ERROR.no_se_pudo!;
}

export function textoOk(codigo: string): string {
  return OK[codigo] ?? 'Listo.';
}
