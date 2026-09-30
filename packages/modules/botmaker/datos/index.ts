/**
 * Punto único para obtener el repositorio. CAMPAIGNSUITE_DATOS (la misma variable que lee la plataforma) elige:
 *  - "demo" (por defecto): memoria, con dos bots de prueba en Panamá · Pruebas (Panamá);
 *  - "supabase": el esquema `bots`, con la sesión de la persona (tokenSupabase de la plataforma).
 */
import { tokenSupabase } from '@campaignsuite/platform/sesion';
import type { Repositorio } from './repositorio';
import { RepositorioDemo } from './demo/repositorio-demo';
import { RepositorioSupabase } from './supabase/repositorio-supabase';

export type { Repositorio, FiltroLlamadas } from './repositorio';
export { ErrorDatos } from './errores';

const global_ = globalThis as unknown as { __botsRepo?: Repositorio };

export function obtenerRepositorio(): Repositorio {
  if (global_.__botsRepo) return global_.__botsRepo;
  const modo = process.env.CAMPAIGNSUITE_DATOS || 'demo';
  if (modo === 'supabase') {
    global_.__botsRepo = RepositorioSupabase.desdeEntorno(tokenSupabase);
    return global_.__botsRepo;
  }
  if (modo !== 'demo') throw new Error(`CAMPAIGNSUITE_DATOS="${modo}" no existe: usá "demo" o "supabase".`);
  global_.__botsRepo = new RepositorioDemo();
  return global_.__botsRepo;
}

/** Solo para pruebas: usar otro repositorio (por ejemplo, una demo nueva por prueba). */
export function fijarRepositorio(repo: Repositorio | null): void {
  global_.__botsRepo = repo ?? undefined;
}
