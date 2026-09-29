/**
 * Núcleo del simulador (tarea 2.13), sin Next: un turno de conversación con el borrador, con los mismos motores que
 * producción (la capa de motores, uso "simulador": cada llamada queda registrada con su costo). La sesión la guarda
 * el navegador y vuelve en cada turno; acá se valida su forma para que una sesión rota no rompa nada.
 */
import { z } from 'zod';
import { sesionNueva, turno, type Entrada, type ResultadoTurno, type Sesion } from '../dominio/motor';
import { puede } from '../dominio/permisos';
import type { CapaMotores } from '../motores/capa';
import { serviciosDeCapa } from '../motores/servicios';
import type { ContextoNucleo } from './ejecutar-bots';
import { leerBorrador } from './ejecutar-borrador';

const esquemaSesion = z.object({
  espera: z.union([
    z.object({ tipo: z.literal('opciones'), cajaId: z.string() }),
    z.object({ tipo: z.literal('dato'), cajaId: z.string(), intentos: z.number().int().min(0).max(10) }),
    z.object({ tipo: z.literal('texto'), cajaId: z.string() }),
    z.object({ tipo: z.literal('aclaracion'), opciones: z.array(z.object({ letra: z.string(), intencion: z.string() })).max(4), texto: z.string().max(2000) }),
  ]).nullable(),
  variables: z.record(z.string().max(40), z.string().max(500)),
  estado: z.enum(['bot', 'derivada']),
  turnos: z.array(z.object({ quien: z.enum(['persona', 'bot']), texto: z.string().max(5000) })).max(20),
  iniciada: z.boolean(),
});

const esquemaEntrada = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('inicio') }),
  z.object({ tipo: z.literal('texto'), texto: z.string().trim().min(1).max(2000) }),
  z.object({ tipo: z.literal('opcion'), cajaId: z.string().max(40), letra: z.string().max(3), titulo: z.string().max(200) }),
]);

export interface PedidoTurno {
  botId: string;
  sesion: unknown;
  entrada: unknown;
  /** Fijar el horario de atención para probar las condiciones de horario. */
  horario: 'dentro' | 'fuera';
  /** Variables del contacto fijadas a mano (contacto.nombre…). */
  variables?: Record<string, string>;
}

export type ResultadoSimulador = ({ ok: true; seq: number; numero: number } & ResultadoTurno) | { ok: false; codigo: string };

export async function ejecutarTurnoSimulador(c: ContextoNucleo & { campana: { nombre: string } }, capa: CapaMotores, p: PedidoTurno): Promise<ResultadoSimulador> {
  if (!puede(c.rol, 'correr_pruebas')) return { ok: false, codigo: 'sin_permiso' };
  const bot = await c.repo.bot(String(p.botId));
  if (!bot || bot.campanaId !== c.campanaId) return { ok: false, codigo: 'no_existe' };
  const l = await leerBorrador(c.repo, bot.id);
  if ('codigo' in l) return { ok: false, codigo: l.codigo };
  const e = esquemaEntrada.safeParse(p.entrada);
  if (!e.success) return { ok: false, codigo: 'datos' };
  const s = p.sesion === null || p.sesion === undefined ? sesionNueva() : esquemaSesion.safeParse(p.sesion);
  const sesion: Sesion = 'success' in s ? (s.success ? (s.data as Sesion) : sesionNueva()) : s;
  for (const [k, v] of Object.entries(p.variables ?? {})) {
    if (/^contacto\.[a-z][a-z0-9_]{0,29}$/.test(k) && typeof v === 'string') sesion.variables[k] = v.slice(0, 500);
  }
  const servicios = serviciosDeCapa(capa, {
    bot, campana: c.campana, definicion: l.definicion, uso: 'simulador', personaId: c.personaId,
    dentroDeHorario: () => p.horario !== 'fuera',
  });
  const r = await turno(l.definicion, sesion, e.data as Entrada, servicios);
  return { ok: true, seq: l.borrador.seq, numero: l.borrador.numero, ...r };
}
