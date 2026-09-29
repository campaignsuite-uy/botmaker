/**
 * Canales del bot: el canal web (widget y página propia, etapa 5), cómo se aceptan las condiciones y sus versiones, los
 * límites que protegen el gasto, y WhatsApp (etapa 7): el número de la cuenta de 360dialog de la campaña, su salud, el
 * consumo estimado del mes, el aviso de la política de WhatsApp y las plantillas. Configura el administrador
 * (configurar_canales); el resto lo ve.
 */
import type { Repositorio } from '../datos/repositorio';
import { condicionesPorDefecto, LIMITES_WEB, type ModoCondiciones } from '../dominio/conversaciones';
import { validarDefinicion } from '../dominio/definicion';
import { entero, fechaHoraUtc, milisegundos, usd } from '../dominio/formato';
import {
  AVISO_POLITICA_WHATSAPP, CATEGORIAS_PLANTILLA, consumoWhatsapp, ETIQUETA_CATEGORIA_PLANTILLA, ETIQUETA_ESTADO_CANAL, ETIQUETA_ESTADO_PLANTILLA, IDIOMAS_PLANTILLA,
  type EstadoCanal, type EstadoPlantilla,
} from '../dominio/whatsapp';
import { puede } from '../dominio/permisos';
import type { ContextoPantalla } from '../ui/contexto';
import { whatsappSimulado } from '../canal-whatsapp/servidor';
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
  whatsapp: VistaWhatsapp;
}

export interface VistaWhatsapp {
  estado: EstadoCanal | null;
  estadoTexto: string;
  datos: { etiqueta: string; valor: string }[];
  salud: { etiqueta: string; valor: string; alerta?: boolean }[];
  consumo: string | null;
  ultimoError: string | null;
  avisoPolitica: string;
  /** 360dialog simulado (la demo): las claves de prueba sirven y hay un teléfono de prueba. */
  simulado: boolean;
  urlTelefono: string | null;
  /** Sin BOTS_URL_PUBLICA con https no se puede conectar un número real. */
  faltaUrlPublica: boolean;
  puedeConfigurar: boolean;
  plantillas: {
    nombre: string; idioma: string; categoria: string; estado: EstadoPlantilla; estadoTexto: string; texto: string; nota: string | null; usable: boolean;
    creadaPor: string | null;
  }[];
  hayEnRevision: boolean;
  categorias: { valor: string; texto: string }[];
  idiomas: { valor: string; texto: string }[];
}

export function urlPublica(): { base: string; demo: boolean } {
  const u = process.env.BOTS_URL_PUBLICA?.replace(/\/$/, '');
  return u ? { base: u, demo: false } : { base: '/publico', demo: true };
}

