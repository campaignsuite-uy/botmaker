/**
 * Prueba de interpretar: los 218 mensajes del set de prueba contra la plantilla política (23 intenciones), con las
 * reglas antes del motor y la doble lectura, igual que el producto. Mide lo que pide la tarea 2.14: acierto cuando las
 * dos lecturas coinciden y cuántos mensajes terminarían en la pregunta de aclaración.
 */
import set from '../../pruebas/set-de-prueba.json';
import { ubicar } from '../../dominio/definicion';
import { plantillaPolitica } from '../../dominio/plantilla-politica';
import { reglaAntesDelMotor } from '../../dominio/reglas';
import { MOTORES_POR_DEFECTO } from '../../dominio/motores';
import { contextoDeBot } from '../../motores/servicios';
import { armarCapa, enParalelo, percentil, pct, type Opciones } from './comun';

export const MOTORES_INTERPRETAR = (() => {
  const m = MOTORES_POR_DEFECTO.find((x) => x.funcion === 'interpretar')!;
  return [`${m.principal}+${m.respaldo}`, m.principal, m.respaldo!];
})();

/** El set es de antes de unir saludo y despedida en cortesía, y de "ambiente" en la plantilla. */
const INTENCION: Record<string, string> = { saludo: 'cortesia', despedida: 'cortesia' };
const TEMA: Record<string, string> = { ambiente_basura: 'ambiente' };

export interface FilaInterpretar {
  combinacion: string;
  id: string;
  set: string;
  dificultad: string;
  mensaje: string;
  esperada: string;
  validas: string;
  regla: string;
  principal: string;
  respaldo: string;
  lectura: string;
  final: string;
  acierto: boolean | null;
  aclaracion: boolean;
  temaEsperado: string;
  tema: string;
  aciertoTema: boolean | null;
  demoraMs: number | null;
  costoUsd: number;
  error: string;
}

export async function correrInterpretar(o: Opciones) {
  const def = plantillaPolitica({ candidato: 'Ricardo Lombana', aliasCandidato: ['Lombana', 'el lic'], partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA', 'Otro Camino'], trato: 'usted', mercado: 'PA' });
  const interpretar = ubicar(def, def.textoLibre)!.caja as { rutas: Record<string, string | null> };
  const destino = (i: string) => (i in interpretar.rutas ? interpretar.rutas[i] : def.intenciones.find((x) => x.id === i)?.destino ?? null);
  const temas = new Set(def.temas.map((t) => t.id));
  const mensajes = o.limite ? set.mensajes.slice(0, o.limite) : set.mensajes;
  const { capa, llamadas } = armarCapa(o, 'interpretar', o.tiempoMs ?? 2500);
  const contexto = contextoDeBot({ bot: { id: 'prueba', campanaId: 'prueba', nombre: 'Prueba de motores', mercado: 'PA', caso: 'electoral', trato: 'usted' }, campana: { nombre: 'Prueba de motores' }, definicion: def });
  const entradaBase = {
    turnos: [],
    intenciones: def.intenciones.map((i) => ({ id: i.id, descripcion: i.descripcion, ...(i.limite ? { limite: i.limite } : {}), ejemplos: i.frases })),
    temas: def.temas.map((t) => ({ id: t.id, nombre: t.nombre })),
  };

  const filas: FilaInterpretar[] = [];
  for (const combinacion of o.motores) {
    console.log(`· ${combinacion}`);
    const parte = await enParalelo(mensajes, o.paralelo, async (m) => {
      const esperada = INTENCION[m.intencion] ?? m.intencion;
      const validas = new Set([esperada, ...m.intencionAlt.map((x) => INTENCION[x] ?? x)]);
      const temaEsperado = TEMA[m.tema] ?? m.tema;
      const temasValidos = new Set([temaEsperado, ...m.temaAlt.map((x) => TEMA[x] ?? x)]);
      const base = {
        combinacion, id: m.id, set: m.set, dificultad: m.dificultad, mensaje: m.mensaje, esperada, validas: [...validas].join(' | '),
        temaEsperado, error: '',
      };
      const regla = reglaAntesDelMotor(m.mensaje);
      if (regla) {
        return {
          ...base, regla: regla.regla, principal: '', respaldo: '', lectura: 'regla', final: regla.intencion, acierto: validas.has(regla.intencion),
          aclaracion: false, tema: '', aciertoTema: null, demoraMs: 0, costoUsd: 0,
        } satisfies FilaInterpretar;
      }
      const r = await capa.llamar({ funcion: 'interpretar', uso: 'pruebas', bot: { id: combinacion, campanaId: 'prueba' }, contexto, entrada: { ...entradaBase, mensaje: m.mensaje }, personaId: null });
      const final = r.salida?.intencion ?? '';
      const otra = r.salida?.alternativas[0]?.intencion;
      const aclaracion = r.lectura?.resultado === 'distintas' && !!otra && destino(otra) !== destino(final);
      return {
        ...base, regla: '', principal: r.lectura?.principal ?? final, respaldo: r.lectura?.respaldo ?? '', lectura: r.lectura?.resultado ?? (r.salida ? 'una' : 'ninguna'),
        final, acierto: r.salida ? validas.has(final) : null, aclaracion,
        tema: r.salida?.tema ?? '', aciertoTema: r.salida && temas.has(temaEsperado) ? temasValidos.has(r.salida.tema) : null,
        demoraMs: r.demoraMs, costoUsd: r.costoUsd, error: r.salida ? '' : r.intentos.map((i) => `${i.motorId}: ${i.error}`).join(' · ') || (r.motivo ?? ''),
      } satisfies FilaInterpretar;
    }, combinacion);
    filas.push(...parte);
  }
  return { filas, llamadas, resumen: resumirInterpretar(filas) };
}

export function resumirInterpretar(filas: FilaInterpretar[]) {
  const combinaciones = [...new Set(filas.map((f) => f.combinacion))];
  return combinaciones.map((c) => {
    const fs = filas.filter((f) => f.combinacion === c);
    const conMotor = fs.filter((f) => f.lectura !== 'regla');
    const respondidas = fs.filter((f) => f.acierto !== null);
    const coinciden = conMotor.filter((f) => f.lectura === 'coinciden');
    const demoras = conMotor.filter((f) => f.demoraMs !== null && !f.error).map((f) => f.demoraMs!);
    const conTema = fs.filter((f) => f.aciertoTema !== null);
    return {
      combinacion: c,
      mensajes: fs.length,
      porReglas: fs.length - conMotor.length,
      sinRespuesta: fs.filter((f) => f.acierto === null).length,
      acierto: pct(respondidas.filter((f) => f.acierto).length, respondidas.length),
      coinciden: pct(coinciden.length, conMotor.length),
      aciertoCuandoCoinciden: pct(coinciden.filter((f) => f.acierto).length, coinciden.length),
      aclaracion: pct(fs.filter((f) => f.aclaracion).length, fs.length),
      aciertoTema: pct(conTema.filter((f) => f.aciertoTema).length, conTema.length),
      demoraP50: percentil(demoras, 50),
      demoraP95: percentil(demoras, 95),
      costoUsd: fs.reduce((a, f) => a + f.costoUsd, 0),
      costoPorMil: conMotor.length ? (1000 * fs.reduce((a, f) => a + f.costoUsd, 0)) / fs.length : 0,
    };
  });
}
