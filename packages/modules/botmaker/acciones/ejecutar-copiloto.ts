/**
 * Núcleo del copiloto (etapa 4, tareas 4.02 y 4.03), sin Next:
 *  - pedir: arma la entrada (borrador legible, avisos del validador y, según el modo, el material), llama a la capa de
 *    motores (función copiloto, uso "copiloto": queda en Costos) y devuelve la propuesta revisada operación por
 *    operación contra el borrador;
 *  - aplicar: las operaciones que marcó la persona, juntas, como un cambio de origen "copiloto" (se deshace entero).
 *    Si el borrador cambió desde la propuesta, no se aplica: hay que pedirla de nuevo.
 */
import { materialPara } from '../dominio/definicion';
import { borradorLegible, MODOS_COPILOTO, revisarPropuesta, type ItemPropuesta, type ModoCopiloto } from '../dominio/copiloto';
import { tokensAproximados } from '../dominio/material';
import { fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { revisarBot } from '../dominio/validador';
import type { CapaMotores } from '../motores/capa';
import { contextoDeBot } from '../motores/servicios';
import type { ContextoNucleo } from './ejecutar-bots';
import { ejecutarCambio, leerBorrador, type ResultadoBorrador } from './ejecutar-borrador';

/** Tope del material que va al copiloto (en tokens aproximados): el de una campaña grande entra; uno enorme se recorta. */
export const TOPE_MATERIAL_COPILOTO = 60_000;

export type ResultadoCopiloto =
  | {
    ok: true;
    seq: number;
    items: ItemPropuesta[];
    explicacion: string;
    dudas: string[];
    motor: string | null;
    costoUsd: number;
    demoraMs: number;
    simulado: boolean;
    materialRecortado: boolean;
  }
  | { ok: false; codigo: string };

export async function ejecutarPedirCopiloto(
  c: ContextoNucleo & { campana: { nombre: string } },
  capa: CapaMotores,
  p: { botId: string; modo: string; pedido: string },
): Promise<ResultadoCopiloto> {
  if (!puede(c.rol, 'editar_borrador')) return { ok: false, codigo: 'sin_permiso' };
  const pedido = p.pedido.trim();
  if (!pedido) return { ok: false, codigo: 'pedido_vacio' };
  if (pedido.length > 4000) return { ok: false, codigo: 'pedido_largo' };
  const modo: ModoCopiloto = (MODOS_COPILOTO as readonly string[]).includes(p.modo) ? (p.modo as ModoCopiloto) : 'cambios';
  const bot = await c.repo.bot(p.botId);
  if (!bot || bot.campanaId !== c.campanaId) return { ok: false, codigo: 'no_existe' };
  if (bot.estado === 'archivado') return { ok: false, codigo: 'archivado' };
  const l = await leerBorrador(c.repo, bot.id);
  if ('codigo' in l) return { ok: false, codigo: l.codigo };
  const def = l.definicion;

  // El material va entero cuando se arma o se revisa (el copiloto no tiene que prometer lo que no dice); para un cambio
  // puntual o las frases, no hace falta. Se recorta por secciones si pasa el tope.
  let material = modo === 'armar' || modo === 'revision' ? materialPara(def, []) : [];
  let recortado = false;
  let total = 0;
  material = material.filter((s) => {
    total += tokensAproximados([s]);
    if (total > TOPE_MATERIAL_COPILOTO) recortado = true;
    return total <= TOPE_MATERIAL_COPILOTO;
  });
  const rev = revisarBot(def);
  const avisos = [...rev.errores, ...rev.avisos].slice(0, 40).map((h) => `${h.nivel === 'error' ? 'Error' : 'Aviso'} en ${h.donde}: ${h.mensaje}`);
  const r = await capa.llamar({
    funcion: 'copiloto', uso: 'copiloto', bot: { id: bot.id, campanaId: bot.campanaId },
    contexto: contextoDeBot({ bot, campana: c.campana, definicion: def }),
    entrada: { pedido, modo, borrador: borradorLegible(def), avisos, material: material.map((s) => ({ codigo: s.codigo, titulo: s.titulo, texto: s.texto })), definicion: def },
    personaId: c.personaId,
  });
  if (!r.salida) return { ok: false, codigo: r.motivo === 'tope_diario' || r.motivo === 'tope_mensual' ? 'copiloto_tope' : r.motivo === 'sin_motor' ? 'copiloto_sin_motor' : 'copiloto_fallo' };
  const revisada = revisarPropuesta(def, r.salida);
  const fichas = await c.repo.fichas();
  return {
    ok: true, seq: l.borrador.seq, ...revisada,
    motor: r.motorId ? fichaMotor(r.motorId, fichas)?.nombre ?? r.motorId : null,
    costoUsd: r.costoUsd, demoraMs: r.demoraMs, simulado: r.simulado, materialRecortado: recortado,
  };
}

export async function ejecutarAplicarCopiloto(c: ContextoNucleo, p: { botId: string; seq: number; operaciones: unknown[] }): Promise<ResultadoBorrador> {
  if (!Array.isArray(p.operaciones) || !p.operaciones.length) return { ok: false, codigo: 'nada_marcado' };
  const bot = await c.repo.bot(p.botId);
  if (!bot || bot.campanaId !== c.campanaId) return { ok: false, codigo: 'no_existe' };
  const l = await leerBorrador(c.repo, bot.id);
  if ('codigo' in l) return { ok: false, codigo: l.codigo };
  // La propuesta se revisó contra un borrador: si cambió, las direcciones y los ids pueden no ser los mismos.
  if (l.borrador.seq !== p.seq) return { ok: false, codigo: 'copiloto_viejo' };
  return ejecutarCambio(c, { botId: bot.id, seq: p.seq, operaciones: p.operaciones, origen: 'copiloto' });
}
