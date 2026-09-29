/**
 * Copiloto (etapa 4, tareas 4.02 y 4.03): pedirle a la IA que arme o cambie el borrador, que proponga frases para las
 * intenciones o que revise el bot. La propuesta llega operación por operación y la persona marca cuáles aplicar.
 */
import type { Repositorio } from '../datos/repositorio';
import { MODOS_COPILOTO, MODO_COPILOTO, type ModoCopiloto } from '../dominio/copiloto';
import { fechaHoraUtc } from '../dominio/formato';
import { fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { simularMotores } from '../motores/claves';
import type { ContextoPantalla } from '../ui/contexto';
import { hrefBot } from './bot-comun';
import { baseParte, type BaseParte } from './partes';

export interface VistaCopiloto extends BaseParte {
  puedeUsar: boolean;
  simulado: boolean;
  motor: string;
  modos: { id: ModoCopiloto; titulo: string; ayuda: string; ejemplo: string }[];
  secciones: number;
  /** Los últimos cambios que hizo el copiloto en este borrador. */
  historial: { seq: number; fecha: string; resumen: string; quien: string }[];
  hrefMaterial: string;
  hrefFlujos: string;
}

export async function vistaCopiloto(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaCopiloto | null> {
  const x = await baseParte(repo, ctx, botId, 'copiloto');
  if (!x) return null;
  const [motores, fichas, cambios] = await Promise.all([
    repo.motoresDeBot(x.b.bot.id), repo.fichas(), x.b.borrador ? repo.cambios(x.b.borrador.id) : Promise.resolve([]),
  ]);
  const m = motores.find((y) => y.funcion === 'copiloto');
  const nombre = (id: string | null) => (id ? fichaMotor(id, fichas)?.nombre ?? id : null);
  const persona = (id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien que ya no está' : '—');
  return {
    ...x.comun,
    puedeUsar: x.comun.editable && puede(ctx.rol, 'editar_borrador'),
    simulado: simularMotores(),
    motor: m ? `${nombre(m.principal)}${m.respaldo ? `, con ${nombre(m.respaldo)} de respaldo` : ''}` : 'sin motor elegido',
    modos: MODOS_COPILOTO.map((id) => ({ id, titulo: MODO_COPILOTO[id].titulo, ayuda: MODO_COPILOTO[id].ayuda, ejemplo: MODO_COPILOTO[id].ejemplo })),
    secciones: x.b.definicion?.material.length ?? 0,
    historial: cambios.filter((c) => c.origen === 'copiloto').slice(-10).reverse().map((c) => ({ seq: c.seq, fecha: fechaHoraUtc(c.fecha), resumen: c.resumen, quien: persona(c.personaId) })),
    hrefMaterial: hrefBot(ctx, x.b.bot.id, 'material'),
    hrefFlujos: hrefBot(ctx, x.b.bot.id, 'flujos'),
  };
}
