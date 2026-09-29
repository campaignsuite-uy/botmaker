/**
 * El repositorio de la app pública y de las tareas de fondo: sin sesión de persona. En la demo es el mismo repositorio en
 * memoria que usa la app del equipo (así, dentro de un mismo servidor, lo que conversa el widget aparece en la bandeja);
 * con Supabase, la clave de servicio y solo las funciones bots.publico_* y bots.tarea_* (SOLO SERVIDOR).
 */
import { obtenerRepositorio } from './index';
import type { RepositorioPublico, RepositorioTareas, RepositorioWhatsapp } from './repositorio';
import type { RepositorioDemo } from './demo/repositorio-demo';
import { RepositorioPublicoSupabase } from './supabase/publico-supabase';

const global_ = globalThis as unknown as { __botsPublico?: RepositorioPublico & RepositorioTareas & RepositorioWhatsapp };

export function obtenerRepositorioPublico(): RepositorioPublico & RepositorioTareas & RepositorioWhatsapp {
  if (global_.__botsPublico) return global_.__botsPublico;
  const modo = process.env.CAMPAIGNSUITE_DATOS || 'demo';
  if (modo === 'supabase') {
    global_.__botsPublico = RepositorioPublicoSupabase.desdeEntorno();
    return global_.__botsPublico;
  }
  // Duck typing y no instanceof: cada ruta de Next puede tener su copia de la clase, pero el objeto es uno (globalThis).
  const r = obtenerRepositorio() as Partial<RepositorioDemo>;
  if (typeof r.abrirConversacion !== 'function' || typeof r.borrarVencidos !== 'function' || typeof r.recibirEntradas !== 'function') throw new Error('La demo necesita el repositorio en memoria.');
  return r as RepositorioDemo;
}
