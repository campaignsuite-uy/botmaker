/**
 * Error de datos con un código que entienden las acciones (vistas/mensajes.ts lo traduce a un texto). Lo tiran los dos
 * repositorios: la demo con sus propias reglas y Supabase traduciendo el error de la base.
 */
export class ErrorDatos extends Error {
  constructor(readonly codigo: string, mensaje?: string) {
    super(mensaje ?? codigo);
  }
}

/** Traduce un error de la base (Supabase / PostgREST) a un ErrorDatos. */
export function errorDeBase(e: { message: string; code?: string } | null | undefined, que: string): ErrorDatos {
  const m = e?.message ?? `No se pudo ${que}.`;
  const c = e?.code ?? '';
  if (c === '42501' || /no permite esta acción|Solo el Administrador|permission denied|row-level security/i.test(m)) return new ErrorDatos('sin_permiso', m);
  if (/archivado/.test(m)) return new ErrorDatos('archivado', m);
  if (/respaldo tiene que ser otro/.test(m)) return new ErrorDatos('respaldo_igual', m);
  if (/conversación cambió/.test(m)) return new ErrorDatos('conversacion_cambio', m);
  if (c === '23505' && /channel_message_id/.test(m)) return new ErrorDatos('repetido', m);
  if (c === '40001' || /borrador cambió/.test(m)) return new ErrorDatos('borrador_cambio', m);
  if (/Solo se pausa un bot publicado/.test(m)) return new ErrorDatos('no_publicado', m);
  if (/no está en pausa/.test(m)) return new ErrorDatos('no_pausado', m);
  if (/primero hay que tomar|no está derivada/.test(m)) return new ErrorDatos('no_derivada', m);
  if (/conversación está cerrada/.test(m)) return new ErrorDatos('conversacion_cerrada', m);
  if (/no está en la muestra/.test(m)) return new ErrorDatos('no_muestra', m);
  if (/No existe la conversación|No existe el contacto/.test(m)) return new ErrorDatos('no_existe', m);
  if (/ya no es un borrador/.test(m)) return new ErrorDatos('no_borrador', m);
  if (/versión de la que partir/.test(m)) return new ErrorDatos('sin_version', m);
  if (/Falta correr las pruebas/.test(m)) return new ErrorDatos('sin_corrida', m);
  if (/baja el acierto/.test(m)) return new ErrorDatos('baja_acierto', m);
  if (/no tiene un pedido de publicación/.test(m)) return new ErrorDatos('sin_pedido', m);
  if (/hace falta un comentario/.test(m)) return new ErrorDatos('falta_comentario', m);
  if (/La corrida ya terminó/.test(m)) return new ErrorDatos('corrida_terminada', m);
  if (/doble lectura/.test(m)) return new ErrorDatos('doble_lectura', m);
  if (/Motor desconocido/.test(m)) return new ErrorDatos('motor', m);
  if (/no sirve para la función/.test(m)) return new ErrorDatos('motor_funcion', m);
  if (/No existe el bot/.test(m) || c === 'P0002') return new ErrorDatos('no_existe', m);
  if (/no es integrante/.test(m)) return new ErrorDatos('no_integrante', m);
  if (/Administrador en todos sus productos/.test(m)) return new ErrorDatos('admin_campana', m);
  if (/clave del formulario/.test(m)) return new ErrorDatos('clave', m);
  if (c === '23514' || c === '22023' || c === '23502') return new ErrorDatos('datos', m);
  return new ErrorDatos('no_se_pudo', m);
}
