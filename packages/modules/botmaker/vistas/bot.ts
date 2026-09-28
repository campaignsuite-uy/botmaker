/**
 * Ajustes de un bot, en tres partes con permisos distintos:
 *  - Datos del bot (editor y administrador): nombre, caso, mercado, trato y aviso de IA.
 *  - Motores y gasto (administrador): el motor principal y de respaldo de cada función, los topes, los avisos de la
 *    ficha de cada motor y el botón para probar un motor.
 *  - Datos personales (administrador): personalización y días de guardado de las conversaciones.
 * Quien no puede cambiar una parte la ve como texto. Archivar el bot es del administrador.
 */
import type { Repositorio } from '../datos/repositorio';
import { avisosMotores, exigeAvisoIa, type AvisoMotor } from '../dominio/avisos';
import { AVISO_IA_POR_DEFECTO, DESCRIPCION_CASO, ETIQUETA_CASO, ETIQUETA_ESTADO_BOT, ETIQUETA_TRATO, LARGO_AVISO_IA, LARGO_NOMBRE } from '../dominio/bots';
import { decimal, diaUtc, fechaHoraUtc, inicioMesUtc, milisegundos, usd } from '../dominio/formato';
import { MERCADOS, nombreMercado } from '../dominio/mercados';
import { ETIQUETA_FUNCION, fichaMotor, motoresPara } from '../dominio/motores';
import { puede } from '../dominio/permisos';
import { CASOS, TRATOS, type EstadoBot, type FuncionMotor } from '../dominio/tipos';
import { simularMotores } from '../motores/claves';
import { ruta, type ContextoPantalla } from '../ui/contexto';
import { mensajeDe, type MensajePantalla } from './mensajes';

interface Opcion {
  valor: string;
  texto: string;
}

export interface FilaMotorBot {
  funcion: FuncionMotor;
  etiqueta: string;
  descripcion: string;
  principal: string;
  principalTexto: string;
  respaldo: string;
  respaldoTexto: string;
  opciones: Opcion[];
  tiempoMaximo: string;
}

export interface ResultadoPrueba {
  ok: boolean;
  motor: string;
  funcion: string;
  demora: string;
  costo: string;
  detalle: string;
}

export interface VistaBot {
  mensaje: MensajePantalla | null;
  campanaId: string;
  volver: string;
  hrefLista: string;
  bot: { id: string; nombre: string; idPublico: string; estado: EstadoBot; estadoTexto: string; archivado: boolean; resumen: string; creado: string; actualizado: string };
  datos: {
    editable: boolean;
    nombre: string;
    largoNombre: number;
    caso: string;
    casos: (Opcion & { descripcion: string })[];
    mercado: string;
    mercados: Opcion[];
    trato: string;
    tratos: Opcion[];
    avisoIa: string;
    avisoIaPorDefecto: string;
    avisoIaExigido: boolean;
    largoAviso: number;
  };
  motores: {
    editable: boolean;
    filas: FilaMotorBot[];
    avisos: AvisoMotor[];
    topeDiario: string;
    topeMensual: string;
    topeDiarioTexto: string;
    topeMensualTexto: string;
    gasto: { hoy: string; mes: string; nota: string } | null;
    simulado: boolean;
    probar: { funciones: Opcion[]; motores: Opcion[]; motorInicial: string } | null;
    prueba: ResultadoPrueba | null;
  };
  datosPersonales: { editable: boolean; personalizacion: boolean; dias: number; texto: string; nota: string };
  puedeArchivar: boolean;
}

const DESCRIPCION_FUNCION: Record<FuncionMotor, string> = {
  interpretar: 'Elige la intención y el tema de lo que escribe la persona.',
  responder: 'Redacta la respuesta con el material del bot, sin inventar.',
  copiloto: 'Ayuda al equipo a armar y cambiar el bot. No lo ven los ciudadanos.',
};