export async function vistaCanales(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaCanales | null> {
  const x = await baseParte(repo, ctx, botId, 'canales');
  if (!x) return null;
  const bot = x.b.bot;
  const [canal, condiciones, publicada, wa, plantillas] = await Promise.all([
    repo.canalWeb(bot.id), repo.condiciones(bot.id), bot.versionPublicadaId ? repo.version(bot.versionPublicadaId) : Promise.resolve(null),
    repo.canalWhatsapp(bot.id), repo.plantillas(bot.id),
  ]);
  const vp = publicada ? validarDefinicion(publicada.definicion) : null;
  const def = x.b.definicion ?? (vp?.ok ? vp.definicion : null);
  const nombre = (id: string | null) => (id ? ctx.nucleo?.personas.find((p) => p.id === id)?.nombre ?? 'Alguien del equipo' : '—');
  const { base, demo } = urlPublica();
  const actual = condiciones[0];
  const simulado = whatsappSimulado();
  const configurar = puede(ctx.rol, 'configurar_canales') && !ctx.organizacion.demo && bot.estado !== 'archivado';
  const consumo = wa ? consumoWhatsapp(wa.respuestasMes, new Date()) : null;
  const whatsapp: VistaWhatsapp = {
    estado: wa?.estado ?? null,
    estadoTexto: wa ? ETIQUETA_ESTADO_CANAL[wa.estado] : 'sin conectar',
    datos: wa ? [
      { etiqueta: 'Número', valor: wa.numero ?? 'sin número (se completa con el primer mensaje)' },
      { etiqueta: 'Conectado', valor: wa.conectadoEn ? fechaHoraUtc(wa.conectadoEn) : '—' },
      { etiqueta: 'Último mensaje recibido', valor: wa.ultimoRecibido ? fechaHoraUtc(wa.ultimoRecibido) : 'todavía ninguno' },
      { etiqueta: 'Aviso de 360dialog', valor: wa.webhookUrl ?? '—' },
    ] : [],
    salud: wa ? [
      { etiqueta: 'Recibidos', valor: entero(wa.salud.recibidos) },
      { etiqueta: 'Repetidos descartados', valor: entero(wa.salud.repetidos) },
      { etiqueta: 'Enviados', valor: entero(wa.salud.enviados) },
      { etiqueta: 'Entregados', valor: entero(wa.salud.entregados) },
      { etiqueta: 'Leídos', valor: entero(wa.salud.leidos) },
      { etiqueta: 'No se enviaron', valor: entero(wa.salud.fallidos), alerta: wa.salud.fallidos > 0 },
      { etiqueta: 'Esperando para salir', valor: entero(wa.salud.pendientes), alerta: wa.salud.pendientes > 0 },
      { etiqueta: 'Demora del aviso (media y máxima)', valor: `${milisegundos(wa.salud.demoraMediaMs)} · ${milisegundos(wa.salud.demoraMaxMs)} (meta: 0,5 s)`, alerta: wa.salud.demoraMaxMs > 500 },
    ] : [],
    consumo: consumo ? (consumo.vigente
      ? `${entero(consumo.respuestas)} respuestas este mes: las primeras ${entero(consumo.gratis)} son gratis; ${entero(consumo.cobradas)} se cobran, unos ${usd(consumo.usd)} (tarifa de utilidad de Meta, USD 0,0113). Las plantillas se cobran aparte.`
      : `${entero(consumo.respuestas)} respuestas este mes. Meta empieza a cobrar las respuestas el 1/10/2026: 1.000 gratis por número y por mes, después USD 0,0113 cada una.`) : null,
    ultimoError: wa?.ultimoError ? `${wa.ultimoError}${wa.ultimoErrorEn ? ` (${fechaHoraUtc(wa.ultimoErrorEn)})` : ''}` : null,
    avisoPolitica: AVISO_POLITICA_WHATSAPP,
    simulado,
    urlTelefono: simulado && demo ? `/publico/telefono?bot=${bot.idPublico}` : null,
    faltaUrlPublica: !simulado && !/^https:\/\//.test(process.env.BOTS_URL_PUBLICA ?? ''),
    puedeConfigurar: configurar,
    plantillas: plantillas.map((p) => ({
      nombre: p.nombre, idioma: p.idioma, categoria: p.categoria in ETIQUETA_CATEGORIA_PLANTILLA ? ETIQUETA_CATEGORIA_PLANTILLA[p.categoria as keyof typeof ETIQUETA_CATEGORIA_PLANTILLA] : p.categoria || '—',
      estado: p.estado, estadoTexto: ETIQUETA_ESTADO_PLANTILLA[p.estado], texto: p.texto, nota: p.estado === 'rechazada' ? `Motivo: ${p.motivo ?? 'Meta no dio el motivo.'}` : p.aviso,
      usable: p.usable, creadaPor: p.creadaPor ? nombre(p.creadaPor) : null,
    })),
    hayEnRevision: plantillas.some((p) => p.estado === 'en_revision'),
    categorias: CATEGORIAS_PLANTILLA.map((c) => ({ valor: c, texto: ETIQUETA_CATEGORIA_PLANTILLA[c] })),
    idiomas: IDIOMAS_PLANTILLA.map((i) => ({ valor: i.codigo, texto: i.nombre })),
  };
  return {
    ...x.comun,
    publicado: !!bot.versionPublicadaId && (bot.estado === 'publicado' || bot.estado === 'pausado'),
    pausado: bot.estado === 'pausado',
    urlLanding: `${base}/b/${bot.idPublico}`,
    snippet: `<script src="${base}/widget.js" data-bot="${bot.idPublico}" async></script>`,
    urlDeDemo: demo,
    canal,
    puedeConfigurar: configurar,
    condiciones: actual ? { numero: actual.numero, texto: actual.texto, fecha: fechaHoraUtc(actual.publicadasEn), por: nombre(actual.publicadasPor) } : null,
    historial: condiciones.map((c) => ({ numero: c.numero, fecha: fechaHoraUtc(c.publicadasEn), por: nombre(c.publicadasPor) })),
    textoPropuesto: actual?.texto ?? condicionesPorDefecto({ mercado: bot.mercado, candidato: def?.identidad.candidato.nombre ?? bot.nombre, trato: bot.trato, dias: bot.diasGuardado }),
    limites: [
      { etiqueta: 'Por IP', valor: `${LIMITES_WEB.ipPorMinuto} mensajes por minuto y ${LIMITES_WEB.ipPorDia} por día` },
      { etiqueta: 'Por conversación', valor: `${LIMITES_WEB.conversacionPorMinuto} por minuto y ${LIMITES_WEB.conversacionPorDia} por día` },
      { etiqueta: 'Por bot', valor: `${LIMITES_WEB.botPorDia.toLocaleString('es-UY')} por día` },
      { etiqueta: 'Corte', valor: `${LIMITES_WEB.duroIpPorHora.toLocaleString('es-UY')} por IP y hora: ahí deja de contestar` },
    ],
    whatsapp,
  };
}
