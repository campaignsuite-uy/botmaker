/**
 * La parte de la demo que conversa (etapas 5 y 6): un tercer bot, publicado, con una candidata inventada y un material
 * corto inventado, y algunas conversaciones de ejemplo para la bandeja: una atendida por el bot, una derivada hace más
 * de 2 horas sin respuesta (abre una alerta), una en atención y una cerrada. Todo es inventado.
 */
import { aplicarOperacion } from '../../dominio/operaciones';
import { condicionesPorDefecto, type Condiciones, type Contacto, type Conversacion, type Mensaje } from '../../dominio/conversaciones';
import { MOTORES_POR_DEFECTO } from '../../dominio/motores';
import { sesionNueva } from '../../dominio/motor';
import { plantillaPolitica } from '../../dominio/plantilla-politica';
import type { Bot, MotorFuncion } from '../../dominio/tipos';
import type { Version } from '../../dominio/versiones';
import { leerPlantilla, ventanaHasta, type Plantilla } from '../../dominio/whatsapp';
import { CLAVE_DEMO, NUMERO_DEMO, PLANTILLAS_DEMO, SECRETO_DEMO } from '../../canal-whatsapp/demo';
import { sha256 } from '../../canal-whatsapp/webhook';
import { CAMPANA_DEMO, CANDIDATA_DEMO, ORGANIZACION_DEMO } from './semilla';

export const BOT_PUBLICADO = 'bot-demo-3';
export const ID_PUBLICO_DEMO = 'p5v9c3h7pa';

const MATERIAL = `## Quién es Ana Lucía Ríos
Ana Lucía Ríos es ingeniera civil y fue concejal de San Miguelito entre 2019 y 2024. Es candidata a presidenta por el Movimiento Otro Camino. Este material es inventado para la demo.
Fuentes: material de prueba de la demo

## Transporte
Propone extender las rutas de buses nocturnos a los barrios de la periferia y un carril exclusivo en la Vía Transístmica. El pasaje se mantiene en 0,35 dólares.
Fuentes: material de prueba de la demo

## Agua
Propone reparar las redes de agua potable de Panamá Oeste en los primeros 18 meses, con prioridad en los barrios con cortes de más de dos días por semana.
Fuentes: material de prueba de la demo

## Empleo
Propone un programa de primer empleo para jóvenes de 18 a 25 años, con prácticas pagas en empresas y en el Estado.
Fuentes: material de prueba de la demo`;

/** El canal de WhatsApp del bot publicado de la demo, conectado a la cuenta del 360dialog simulado. */
export interface CanalWhatsappSemilla {
  id: string;
  botId: string;
  campanaId: string;
  numero: string;
  webhookUrl: string;
  conectadoEn: string;
  secretoHash: string;
  clave: string;
  plantillas: Plantilla[];
}

interface SemillaCanal {
  whatsapp: CanalWhatsappSemilla;
  bot: Bot;
  motores: MotorFuncion[];
  version: Version & { definicion: unknown };
  contactos: Contacto[];
  conversaciones: Conversacion[];
  mensajes: Map<string, Mensaje[]>;
  condiciones: Condiciones[];
  publicadoDesde: string;
}

