/**
 * Canales del bot (etapa 5): el canal web (widget y página propia), cómo se aceptan las condiciones y sus versiones, y
 * los límites que protegen el gasto. WhatsApp llega en la etapa 7. Configura el administrador (configurar_canales).
 */
import type { Repositorio } from '../datos/repositorio';
import { condicionesPorDefecto, LIMITES_WEB, type ModoCondiciones } from '../dominio/conversaciones';
import { validarDefinicion } from '../dominio/definicion';
import { fechaHoraUtc } from '../dominio/formato';
import { puede } from '../dominio/permisos';
import type { ContextoPantalla } from '../ui/contexto';
import { baseParte, type BaseParte } from './partes';

export interface VistaCanales extends BaseParte {
  publicado: boolean;
  pausado: boolean;
  urlLanding: string;
  snippet: string;
  /** Sin BOTS_URL_PUBLICA (la demo): las direcciones son de esta misma app, en /publico. */
  urlDeDemo: boolean;
  canal: { activo: boolean; modoCondiciones: ModoCondiciones };
  puedeConfigurar: boolean;
  condiciones: { numero: number; texto: string; fecha: string; por: string } | null;
  historial: { numero: number; fecha: string; por: string }[];
  textoPropuesto: string;
  limites: { etiqueta: string; valor: string }[];
}

export function urlPublica(): { base: string; demo: boolean } {
  const u = process.env.BOTS_URL_PUBLICA?.replace(/\/$/, '');
  return u ? { base: u, demo: false } : { base: '/publico', demo: true };
}

export async function vistaCanales(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaCanales | null> {
  const x = await baseParte(repo, ctx, botId, 'canales');
  if (!x) return null;
  const bot = x.b.bot;
  const [canal, condiciones, publicada] = await Promise.all([
    repo.canalWeb(bot.id), repo.condiciones(bot.id), bot.versionPublicadaId ? repo.version(bot.versionPublicadaId) : Promise.resolve(null),
  ]);
  const vp = publicada ? validarDefinicion(publicada.definicion) : null;
  const def = x.b.definicion ?? (vp?.ok ? vp.definicion : null);
  const nombre = (id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien del equipo' : '—');
  const { base, demo } = urlPublica();
  const actual = condiciones[0];
  return {
    ...x.comun,
    publicado: !!bot.versionPublicadaId && (bot.estado === 'publicado' || bot.estado === 'pausado'),
    pausado: bot.estado === 'pausado',
    urlLanding: `${base}/b/${bot.idPublico}`,
    snippet: `<script src="${base}/widget.js" data-bot="${bot.idPublico}" async></script>`,
    urlDeDemo: demo,
    canal,
    puedeConfigurar: puede(ctx.rol, 'configurar_canales') && !ctx.organizacion.demo && bot.estado !== 'archivado',
    condiciones: actual ? { numero: actual.numero, texto: actual.texto, fecha: fechaHoraUtc(actual.publicadasEn), por: nombre(actual.publicadasPor) } : null,
    historial: condiciones.map((c) => ({ numero: c.numero, fecha: fechaHoraUtc(c.publicadasEn), por: nombre(c.publicadasPor) })),
    textoPropuesto: actual?.texto ?? condicionesPorDefecto({ mercado: bot.mercado, candidato: def?.identidad.candidato.nombre ?? bot.nombre, trato: bot.trato, dias: bot.diasGuardado }),
    limites: [
      { etiqueta: 'Por IP', valor: `${LIMITES_WEB.ipPorMinuto} mensajes por minuto y ${LIMITES_WEB.ipPorDia} por día` },
      { etiqueta: 'Por conversación', valor: `${LIMITES_WEB.conversacionPorMinuto} por minuto y ${LIMITES_WEB.conversacionPorDia} por día` },
      { etiqueta: 'Por bot', valor: `${LIMITES_WEB.botPorDia.toLocaleString('es-UY')} por día` },
      { etiqueta: 'Corte', valor: `${LIMITES_WEB.duroIpPorHora.toLocaleString('es-UY')} por IP y hora: ahí deja de contestar` },
    ],
  };
}
