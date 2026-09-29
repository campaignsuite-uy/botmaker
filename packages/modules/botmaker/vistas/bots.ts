/**
 * Bots: la lista de bots de la campaña con su caso, mercado, estado y motores. Lo que todavía no existe (acierto,
 * canales, conversaciones) no se muestra: llega con su etapa.
 */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_CASO, ETIQUETA_ESTADO_BOT } from '../dominio/bots';
import { fechaUtc } from '../dominio/formato';
import { nombreMercado } from '../dominio/mercados';
import { fichaMotor } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import type { EstadoBot } from '../dominio/tipos';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { mensajeDe, type MensajePantalla } from './mensajes';

export interface FilaBot {
  id: string;
  nombre: string;
  href: string;
  caso: string;
  mercado: string;
  estado: EstadoBot;
  estadoTexto: string;
  motores: { funcion: string; texto: string }[];
  creado: string;
}

export interface VistaBots {
  mensaje: MensajePantalla | null;
  filas: FilaBot[];
  archivados: number;
  verArchivados: boolean;
  hrefArchivados: string;
  puedeCrear: boolean;
  hrefNuevo: string;
  preparada: boolean;
  demo: boolean;
}

const CORTO = { interpretar: 'Interpretar', responder: 'Responder', copiloto: 'Copiloto' } as const;

export async function vistaBots(repo: Repositorio, ctx: ContextoPantalla): Promise<VistaBots> {
  const verArchivados = ctx.parametros.archivados === '1';
  const [preparada, todos, fichas] = await Promise.all([
    repo.campanaPreparada(ctx.campana.id),
    repo.bots(ctx.campana.id, { archivados: true }),
    repo.fichas(),
  ]);
  const lista = todos.filter((b) => verArchivados || b.estado !== 'archivado');
  const filas: FilaBot[] = [];
  for (const b of lista) {
    const motores = await repo.motoresDeBot(b.id);
    filas.push({
      id: b.id,
      nombre: b.nombre,
      href: ruta(ctx, `${b.id}/flujos`),
      caso: ETIQUETA_CASO[b.caso],
      mercado: nombreMercado(b.mercado),
      estado: b.estado,
      estadoTexto: ETIQUETA_ESTADO_BOT[b.estado],
      motores: motores.filter((m) => m.funcion !== 'copiloto').map((m) => ({ funcion: CORTO[m.funcion], texto: fichaMotor(m.principal, fichas)?.nombre ?? m.principal })),
      creado: fechaUtc(b.creadoEn),
    });
  }
  return {
    mensaje: mensajeDe(ctx.parametros),
    filas,
    archivados: todos.filter((b) => b.estado === 'archivado').length,
    verArchivados,
    hrefArchivados: ruta(ctx, '', verArchivados ? {} : { archivados: '1' }),
    puedeCrear: puede(ctx.rol, 'editar_borrador') && !ctx.organizacion.demo && preparada,
    hrefNuevo: ruta(ctx, 'nuevo'),
    preparada,
    demo: !!ctx.organizacion.demo,
  };
}
