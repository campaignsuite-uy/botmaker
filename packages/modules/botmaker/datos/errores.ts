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
  if (/Motor desconocido/.test(m)) return new ErrorDatos('motor', m);
  if (/No existe el bot/.test(m) || c === 'P0002') return new ErrorDatos('no_existe', m);
  if (/no es integrante/.test(m)) return new ErrorDatos('no_integrante', m);
  if (/Administrador en todos sus productos/.test(m)) return new ErrorDatos('admin_campana', m);
  if (/clave del formulario/.test(m)) return new ErrorDatos('clave', m);
  if (c === '23514' || c === '22023' || c === '23502') return new ErrorDatos('datos', m);
  return new ErrorDatos('no_se_pudo', m);
}
