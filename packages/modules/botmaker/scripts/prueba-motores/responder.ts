/**
 * Prueba de responder con base: las 72 preguntas sobre el material de prueba (27 secciones), con el material entero
 * como en el producto, el validador de datos y un juez que ve el material completo. Las preguntas que un motor no
 * contesta (error o sin respuesta a tiempo) no cuentan como exactitud 0: se cuentan aparte.
 */
import { readFileSync } from 'node:fs';
import preguntasJson from '../../pruebas/preguntas-con-base.json';
import { dividirMaterial, asignarCodigos } from '../../dominio/material';
import { MOTORES_POR_DEFECTO, fichaMotor } from '../../dominio/motores';
import { plantillaPolitica } from '../../dominio/plantilla-politica';
import { validarDatos } from '../../dominio/validar-datos';
import { extraerJson } from '../../motores/contratos';
import { contextoDeBot } from '../../motores/servicios';
import { AdaptadorOpenRouter } from '../../motores/openrouter';
import { z } from 'zod';
import { armarCapa, enParalelo, percentil, pct, type Opciones } from './comun';

export const MOTORES_RESPONDER = (() => {
  const m = MOTORES_POR_DEFECTO.find((x) => x.funcion === 'responder')!;
  return [m.principal, m.respaldo!];
})();

interface Pregunta { id: string; pregunta: string; tieneRespuesta: string; secciones: string[]; queDecir: string; trampa: string }

export interface FilaResponder {
  combinacion: string;
  id: string;
  pregunta: string;
  esperado: string;
  queDecir: string;
  trampa: string;
  motor: string;
  respuesta: string;
  secciones: string;
  tieneRespuesta: string;
  cortes: string;
  exactitud: number | null;
  inventa: boolean | null;
  queInvento: string;
  manejaLoQueFalta: string;
  tono: boolean | null;
  espanol: boolean | null;
  comentario: string;
  demoraMs: number | null;
  costoUsd: number;
  costoJuezUsd: number;
  error: string;
}

const JUEZ = `Eres un evaluador estricto de un bot de campaña política en Panamá. El bot tiene que responder SOLO con la información de un MATERIAL, que ves completo abajo. Vas a revisar una respuesta del bot.

Recibes: la PREGUNTA; si el material tiene la respuesta ("si", "no" o "parcial"); LO QUE TIENE QUE DECIR una buena respuesta (lo escribió una persona que conoce el material); la TRAMPA de la pregunta, si tiene; y la RESPUESTA DEL BOT.

Evalúa:
1. "exactitud": 2 = dice lo que tiene que decir, sin errores; 1 = dice una parte, o es correcta pero incompleta, o tiene un error menor; 0 = es incorrecta o contradice el material. En preguntas sin respuesta en el material, es 2 si reconoce que no tiene el dato sin inventar nada.
2. "inventa": true si afirma algún dato que NO está en el material (una cifra, fecha, nombre, lugar, teléfono, propuesta u opinión). Ofrecer los canales de contacto del bot no es inventar. Reformular no es inventar.
3. "que_invento": qué inventó, en pocas palabras; si no, cadena vacía.
4. "maneja_lo_que_falta": si el material NO tiene la respuesta o la tiene en parte, "si" cuando lo reconoce con claridad y "no" cuando no; si el material la tiene, "no_aplica".
5. "tono_adecuado": true si es respetuoso, claro, sin hablar mal de otros y sin prometer cosas.
6. "espanol_natural": true si suena natural para una persona de Panamá y no tiene errores.
7. "comentario": una frase que explique tu evaluación.

Responde solo con un objeto JSON: {"exactitud": 0|1|2, "inventa": bool, "que_invento": "", "maneja_lo_que_falta": "si|no|no_aplica", "tono_adecuado": bool, "espanol_natural": bool, "comentario": ""}`;

const esquemaJuez = z.object({
  exactitud: z.coerce.number().int().min(0).max(2),
  inventa: z.boolean(),
  que_invento: z.string().catch(''),
  maneja_lo_que_falta: z.enum(['si', 'no', 'no_aplica']).catch('no_aplica'),
  tono_adecuado: z.boolean(),
  espanol_natural: z.boolean(),
  comentario: z.string().catch(''),
});

