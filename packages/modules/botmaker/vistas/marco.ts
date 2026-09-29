/** Datos del marco de BotMaker: el menú lateral (según el rol) y la barra de arriba. */
import type { Repositorio } from '../datos/repositorio';
import { ETIQUETA_ROL, puede } from '../dominio/permisos';
import { nombreMercado } from '../dominio/mercados';
import { ruta, type ContextoPantalla } from '../ui/contexto';

export type SeccionBots = 'bots' | 'nuevo' | 'bandeja' | 'motores' | 'costos' | 'equipo';

export interface ItemMenu {
  id: SeccionBots;
  texto: string;
  href: string;
  insignia: string | null;
}

export interface DatosMarco {
  estado: string;
  grupos: { titulo: string; items: ItemMenu[] }[];
  contexto: string;
  pais: string;
  rolTexto: string;
}

export async function datosMarco(repo: Repositorio, ctx: ContextoPantalla): Promise<DatosMarco> {
  const bots = await repo.bots(ctx.campana.id).catch(() => []);
  const it = (id: SeccionBots, texto: string, seccion: string, insignia: string | null = null): ItemMenu => ({ id, texto, href: ruta(ctx, seccion), insignia });
  const grupos: DatosMarco['grupos'] = [];
  const armar: ItemMenu[] = [it('bots', 'Bots', '', bots.length ? String(bots.length) : null)];
  if (puede(ctx.rol, 'editar_borrador') && !ctx.organizacion.demo) armar.push(it('nuevo', 'Nuevo bot', 'nuevo'));
  grupos.push({ titulo: 'Armar', items: armar });
  if (puede(ctx.rol, 'leer_conversaciones')) {
    const esperan = await repo.conversaciones(ctx.campana.id, { estado: 'derivada', limite: 500 }).then((x) => x.length).catch(() => 0);
    grupos.push({ titulo: 'Conversaciones', items: [it('bandeja', 'Bandeja', 'bandeja', esperan ? String(esperan) : null)] });
  }
  const config: ItemMenu[] = [it('motores', 'Motores', 'motores')];
  if (puede(ctx.rol, 'ver_costos')) config.push(it('costos', 'Costos', 'costos'));
  config.push(it('equipo', 'Equipo y roles', 'equipo'));
  grupos.push({ titulo: 'Configuración', items: config });
  const publicados = bots.filter((b) => b.estado === 'publicado').length;
  return {
    estado: bots.length ? `${bots.length} ${bots.length === 1 ? 'bot' : 'bots'} · ${publicados} publicados` : 'Sin bots todavía',
    grupos,
    contexto: `${ctx.campana.pais || nombreMercado(ctx.campana.paisIso)} · ${ctx.organizacion.nombre}`,
    pais: ctx.campana.paisIso,
    rolTexto: ETIQUETA_ROL[ctx.rol],
  };
}
