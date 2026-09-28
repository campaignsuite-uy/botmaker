/**
 * Entorno de la plataforma: si la app corre como **demo online de solo lectura** (docs/despliegue.md →
 * "Demo online"). Sin dependencias de Next: lo usan el proxy (apps/web/proxy.ts), las pantallas, las
 * acciones del servidor y el repositorio de la demo.
 *
 * En solo lectura se mira todo y se prueban los formularios, pero no se guarda nada. Lo aseguran tres capas:
 *  1. el navegador no envía los formularios que guardan (aviso en pantalla, apps/web/app/layout.tsx);
 *  2. el proxy rechaza cualquier pedido que no sea de lectura (GET o HEAD), salvo elegir persona en /ingresar;
 *  3. cada acción del servidor lo vuelve a exigir (acciones/comun.ts, organizacion.ts y panel.ts).
 */

/**
 * La demo online es de solo lectura si se pide con CAMPAIGNSUITE_SOLO_LECTURA=1 y, siempre, en Vercel con los
 * datos de la demo: ahí cada instancia tiene su propia copia en memoria, así que un cambio se perdería o lo
 * vería una sola persona.
 */
export function soloLectura(): boolean {
  if (process.env.CAMPAIGNSUITE_SOLO_LECTURA === '1') return true;
  const datos = process.env.CAMPAIGNSUITE_DATOS || 'demo';
  return process.env.VERCEL === '1' && datos === 'demo';
}

/** De dónde salen los datos: la demo en memoria (por defecto) o la base de Supabase. */
export function modoDatos(): 'demo' | 'supabase' {
  return (process.env.CAMPAIGNSUITE_DATOS || 'demo') === 'supabase' ? 'supabase' : 'demo';
}

/** Lo que las funciones de rótulos necesitan saber de la organización que se está mirando. */
export interface OrganizacionRotulo {
  nombre: string;
  demo?: boolean;
}

/**
 * Si los datos son simulados: la demo en memoria (CAMPAIGNSUITE_DATOS=demo) o, con la base real, una
 * organización demo (2.15): las respuestas de los motores y los números salen de corridas simuladas.
 */
export function datosSimulados(org?: OrganizacionRotulo | null): boolean {
  return modoDatos() === 'demo' || !!org?.demo;
}

/** Rótulo de los pies de página y de los informes cuando los datos son simulados. */
export const ROTULO_SIMULADOS = 'respuestas y números simulados';

/** Nombre de la demo online (organización demo de la entrega 2: "Demo - Referencia", 2.15 de pendientes.md). */
export const NOMBRE_DEMO_ONLINE = 'Demo - Referencia';

/** Rótulo de la demo online (2.15 de pendientes.md): en la barra, en el encabezado de los informes y en las descargas. */
export const ETIQUETA_DEMO_ONLINE = `Datos simulados · ${NOMBRE_DEMO_ONLINE}`;

/**
 * Rótulo de la barra superior: en una organización demo de la base, "Datos simulados · <nombre>"; en la demo
 * online, "Datos simulados · Demo - Referencia"; con la demo en memoria, "Datos de prueba"; con datos reales, nada.
 */
export function etiquetaDatos(org?: OrganizacionRotulo | null): string | null {
  if (org?.demo) return `Datos simulados · ${org.nombre}`;
  if (soloLectura()) return ETIQUETA_DEMO_ONLINE;
  return modoDatos() === 'demo' ? 'Datos de prueba' : null;
}

/** Explicación del rótulo de una organización demo de la base (2.15). */
export const AVISO_DEMO =
  'Demo solo para mirar: se ve todo como un Administrador, pero no se cambia nada. Los candidatos y el contexto son ' +
  'reales, pero pueden tener errores o estar incompletos; los resultados no salen de corridas reales.';

/** Explicación del rótulo (al pasar el mouse) y del aviso que aparece si se intenta guardar algo. */
export const AVISO_SOLO_LECTURA =
  'Demo online de solo lectura: podés mirar todo y probar los formularios, pero no se guarda ningún cambio. ' +
  'Los candidatos y el contexto son de la elección de Panamá; las respuestas de los motores y los números salen de corridas simuladas.';

/** Texto al pasar el mouse por el rótulo: en una demo de la base y en la demo online. */
export function tituloEtiquetaDatos(org?: OrganizacionRotulo | null): string | undefined {
  if (org?.demo) return AVISO_DEMO;
  return soloLectura() ? AVISO_SOLO_LECTURA : undefined;
}

/** "Demo - Referencia (respaldo)" → "demo-referencia-respaldo". */
export function aSlug(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Prefijo de los archivos que se bajan de una demo (de la base o la online), para que no se confundan con datos
 * de una corrida real: "datos-simulados_<demo>_<archivo>".
 */
export function nombreArchivoDescarga(nombre: string, org?: OrganizacionRotulo | null): string {
  if (org?.demo) return `datos-simulados_${aSlug(org.nombre)}_${nombre}`;
  return soloLectura() ? `datos-simulados_demo-referencia_${nombre}` : nombre;
}
