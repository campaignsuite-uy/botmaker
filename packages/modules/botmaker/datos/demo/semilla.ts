/**
 * Datos de la demo en memoria: dos bots en la campaña de prueba (Panamá · Pruebas) y dos semanas de llamadas a
 * motores para que Costos tenga algo que mostrar. Las llamadas son inventadas (la demo nunca llama a un motor real) y la
 * barra de arriba lo dice: "Datos de prueba". Siempre las mismas: salen de un generador con semilla fija.
 */
import { MOTORES_POR_DEFECTO, fichaMotor, costoEstimado } from '../../dominio/motores';
import { aplicarOperacion } from '../../dominio/operaciones';
import { plantillaPolitica } from '../../dominio/plantilla-politica';
import { MATERIAL_DEMO } from './material-demo';
import set from '../../pruebas/set-de-prueba.json';
import preguntas from '../../pruebas/preguntas-con-base.json';
import type { Bot, FuncionMotor, LlamadaMotor, MotorFuncion, UsoMotor } from '../../dominio/tipos';
import type { Version } from '../../dominio/versiones';

export const CAMPANA_DEMO = 'c-pa-pruebas';
export const ORGANIZACION_DEMO = 'org-pruebas';

/** Generador pseudoaleatorio con semilla (mulberry32): la demo sale igual cada vez. */
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

/** La candidata de la demo es inventada: los textos del bot la nombran, y no se pone a hablar a nadie real. */
export const CANDIDATA_DEMO = 'Ana Lucía Ríos';
/** Su partido también es inventado (decidido el 30/9/2026: nada de la organización de pruebas se parece a un cliente). */
export const PARTIDO_DEMO = 'Partido Ejemplo';
export const ALIAS_PARTIDO_DEMO = ['Ejemplo'];

