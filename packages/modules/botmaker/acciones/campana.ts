/** La campaña vista desde el núcleo de la plataforma, con lo que usan las acciones (no es un archivo 'use server'). */
import type { DatosNucleo } from '@campaignsuite/platform';

export function campanaDelNucleo(nucleo: DatosNucleo, campanaId: string): { nombre: string; zonaHoraria: string } | undefined {
  const c = nucleo.campanas.find((x) => x.id === campanaId);
  return c ? { nombre: c.nombre, zonaHoraria: c.ubicacion.zonaHoraria } : undefined;
}