export async function vistaBot(repo: Repositorio, ctx: ContextoPantalla, botId: string): Promise<VistaBot | null> {
  const bot = await repo.bot(botId);
  if (!bot || bot.campanaId !== ctx.campana.id) return null;
  const [motores, fichas] = await Promise.all([repo.motoresDeBot(bot.id), repo.fichas()]);
  const archivado = bot.estado === 'archivado';
  const demo = !!ctx.organizacion.demo;
  const editaDatos = puede(ctx.rol, 'editar_borrador') && !archivado && !demo;
  const editaMotores = puede(ctx.rol, 'elegir_motores') && !archivado && !demo;
  const editaDatosPersonales = puede(ctx.rol, 'gestionar_datos_contactos') && !archivado && !demo;
  const nombreDe = (id: string | null) => (id ? fichaMotor(id, fichas)?.nombre ?? id : 'Sin respaldo');

  const filas: FilaMotorBot[] = motores.map((m) => ({
    funcion: m.funcion,
    etiqueta: ETIQUETA_FUNCION[m.funcion],
    descripcion: DESCRIPCION_FUNCION[m.funcion],
    principal: m.principal,
    principalTexto: nombreDe(m.principal),
    respaldo: m.respaldo ?? '',
    respaldoTexto: nombreDe(m.respaldo),
    opciones: motoresPara(m.funcion, fichas).map((f) => ({ valor: f.id, texto: `${f.nombre} · ${f.empresa}` })),
    tiempoMaximo: milisegundos(m.tiempoMaximoMs),
  }));

  let gasto: VistaBot['motores']['gasto'] = null;
  if (puede(ctx.rol, 'ver_costos')) {
    const ahora = new Date();
    const [hoy, mes] = await Promise.all([repo.gastoBot(bot.id, diaUtc(ahora), 'en_vivo'), repo.gastoBot(bot.id, inicioMesUtc(ahora), 'en_vivo')]);
    gasto = {
      hoy: `${usd(hoy)} de ${usd(bot.topeDiarioUsd)}`,
      mes: `${usd(mes)} de ${usd(bot.topeMensualUsd)}`,
      nota: 'Gasto en vivo (conversaciones con ciudadanos), en UTC. El copiloto, el simulador y las pruebas no cuentan para el tope del bot: los limita el tope de su clave en OpenRouter.',
    };
  }

  const p = ctx.parametros;
  const prueba: ResultadoPrueba | null = p.prueba
    ? {
      ok: p.prueba === 'ok',
      motor: nombreDe(p.motor ?? ''),
      funcion: ETIQUETA_FUNCION[(p.funcion as FuncionMotor) ?? 'interpretar'] ?? p.funcion ?? '',
      demora: p.ms ? milisegundos(Number(p.ms)) : '—',
      costo: p.usd ? usd(Number(p.usd)) : '—',
      detalle: (p.detalle ?? '').slice(0, 160),
    }
    : null;

  return {
    mensaje: mensajeDe(p),
    campanaId: ctx.campana.id,
    volver: ruta(ctx, bot.id),
    hrefLista: ruta(ctx),
    bot: {
      id: bot.id,
      nombre: bot.nombre,
      idPublico: bot.idPublico,
      estado: bot.estado,
      estadoTexto: ETIQUETA_ESTADO_BOT[bot.estado],
      archivado,
      resumen: `${ETIQUETA_CASO[bot.caso]} · ${nombreMercado(bot.mercado)} · trato de ${ETIQUETA_TRATO[bot.trato].toLowerCase()}`,
      creado: fechaHoraUtc(bot.creadoEn),
      actualizado: fechaHoraUtc(bot.actualizadoEn),
    },
    datos: {
      editable: editaDatos,
      nombre: bot.nombre,
      largoNombre: LARGO_NOMBRE,
      caso: bot.caso,
      casos: CASOS.map((c) => ({ valor: c, texto: ETIQUETA_CASO[c], descripcion: DESCRIPCION_CASO[c] })),
      mercado: bot.mercado,
      mercados: MERCADOS.map((m) => ({ valor: m.iso, texto: m.nombre })),
      trato: bot.trato,
      tratos: TRATOS.map((t) => ({ valor: t, texto: ETIQUETA_TRATO[t] })),
      avisoIa: bot.avisoIa,
      avisoIaPorDefecto: AVISO_IA_POR_DEFECTO,
      avisoIaExigido: exigeAvisoIa(motores, fichas),
      largoAviso: LARGO_AVISO_IA,
    },
    motores: {
      editable: editaMotores,
      filas,
      avisos: avisosMotores(bot, motores, fichas),
      topeDiario: decimal(bot.topeDiarioUsd, 2),
      topeMensual: decimal(bot.topeMensualUsd, 2),
      topeDiarioTexto: usd(bot.topeDiarioUsd),
      topeMensualTexto: usd(bot.topeMensualUsd),
      gasto,
      simulado: simularMotores(),
      probar: editaMotores
        ? {
          funciones: filas.map((f) => ({ valor: f.funcion, texto: f.etiqueta })),
          motores: fichas.filter((f) => f.activo).map((f) => ({ valor: f.id, texto: `${f.nombre} · ${f.empresa}` })),
          motorInicial: filas[0]?.principal ?? '',
        }
        : null,
      prueba,
    },
    datosPersonales: {
      editable: editaDatosPersonales,
      personalizacion: bot.personalizacion,
      dias: bot.diasGuardado,
      texto: `${bot.personalizacion ? 'Personalización encendida' : 'Personalización apagada'} · el texto de las conversaciones se guarda ${bot.diasGuardado} días`,
      nota: bot.caso === 'electoral'
        ? 'En los bots electorales la personalización arranca apagada. Algunos motores no la permiten en campañas: si la encendés, los avisos de Motores te dicen cuáles.'
        : 'Personalizar es adaptar la respuesta a lo que se sabe de la persona (por ejemplo, su zona).',
    },
    puedeArchivar: puede(ctx.rol, 'publicar') && !archivado && !demo,
  };
}