export function semillaDemo(ahora: Date): { bots: Bot[]; motores: Map<string, MotorFuncion[]>; llamadas: LlamadaMotor[]; versiones: (Version & { definicion: unknown })[] } {
  const hace = (dias: number, horas = 0) => new Date(ahora.getTime() - dias * 864e5 - horas * 36e5).toISOString();
  const base = {
    campanaId: CAMPANA_DEMO, organizacionId: ORGANIZACION_DEMO, estado: 'borrador' as const, versionPublicadaId: null,
    avisoIa: '', personalizacion: false, diasGuardado: 90, archivadoEn: null,
  };
  const bots: Bot[] = [
    {
      ...base, id: 'bot-demo-1', nombre: 'Asistente de la campaña', idPublico: 'k7m2q9x4pa', caso: 'electoral', mercado: 'PA', trato: 'usted',
      topeDiarioUsd: 5, topeMensualUsd: 100, creadoPor: 'p-lucia', creadoEn: hace(14), actualizadoEn: hace(1),
    },
    {
      ...base, id: 'bot-demo-2', nombre: 'Consultas del partido', idPublico: 'r3t8w6n2pa', caso: 'politico', mercado: 'PA', trato: 'tu',
      topeDiarioUsd: 2, topeMensualUsd: 40, creadoPor: 'p-joaquin', creadoEn: hace(9), actualizadoEn: hace(3),
    },
  ];
  const motores = new Map<string, MotorFuncion[]>(bots.map((b) => [b.id, MOTORES_POR_DEFECTO.map((m) => ({ ...m }))]));
  // El segundo bot responde con Claude Haiku 4.5 y tiene a Gemini de respaldo: así la demo muestra avisos distintos.
  const responder2 = motores.get('bot-demo-2')!.find((m) => m.funcion === 'responder')!;
  responder2.principal = 'claude-haiku-4.5';
  responder2.respaldo = 'gemini-3.1-flash-lite';

  const azar = generador(20290506);
  const llamadas: LlamadaMotor[] = [];
  const usos: { uso: UsoMotor; funcion: FuncionMotor; peso: number }[] = [
    { uso: 'simulador', funcion: 'interpretar', peso: 5 },
    { uso: 'simulador', funcion: 'responder', peso: 4 },
    { uso: 'copiloto', funcion: 'copiloto', peso: 2 },
    { uso: 'pruebas', funcion: 'interpretar', peso: 3 },
  ];
  const total = usos.reduce((a, u) => a + u.peso, 0);
  let id = 1;
  for (let dia = 13; dia >= 0; dia--) {
    for (const b of bots) {
      if (b.creadoEn > hace(dia)) continue;
      const n = 2 + Math.floor(azar() * 5);
      for (let i = 0; i < n; i++) {
        let r = azar() * total;
        const u = usos.find((x) => (r -= x.peso) < 0) ?? usos[0]!;
        const m = motores.get(b.id)!.find((x) => x.funcion === u.funcion)!;
        const fallaPrincipal = azar() < 0.06;
        const intentos = fallaPrincipal && m.respaldo ? [{ id: m.principal, respaldo: false, ok: false }, { id: m.respaldo, respaldo: true, ok: true }] : [{ id: m.principal, respaldo: false, ok: true }];
        const fecha = hace(dia, azar() * 20);
        for (const it of intentos) {
          const f = fichaMotor(it.id)!;
          const entrada = u.funcion === 'responder' ? 9000 + Math.floor(azar() * 3000) : u.funcion === 'copiloto' ? 14000 : 1400 + Math.floor(azar() * 400);
          const salida = u.funcion === 'copiloto' ? 1800 : u.funcion === 'responder' ? 180 : 60;
          const cache = f.cache && u.funcion === 'responder' ? Math.floor(entrada * 0.8) : 0;
          llamadas.push({
            id: id++, botId: b.id, campanaId: CAMPANA_DEMO, uso: u.uso, funcion: u.funcion, motorId: f.id, modelo: f.modelo,
            proveedor: f.empresa.includes('Groq') ? 'Groq' : f.empresa, respaldo: it.respaldo, ok: it.ok,
            error: it.ok ? null : 'HTTP 429: el proveedor está limitando el uso', demoraMs: it.ok ? 400 + Math.floor(azar() * 1800) : 2500,
            tokensEntrada: it.ok ? entrada : null, tokensSalida: it.ok ? salida : null, tokensCache: it.ok ? cache : null, tokensRazonamiento: null,
            costoUsd: it.ok ? Math.round(costoEstimado(f, { entrada, salida, cache }) * 1e6) / 1e6 : 0,
            idGeneracion: null, personaId: u.uso === 'copiloto' || u.uso === 'simulador' ? 'p-lucia' : null, fecha,
          });
        }
      }
    }
  }
  // Cada bot arranca con su borrador (v1) armado con la plantilla política. El primero, con una candidata y un partido
  // inventados y sin material (muestra el camino de "no tengo ese dato"); el segundo, con el material de prueba de la
  // prueba de motores (fuentes públicas al 28/9/2026), para probar la respuesta con base en el simulador: es el bot de
  // prueba del creador con un candidato real (decisión 3.01), y vive en la organización de pruebas.
  const definiciones = [
    plantillaPolitica({
      candidato: CANDIDATA_DEMO, partido: PARTIDO_DEMO, aliasPartido: ALIAS_PARTIDO_DEMO, trato: bots[0]!.trato, mercado: bots[0]!.mercado,
      consultas: { canal: 'correo', valor: 'consultas@ejemplo.org' }, aportes: { canal: 'web', valor: 'ejemplo.org/aportes' },
    }),
    aplicarOperacion(plantillaPolitica({
      candidato: 'Ricardo Lombana', aliasCandidato: ['Lombana', 'el lic'], partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA', 'Otro Camino'],
      trato: bots[1]!.trato, mercado: bots[1]!.mercado, consultas: { canal: 'web', valor: 'otrocamino.org' },
    }), { tipo: 'cargar_material', texto: MATERIAL_DEMO, reemplazar: true }).definicion,
  ];
  // El segundo bot trae como casos de prueba el set de la prueba de motores: 218 mensajes y 72 preguntas al material.
  const INTENCION: Record<string, string> = { saludo: 'cortesia', despedida: 'cortesia' };
  const lineas = [
    ...set.mensajes.map((m) => [m.mensaje.replace(/[|\n]/g, ' '), INTENCION[m.intencion] ?? m.intencion, m.intencionAlt.map((x) => INTENCION[x] ?? x).filter((x) => x !== (INTENCION[m.intencion] ?? m.intencion)).join(', ')].filter(Boolean).join(' | ')),
    ...preguntas.preguntas.map((p) => `? ${p.pregunta.replace(/[|\n]/g, ' ')} | ${p.tieneRespuesta} | ${p.queDecir.replace(/[|\n]/g, ' ')}`),
  ];
  definiciones[1] = aplicarOperacion(definiciones[1]!, { tipo: 'cargar_casos', texto: lineas.join('\n'), reemplazar: true }).definicion;
  const versiones = bots.map((b, i) => ({
    id: `ver-demo-${i + 1}`, botId: b.id, campanaId: b.campanaId, numero: 1, estado: 'borrador' as const, basadaEn: null, seq: 0,
    creadaPor: b.creadoPor, creadaEn: b.creadoEn, actualizadaEn: b.actualizadoEn, definicion: definiciones[i],
  }));
  return { bots, motores, llamadas, versiones };
}