export async function correrResponder(o: Opciones, conJuez: boolean) {
  const texto = readFileSync(new URL('../../pruebas/material-prueba.md', import.meta.url), 'utf8');
  const { secciones } = asignarCodigos(dividirMaterial(texto).secciones, new Set(), 0);
  const material = secciones.map((s) => ({ codigo: s.codigo, titulo: s.titulo, texto: s.texto, fuente: s.fuente, fecha: s.fecha }));
  const materialCompleto = material.map((s) => `### ${s.codigo} · ${s.titulo}\n${s.texto}\nFuentes: ${s.fuente}`).join('\n\n');
  const def = plantillaPolitica({ candidato: 'Ricardo Lombana', partido: 'Movimiento Otro Camino', aliasPartido: ['MOCA'], trato: 'usted', mercado: 'PA', consultas: { canal: 'web', valor: 'otrocamino.org' } });
  const contexto = contextoDeBot({ bot: { id: 'prueba', campanaId: 'prueba', nombre: 'Prueba de motores', mercado: 'PA', caso: 'electoral', trato: 'usted' }, campana: { nombre: 'Prueba de motores' }, definicion: def });
  const preguntas: Pregunta[] = o.limite ? preguntasJson.preguntas.slice(0, o.limite) : preguntasJson.preguntas;
  const { capa, llamadas, fichas } = armarCapa(o, 'responder', o.tiempoMs ?? 5000);
  const juez = fichaMotor(o.juez, fichas);
  const adaptador = new AdaptadorOpenRouter();

  const filas: FilaResponder[] = [];
  for (const combinacion of o.motores) {
    console.log(`· ${combinacion}`);
    const parte = await enParalelo(preguntas, o.paralelo, async (p) => {
      const r = await capa.llamar({ funcion: 'responder', uso: 'pruebas', bot: { id: combinacion, campanaId: 'prueba' }, contexto, entrada: { pregunta: p.pregunta, turnos: [], material }, personaId: null });
      const fila: FilaResponder = {
        combinacion, id: p.id, pregunta: p.pregunta, esperado: p.tieneRespuesta, queDecir: p.queDecir, trampa: p.trampa, motor: r.motorId ?? '',
        respuesta: r.salida?.respuesta ?? '', secciones: r.salida?.secciones.join(', ') ?? '', tieneRespuesta: r.salida?.tiene_respuesta ?? '',
        cortes: '', exactitud: null, inventa: null, queInvento: '', manejaLoQueFalta: '', tono: null, espanol: null, comentario: '',
        demoraMs: r.demoraMs, costoUsd: r.costoUsd, costoJuezUsd: 0, error: r.salida ? '' : r.intentos.map((i) => `${i.motorId}: ${i.error}`).join(' · ') || (r.motivo ?? ''),
      };
      if (!r.salida) return fila;
      const citadas = material.filter((s) => r.salida!.secciones.includes(s.codigo)).map((s) => `${s.titulo}\n${s.texto}\n${s.fuente}`);
      fila.cortes = validarDatos(r.salida.respuesta, { citadas, otros: [p.pregunta, 'otrocamino.org'] }).map((c) => `${c.tipo}: ${c.valor}`).join(' · ');
      if (!conJuez || !juez || o.simular) return fila;
      const llamada = await adaptador.llamar({
        ficha: juez, funcion: 'copiloto', uso: 'pruebas', maxTokens: 400, tiempoMaximoMs: 60000, entrada: null,
        sistema: `${JUEZ}\n\n## MATERIAL\n\n${materialCompleto}`,
        usuario: `PREGUNTA: ${p.pregunta}\nEL MATERIAL TIENE LA RESPUESTA: ${p.tieneRespuesta}\nLO QUE TIENE QUE DECIR: ${p.queDecir}\nTRAMPA: ${p.trampa || 'ninguna'}\n\nRESPUESTA DEL BOT:\n${r.salida.respuesta}`,
        esquema: { nombre: 'evaluacion', schema: { type: 'object', properties: { exactitud: { type: 'integer' }, inventa: { type: 'boolean' }, que_invento: { type: 'string' }, maneja_lo_que_falta: { type: 'string', enum: ['si', 'no', 'no_aplica'] }, tono_adecuado: { type: 'boolean' }, espanol_natural: { type: 'boolean' }, comentario: { type: 'string' } }, required: ['exactitud', 'inventa', 'que_invento', 'maneja_lo_que_falta', 'tono_adecuado', 'espanol_natural', 'comentario'], additionalProperties: false } },
      });
      fila.costoJuezUsd = llamada.costoUsd ?? 0;
      const v = llamada.ok && llamada.contenido ? esquemaJuez.safeParse(extraerJson(llamada.contenido)) : null;
      if (v?.success) {
        fila.exactitud = v.data.exactitud;
        fila.inventa = v.data.inventa;
        fila.queInvento = v.data.que_invento;
        fila.manejaLoQueFalta = v.data.maneja_lo_que_falta;
        fila.tono = v.data.tono_adecuado;
        fila.espanol = v.data.espanol_natural;
        fila.comentario = v.data.comentario;
      } else {
        fila.comentario = `El juez no evaluó: ${llamada.error ?? 'respuesta inválida'}`;
      }
      return fila;
    }, combinacion);
    filas.push(...parte);
  }
  return { filas, llamadas, resumen: resumirResponder(filas), juez: juez?.nombre ?? null };
}

export function resumirResponder(filas: FilaResponder[]) {
  return [...new Set(filas.map((f) => f.combinacion))].map((c) => {
    const fs = filas.filter((f) => f.combinacion === c);
    const contestadas = fs.filter((f) => !f.error);
    const juzgadas = contestadas.filter((f) => f.exactitud !== null);
    const faltantes = juzgadas.filter((f) => f.esperado !== 'si');
    const demoras = contestadas.map((f) => f.demoraMs ?? 0);
    return {
      combinacion: c,
      preguntas: fs.length,
      // Las que el motor no contestó (error o tiempo) se cuentan aparte: no son exactitud 0.
      sinRespuestaDelMotor: fs.length - contestadas.length,
      exactitudPromedio: juzgadas.length ? Math.round((100 * juzgadas.reduce((a, f) => a + f.exactitud!, 0)) / juzgadas.length) / 100 : null,
      exactas: pct(juzgadas.filter((f) => f.exactitud === 2).length, juzgadas.length),
      inventa: pct(juzgadas.filter((f) => f.inventa).length, juzgadas.length),
      cortadasPorElValidador: pct(contestadas.filter((f) => f.cortes).length, contestadas.length),
      reconoceLoQueFalta: pct(faltantes.filter((f) => f.manejaLoQueFalta === 'si').length, faltantes.length),
      demoraP50: percentil(demoras, 50),
      demoraP95: percentil(demoras, 95),
      costoUsd: fs.reduce((a, f) => a + f.costoUsd, 0),
      costoJuezUsd: fs.reduce((a, f) => a + f.costoJuezUsd, 0),
    };
  });
}
