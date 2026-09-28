/**
 * Nombres de las personas para las pantallas ("pedida por Lucía Pérez"). Los datos del módulo guardan el id de
 * la persona (el de la demo o el uuid de core.profiles); acá se traduce a su nombre.
 *
 * El núcleo de la persona de la sesión (sesion.ts → nucleoActual) registra los perfiles que ve en cada pedido; la
 * demo en memoria trae los suyos. Es un mapa de id → nombre: solo se muestra el nombre de alguien que aparece en
 * datos que la persona ya puede ver.
 */
import { NUCLEO_DEMO } from './demo';
import type { Persona } from './tipos';

const global_ = globalThis as unknown as { __campaignsuiteNombres?: Map<string, string> };
const nombres = (global_.__campaignsuiteNombres ??= new Map(NUCLEO_DEMO.personas.map((p) => [p.id, p.nombre])));

export function registrarNombres(personas: Pick<Persona, 'id' | 'nombre'>[]): void {
  for (const p of personas) if (p.nombre) nombres.set(p.id, p.nombre);
}

/** Nombre registrado de una persona, o el id si no se conoce. */
export function nombreRegistrado(id: string): string {
  return nombres.get(id) ?? id;
}

/** "Joaquín Vázquez" → "JV"; sin nombre, las dos primeras letras del correo. */
export function iniciales(nombre: string, email = ''): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return `${partes[0]![0]}${partes[partes.length - 1]![0]}`.toUpperCase();
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase() || '··';
}
