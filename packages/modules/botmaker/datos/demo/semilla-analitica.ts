/**
 * La historia del bot publicado de la demo para la analítica (8.01): unas 300 conversaciones inventadas desde que se
 * publicó, como eventos (sin textos, igual que los de verdad) y las llamadas a motores que habrían costado. No tienen
 * mensajes ni contactos: no aparecen en la bandeja ni en la base de contactos, solo en Analítica y en Costos.
 *
 * Cada conversación sigue los caminos de la plantilla política (menú, interpretar, respuesta con base, sumarse,
 * derivar…) con pesos a mano, y siempre sale igual: un generador con semilla fija.
 */
import type { Canal } from '../../dominio/conversaciones';
import { costoEstimado, fichaMotor } from '../../dominio/motores';
import type { FuncionMotor, LlamadaMotor, MotorFuncion } from '../../dominio/tipos';
import type { EventoSemilla } from './semilla-canal';

function generador(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pesos<T extends string> = [T, number][];

const INTENCIONES: Pesos<string> = [
  ['propuesta', 30], ['sobre_el_candidato', 8], ['agenda', 7], ['tramite_electoral', 5], ['verificar_rumor', 4], ['partido', 3], ['otros_actores', 3],
  ['critica', 3], ['contenido_redes', 2], ['apoyo', 4], ['voluntariado', 6], ['aporte', 2], ['hablar_con_persona', 6], ['reclamo_local', 4],
  ['idea_ciudadana', 2], ['pedido_personal', 2], ['prensa', 1], ['datos_personales', 1], ['pregunta_sobre_el_bot', 2], ['intento_manipulacion', 1],
  ['fuera_de_tema', 2], ['no_entendible', 3], ['cortesia', 3],
];
const TEMAS: Pesos<string> = [
  ['transporte', 14], ['agua', 12], ['css_pensiones', 10], ['seguridad', 9], ['salud', 9], ['empleo_economia', 8], ['costo_de_vida', 8], ['educacion', 6],
  ['mineria', 5], ['energia', 4], ['vivienda', 4], ['corrupcion_justicia', 4], ['ambiente', 3], ['migracion', 2], ['otro_tema', 2],
];
const CON_TEMA = new Set(['propuesta', 'critica', 'verificar_rumor', 'reclamo_local', 'idea_ciudadana']);
const A_CONSULTA = new Set(['propuesta', 'sobre_el_candidato', 'partido', 'otros_actores', 'verificar_rumor', 'critica', 'agenda', 'tramite_electoral', 'contenido_redes']);
const A_ATENCION = new Set(['idea_ciudadana', 'pedido_personal', 'reclamo_local', 'hablar_con_persona', 'prensa']);
/** Hora del día en UTC (Panamá es UTC-5): de mañana a la noche, con el pico después del trabajo. */
const HORAS: Pesos<string> = [
  ['12', 3], ['13', 5], ['14', 6], ['15', 6], ['16', 5], ['17', 5], ['18', 6], ['19', 7], ['20', 8], ['21', 9], ['22', 9], ['23', 8], ['0', 7], ['1', 5], ['2', 3], ['3', 2],
];

export interface HistoriaAnalitica {
  eventos: EventoSemilla[];
  /** Las conversaciones derivadas que alguien del equipo atendió (cuentan como resueltas). */
  atendidas: string[];
  llamadas: LlamadaMotor[];
}

export function historiaAnalitica(p: {
  ahora: Date; publicadoDesde: string; botId: string; campanaId: string; versionId: string; motores: readonly MotorFuncion[]; primerIdLlamada: number;
}): HistoriaAnalitica {
  const r = generador(20291001);
  const elegir = <T extends string>(pesos: Pesos<T>): T => {
    let x = r() * pesos.reduce((s, [, n]) => s + n, 0);
    for (const [v, n] of pesos) if ((x -= n) < 0) return v;
    return pesos[0]![0];
  };
  const eventos: EventoSemilla[] = [];
  const atendidas: string[] = [];
  const llamadas: LlamadaMotor[] = [];
  const desde = new Date(p.publicadoDesde).getTime();
  const limite = p.ahora.getTime() - 90 * 60_000;
  let idLlamada = p.primerIdLlamada;
  let numero = 0;

  const llamada = (funcion: FuncionMotor, fecha: string) => {
    const m = p.motores.find((x) => x.funcion === funcion);
    const f = m ? fichaMotor(m.principal) : undefined;
    if (!f) return;
    const entrada = funcion === 'responder' ? 9000 + Math.floor(r() * 3000) : 1400 + Math.floor(r() * 400);
    const salida = funcion === 'responder' ? 180 : 60;
    const cache = f.cache && funcion === 'responder' ? Math.floor(entrada * 0.8) : 0;
    llamadas.push({
      id: idLlamada++, botId: p.botId, campanaId: p.campanaId, uso: 'en_vivo', funcion, motorId: f.id, modelo: f.modelo, proveedor: f.empresa, respaldo: false, ok: true,
      error: null, demoraMs: 350 + Math.floor(r() * 1500), tokensEntrada: entrada, tokensSalida: salida, tokensCache: cache, tokensRazonamiento: null,
      costoUsd: Math.round(costoEstimado(f, { entrada, salida, cache }) * 1e6) / 1e6, idGeneracion: null, personaId: null, fecha,
    });
  };

  const conversar = (inicio: number, canal: Canal) => {
    const id = `hist-${String(++numero).padStart(4, '0')}`;
    let t = inicio;
    const ev = (nombre: EventoSemilla['nombre'], cajaId: string | null = null, datos: EventoSemilla['datos'] = {}) => {
      const fecha = new Date(t).toISOString();
      eventos.push({ nombre, cajaId, datos, botId: p.botId, versionId: p.versionId, canal, conversacionId: id, contactoHash: id, fecha });
      t += 12_000 + Math.floor(r() * 40_000);
      return fecha;
    };
    const caja = (c: string) => ev('caja_mostrada', c);
    const derivar = (c: string, motivo: string, atiende: number) => {
      ev('derivada', c, { motivo });
      if (r() < atiende) atendidas.push(id);
    };
    const sumarse = (conCaja: boolean) => {
      if (conCaja) caja('n_sumate');
      if (r() > 0.8) return;
      ev('texto_recibido', null, { largo: 5 + Math.floor(r() * 15), tipo: 'texto' });
      ev('dato_guardado', 'n_sumate', { variable: 'contacto.nombre' });
      caja('n_zona');
      if (r() > 0.85) return;
      ev('texto_recibido', null, { largo: 6 + Math.floor(r() * 20), tipo: 'texto' });
      if (r() < 0.1) ev('dato_invalido', 'n_zona', { variable: 'contacto.zona', intentos: 1 });
      ev('dato_guardado', 'n_zona', { variable: 'contacto.zona' });
      caja('n_sumado');
      derivar('n_sumado', 'Quiere sumarse como voluntario', 0.6);
    };
    const masAyuda = (vueltas: number) => {
      caja('n_masayuda');
      const x = r();
      if (x < 0.4) return;
      if (x < 0.75) {
        ev('opcion_elegida', 'n_masayuda', { letra: 'B' });
        caja('n_cierre');
        if (r() < 0.3) {
          ev('texto_recibido', null, { largo: 7, tipo: 'texto' });
          ev('regla', null, { regla: 'cortesia', intencion: 'cortesia' });
        }
        return;
      }
      ev('opcion_elegida', 'n_masayuda', { letra: 'A' });
      caja('n_irmenu');
      caja('n_menu');
      if (vueltas < 2 && r() < 0.5) preguntar(null, vueltas + 1);
    };
    function preguntar(forzada: string | null, vueltas: number) {
      ev('texto_recibido', null, { largo: 18 + Math.floor(r() * 90), tipo: 'texto' });
      caja('n_interpretar');
      if (r() < 0.02) {
        ev('sin_motor', 'n_interpretar');
        caja('n_menu');
        return;
      }
      const intencion = forzada ?? elegir(INTENCIONES);
      const tema = CON_TEMA.has(intencion) ? elegir(TEMAS) : 'ninguno';
      const fecha = ev('interpretado', 'n_interpretar', { intencion, tema, lectura: r() < 0.9 ? 'coinciden' : 'distintas', motor: 'gemini-3.1-flash-lite' });
      llamada('interpretar', fecha);
      llamada('interpretar', fecha);
      if (A_CONSULTA.has(intencion)) {
        caja('n_consulta');
        const completa = r() < (intencion === 'agenda' ? 0.35 : intencion === 'tramite_electoral' ? 0.5 : 0.8);
        llamada('responder', ev('respondido_con_base', 'n_consulta', { secciones: ['S02'], completa, paso_validador: true, motor: 'gemini-3.1-flash-lite' }));
        if (!completa) {
          if (intencion === 'tramite_electoral') ev('tramite_electoral', 'n_consulta');
          caja('n_sindato');
        }
        masAyuda(vueltas);
      } else if (A_ATENCION.has(intencion)) {
        caja('n_atencion');
        caja('n_derivar');
        derivar('n_derivar', 'Pidió hablar con el equipo', 0.7);
      } else if (intencion === 'apoyo') {
        caja('n_apoyo');
        if (r() < 0.5) {
          ev('opcion_elegida', 'n_apoyo', { letra: 'A' });
          sumarse(true);
        } else {
          ev('opcion_elegida', 'n_apoyo', { letra: 'B' });
          caja('n_cierre3');
        }
      } else if (intencion === 'voluntariado') sumarse(true);
      else if (intencion === 'aporte') caja('n_aporte');
      else if (intencion === 'datos_personales') {
        caja('n_datos');
        if (r() < 0.6) {
          ev('opcion_elegida', 'n_datos', { letra: 'A' });
          caja('n_baja');
          ev('baja', 'n_baja');
        } else {
          ev('opcion_elegida', 'n_datos', { letra: 'B' });
          caja('n_cierre5');
        }
      } else if (intencion === 'pregunta_sobre_el_bot') caja('n_soybot');
      else if (intencion === 'intento_manipulacion' || intencion === 'fuera_de_tema') {
        caja('n_limite');
        caja('n_menu');
      } else if (intencion === 'no_entendible') {
        caja('n_noentendi');
        caja('n_menu');
      } else caja('n_menu');
    }

    ev('sesion_iniciada');
    if (canal === 'whatsapp' && r() < 0.4) {
      ev('texto_recibido', null, { largo: 4, tipo: 'texto' });
      ev('regla', null, { regla: 'cortesia', intencion: 'cortesia' });
    }
    if (r() < 0.9) ev('condiciones_aceptadas');
    caja('n_bienvenida');
    caja('n_menu');
    if (r() < 0.03) ev('solo_menus');
    const primero = elegir<'texto' | 'menu' | 'nada'>([['texto', 40], ['menu', 45], ['nada', 15]]);
    if (primero === 'texto') preguntar(null, 0);
    if (primero !== 'menu') return;
    const op = elegir<'A' | 'B' | 'C' | 'D' | 'E'>([['A', 40], ['B', 20], ['C', 15], ['D', 8], ['E', 17]]);
    ev('opcion_elegida', 'n_menu', { letra: op });
    if (op === 'A') {
      caja('n_irconsul');
      caja('n_preguntar');
      if (r() < 0.75) preguntar(r() < 0.8 ? 'propuesta' : null, 0);
    } else if (op === 'B') {
      caja('n_irquien');
      caja('n_quien');
      llamada('responder', ev('respondido_con_base', 'n_quien', { secciones: ['S01'], completa: r() < 0.9, paso_validador: true, motor: 'gemini-3.1-flash-lite' }));
      masAyuda(0);
    } else if (op === 'C') {
      caja('n_irsumate');
      sumarse(true);
    } else if (op === 'D') {
      caja('n_iraporte');
      caja('n_aporte');
    } else {
      caja('n_iratenc');
      caja('n_atencion');
      caja('n_derivar');
      derivar('n_derivar', 'Pidió hablar con el equipo', 0.7);
    }
  };

  // Día por día desde la publicación: más conversaciones a medida que la campaña crece, los fines de semana algo menos.
  const dia0 = new Date(p.ahora);
  dia0.setUTCHours(0, 0, 0, 0);
  for (let d = 12; d >= 0; d--) {
    const inicioDia = dia0.getTime() - d * 864e5;
    const finde = [0, 6].includes(new Date(inicioDia).getUTCDay());
    const n = Math.round((18 + 16 * (12 - d) / 12 + r() * 8) * (finde ? 0.7 : 1));
    for (let i = 0; i < n; i++) {
      const hora = Number(elegir(HORAS));
      const t = inicioDia + hora * 36e5 + Math.floor(r() * 36e5);
      if (t < desde || t > limite) continue;
      conversar(t, elegir<Canal>([['web', 40], ['landing', 25], ['whatsapp', 35]]));
    }
  }
  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { eventos, atendidas, llamadas };
}