export function semillaCanal(ahora: Date): SemillaCanal {
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();
  const bot: Bot = {
    id: BOT_PUBLICADO, campanaId: CAMPANA_DEMO, organizacionId: ORGANIZACION_DEMO, nombre: 'Asistente publicado', idPublico: ID_PUBLICO_DEMO,
    caso: 'electoral', mercado: 'PA', trato: 'usted', estado: 'publicado', versionPublicadaId: 'ver-demo-3', avisoIa: '', personalizacion: false,
    diasGuardado: 90, topeDiarioUsd: 5, topeMensualUsd: 100, creadoPor: 'p-lucia', creadoEn: hace(20 * 1440), actualizadoEn: hace(10 * 1440), archivadoEn: null,
  };
  const definicion = aplicarOperacion(plantillaPolitica({
    candidato: CANDIDATA_DEMO, partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA', 'Otro Camino'], trato: 'usted', mercado: 'PA',
    consultas: { canal: 'correo', valor: 'consultas@ejemplo.org' }, aportes: { canal: 'web', valor: 'ejemplo.org/aportes' },
  }), { tipo: 'cargar_material', texto: MATERIAL, reemplazar: true }).definicion;
  const version = {
    id: 'ver-demo-3', botId: bot.id, campanaId: CAMPANA_DEMO, numero: 1, estado: 'publicada' as const, basadaEn: null, seq: 0,
    creadaPor: 'p-lucia', creadaEn: hace(12 * 1440), actualizadaEn: hace(10 * 1440), definicion,
  };

  const contacto = (id: string, canal: Contacto['canal'], min: number, nombre: string | null = null, datos: Record<string, string> = {}): Contacto => ({
    id, botId: bot.id, campanaId: CAMPANA_DEMO, canal, hash: `demo-${id}`, nombre, datos, condicionesVersion: 1, condicionesAceptadasEn: hace(min), verificadoEn: hace(min), creadoEn: hace(min), borradoEn: null,
  });
  const contactos = [
    contacto('ct-demo-1', 'landing', 2 * 1440),
    contacto('ct-demo-2', 'web', 200),
    contacto('ct-demo-3', 'web', 1500, 'Rosa', { 'contacto.nombre': 'Rosa' }),
    contacto('ct-demo-4', 'landing', 12 * 1440, 'Marcos', { 'contacto.nombre': 'Marcos', 'contacto.zona': 'Arraiján' }),
    { ...contacto('ct-demo-5', 'whatsapp', 31 * 60), telefono: '50761234567', nombrePerfil: 'Marta G.' },
  ];

  const mensajes = new Map<string, Mensaje[]>();
  const conversaciones: Conversacion[] = [];
  const conversar = (
    id: string, ct: Contacto, inicio: number, estado: Conversacion['estado'], lineas: [Mensaje['autor'], string, Partial<Mensaje>?][],
    extra: Partial<Conversacion> = {},
  ) => {
    const ms: Mensaje[] = lineas.map(([autor, texto, x], i) => ({
      conversacionId: id, n: i + 1, autor, personaId: null, tipo: autor === 'contacto' ? 'texto' : 'texto', texto, datos: null, cajaId: null, decision: null,
      versionId: autor === 'bot' ? version.id : null, idCanal: null, muestra: false, creadoEn: hace(inicio - i), ...x,
    }));
    mensajes.set(id, ms);
    const delContacto = ms.filter((m) => m.autor === 'contacto').at(-1)?.creadoEn ?? null;
    const delEquipo = ms.filter((m) => m.autor === 'agente').at(-1)?.creadoEn ?? null;
    conversaciones.push({
      id, botId: bot.id, campanaId: CAMPANA_DEMO, contactoId: ct.id, canal: ct.canal, versionId: version.id, estado, sesion: { ...sesionNueva(), iniciada: true, estado: estado === 'bot' || estado === 'cerrada' ? 'bot' : 'derivada', variables: { ...ct.datos } },
      cajaActual: null, asignadaA: null, derivadaEn: null, motivoDerivacion: null, cajaDerivacion: null, ultimoDelContacto: delContacto, ultimoDelEquipo: delEquipo,
      verificada: true, seq: ms.length, iniciadaEn: ms[0]!.creadoEn, actualizadaEn: ms.at(-1)!.creadoEn, ...extra,
    });
  };
  const menu = { opciones: [{ letra: 'A', texto: 'Propuestas' }, { letra: 'B', texto: 'Quién es' }, { letra: 'C', texto: 'Sumarme' }, { letra: 'D', texto: 'Aportar' }, { letra: 'E', texto: 'Hablar con alguien' }], modo: 'lista' as const, opcionesDe: 'n_menu' };
  const bienvenida = `Hola, soy el asistente virtual de ${CANDIDATA_DEMO}. Puedo contarle sus propuestas, cómo sumarse y resolver sus dudas.`;

  conversar('conv-demo-1', contactos[0]!, 2 * 1440, 'bot', [
    ['sistema', 'Está conversando con un asistente virtual con inteligencia artificial: puede equivocarse. Condiciones del bot.', { datos: { enlace: 'condiciones' } }],
    ['bot', bienvenida, { cajaId: 'n_bienvenida', decision: { recorrido: ['n_bienvenida', 'n_menu'], costoUsd: 0 } }],
    ['bot', '¿En qué le puedo ayudar? Elija una opción o escriba su pregunta.', { cajaId: 'n_menu', datos: menu }],
    ['contacto', '¿Qué proponen para el transporte?'],
    ['bot', 'Propone extender las rutas de buses nocturnos a los barrios de la periferia y un carril exclusivo en la Vía Transístmica. El pasaje se mantiene en 0,35 dólares.', {
      cajaId: 'n_consulta', muestra: true,
      decision: { recorrido: ['n_interpretar', 'n_consulta', 'n_masayuda'], intencion: 'propuesta', tema: 'transporte', lectura: { principal: 'propuesta', respaldo: 'propuesta', resultado: 'coinciden' }, motor: 'gemini-3.1-flash-lite', secciones: ['S02'], costoUsd: 0.00041 },
    }],
    ['bot', '¿Le ayudo con algo más?', { cajaId: 'n_masayuda', datos: { opciones: [{ letra: 'A', texto: 'Ver el menú' }, { letra: 'B', texto: 'No, gracias' }], modo: 'botones', opcionesDe: 'n_masayuda' } }],
  ]);
  conversar('conv-demo-2', contactos[1]!, 200, 'derivada', [
    ['bot', bienvenida, { cajaId: 'n_bienvenida', decision: { recorrido: ['n_bienvenida', 'n_menu'], costoUsd: 0 } }],
    ['bot', '¿En qué le puedo ayudar? Elija una opción o escriba su pregunta.', { cajaId: 'n_menu', datos: menu }],
    ['contacto', 'Quiero hablar con alguien del equipo por una reunión en mi barrio'],
    ['bot', 'Le paso con una persona del equipo. Le va a responder por acá, en horario de atención.', {
      cajaId: 'n_derivar', decision: { recorrido: ['n_interpretar', 'n_atencion', 'n_derivar'], intencion: 'hablar_con_persona', tema: 'ninguno', lectura: { principal: 'hablar_con_persona', respaldo: 'hablar_con_persona', resultado: 'coinciden' }, motor: 'gemini-3.1-flash-lite', costoUsd: 0.00012 },
    }],
  ], { derivadaEn: hace(197), motivoDerivacion: 'Pidió hablar con el equipo', cajaDerivacion: 'n_derivar', cajaActual: 'n_derivar' });
  conversar('conv-demo-3', contactos[2]!, 1500, 'en_atencion', [
    ['bot', bienvenida, { cajaId: 'n_bienvenida' }],
    ['contacto', 'Quiero ser voluntaria en San Miguelito'],
    ['bot', '¡Qué bueno! ¿Cómo se llama?', { cajaId: 'n_sumate', decision: { recorrido: ['n_interpretar', 'n_sumate'], intencion: 'voluntariado', tema: 'ninguno', motor: 'gemini-3.1-flash-lite', costoUsd: 0.0001 } }],
    ['contacto', 'Rosa'],
    ['bot', '¿En qué zona o corregimiento vive?', { cajaId: 'n_zona' }],
    ['contacto', 'Belisario Porras'],
    ['bot', '¡Gracias, Rosa! Ya le avisamos al equipo: alguien le va a escribir para sumarse.', { cajaId: 'n_sumado' }],
    ['agente', 'Hola, Rosa: soy Andrés, del equipo. El sábado hay una reunión de voluntarios en Belisario Porras. ¿Le paso la dirección?', { personaId: 'p-andres' }],
  ], { derivadaEn: hace(1494), motivoDerivacion: 'Quiere sumarse como voluntario', cajaDerivacion: 'n_sumado', asignadaA: 'p-andres', cajaActual: 'n_sumado' });
  conversar('conv-demo-4', contactos[3]!, 12 * 1440, 'cerrada', [
    ['bot', bienvenida, { cajaId: 'n_bienvenida' }],
    ['contacto', '¿Qué propone para el agua en Panamá Oeste?'],
    ['bot', 'Propone reparar las redes de agua potable de Panamá Oeste en los primeros 18 meses, con prioridad en los barrios con cortes de más de dos días por semana.', {
      cajaId: 'n_consulta', muestra: true,
      decision: { recorrido: ['n_interpretar', 'n_consulta', 'n_masayuda'], intencion: 'propuesta', tema: 'agua', motor: 'gemini-3.1-flash-lite', secciones: ['S03'], costoUsd: 0.00039 },
    }],
    ['contacto', 'Gracias'],
    ['bot', 'Gracias a usted. Cuando quiera, me escribe.', { cajaId: 'n_cierre', decision: { recorrido: ['n_cierre'], regla: 'cortesia', costoUsd: 0 } }],
  ]);

  // Por WhatsApp: Andrés le contestó hace 29 horas y ella respondió hace 28. La ventana de 24 horas ya se cerró: para
  // volver a escribirle, solo una plantilla.
  conversar('conv-demo-5', contactos[4]!, 30 * 60 + 2, 'en_atencion', [
    ['sistema', 'Está conversando con un asistente virtual con inteligencia artificial: puede equivocarse.\n\nCondiciones del asistente: /publico/b/p5v9c3h7pa/condiciones'],
    ['contacto', 'Hola, quería saber si la candidata va a venir a Chilibre'],
    ['bot', 'No tengo ese dato. Le paso con una persona del equipo: le va a responder por este mismo chat.', {
      cajaId: 'n_derivar', decision: { recorrido: ['n_interpretar', 'n_consulta', 'n_derivar'], intencion: 'agenda', tema: 'ninguno', motor: 'gemini-3.1-flash-lite', costoUsd: 0.00015 },
    }],
    ['agente', 'Hola, Marta: soy Andrés, del equipo. Lo averiguo con la agenda y le escribo.', { personaId: 'p-andres', creadoEn: hace(29 * 60) }],
    ['contacto', 'Dale, gracias', { creadoEn: hace(28 * 60) }],
  ], {
    derivadaEn: hace(30 * 60), motivoDerivacion: 'Consulta de agenda sin dato', cajaDerivacion: 'n_derivar', cajaActual: 'n_derivar', asignadaA: 'p-andres',
    ultimoDelEquipo: hace(29 * 60), ultimoDelContacto: hace(28 * 60), actualizadaEn: hace(28 * 60), ventanaHasta: ventanaHasta(hace(28 * 60)),
  });
  for (const m of mensajes.get('conv-demo-5') ?? []) if (m.autor !== 'contacto') m.envio = 'leido';

  const condiciones: Condiciones[] = [{
    botId: bot.id, numero: 1, texto: condicionesPorDefecto({ mercado: 'PA', candidato: CANDIDATA_DEMO, trato: 'usted', dias: 90 }), publicadasEn: hace(12 * 1440), publicadasPor: 'p-joaquin',
  }];
  const whatsapp: CanalWhatsappSemilla = {
    id: 'wa-demo-1', botId: bot.id, campanaId: CAMPANA_DEMO, numero: NUMERO_DEMO, webhookUrl: `/publico/api/whatsapp/${ID_PUBLICO_DEMO}`,
    conectadoEn: hace(3 * 1440), secretoHash: sha256(SECRETO_DEMO), clave: CLAVE_DEMO,
    plantillas: PLANTILLAS_DEMO.map((p) => leerPlantilla(p)).filter((p): p is Plantilla => !!p),
  };
  return { whatsapp, bot, motores: MOTORES_POR_DEFECTO.map((m) => ({ ...m })), version, contactos, conversaciones, mensajes, condiciones, publicadoDesde: hace(10 * 1440) };
}
