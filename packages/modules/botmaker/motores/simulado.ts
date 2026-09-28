/**
 * Motor simulado: contesta por reglas, sin modelo, sin red y sin costo, siempre igual para la misma entrada. Lo usan la
 * demo, las pruebas automáticas y el simulador en desarrollo (BOTS_SIMULAR=1). Cumple los mismos contratos que un
 * motor real, así el resto del producto no distingue.
 */
import type { EntradaCopiloto, EntradaInterpretar, EntradaResponder, Interpretacion, PropuestaCopiloto, RespuestaConBase } from './contratos';
import type { Adaptador, LlamadaCruda, PedidoAdaptador } from './tipos';

const VACIAS = new Set(['para', 'como', 'cuando', 'donde', 'desde', 'hasta', 'sobre', 'entre', 'tiene', 'tengo', 'quiero', 'puedo', 'saber', 'esta', 'este', 'esto', 'estos', 'estas', 'porque', 'pero', 'también', 'tambien', 'usted', 'ustedes', 'ellos', 'ellas', 'hola', 'buenas']);

export function palabras(texto: string): Set<string> {
  return new Set(
    texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9ñ]+/).filter((p) => p.length > 3 && !VACIAS.has(p)),
  );
}

const coinciden = (a: Set<string>, b: Set<string>) => [...a].filter((p) => b.has(p)).length;

export function interpretarSimulado(e: EntradaInterpretar): Interpretacion {
  const msj = palabras(e.mensaje);
  const saludo = /\b(hola|buenas|buen dia|buenos dias|xopa|que tal)\b/i.test(e.mensaje.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const puntaje = e.intenciones.map((i) => {
    let p = coinciden(msj, palabras([i.id.replace(/_/g, ' '), i.descripcion, ...(i.ejemplos ?? [])].join(' ')));
    // Un saludo suma poco: si el mensaje además pide algo, gana lo que pide.
    if (saludo && /saludo/.test(i.id)) p += 0.5;
    return { id: i.id, p };
  }).sort((a, b) => b.p - a.p);
  const sinEntender = e.intenciones.find((i) => /^(otra|no_entendido|ninguna|otro)$/.test(i.id))?.id ?? e.intenciones[0]!.id;
  const mejor = puntaje[0] && puntaje[0].p > 0 ? puntaje[0] : { id: sinEntender, p: 0 };
  const temas = e.temas.map((t) => ({ id: t.id, p: coinciden(msj, palabras(`${t.id.replace(/_/g, ' ')} ${t.nombre}`)) })).sort((a, b) => b.p - a.p);
  const ninguno = e.temas.find((t) => t.id === 'ninguno')?.id ?? e.temas[0]!.id;
  const tema = temas[0] && temas[0].p > 0 ? temas[0].id : ninguno;
  const confianza = mejor.p >= 2 ? 0.9 : mejor.p >= 1 ? 0.6 : mejor.p > 0 ? 0.8 : 0.2;
  const alternativas = puntaje.filter((x) => x.id !== mejor.id && x.p > 0).slice(0, 2).map((x) => ({ intencion: x.id, tema, confianza: 0.3 }));
  return { intencion: mejor.id, tema, confianza, alternativas };
}

export function responderSimulado(e: EntradaResponder): RespuestaConBase {
  const preg = palabras(e.pregunta);
  const orden = e.material.map((s) => ({ s, p: coinciden(preg, palabras(`${s.titulo} ${s.texto}`)) })).sort((a, b) => b.p - a.p);
  const mejor = orden[0];
  if (!mejor || mejor.p === 0) {
    return { respuesta: 'No tengo ese dato en el material del bot.', secciones: [], tiene_respuesta: 'no' };
  }
  const oraciones = mejor.s.texto.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  const recorte = oraciones.split(' ').slice(0, 90).join(' ');
  return { respuesta: recorte, secciones: [mejor.s.codigo], tiene_respuesta: mejor.p >= 2 ? 'si' : 'parcial' };
}

export function copilotoSimulado(e: EntradaCopiloto): PropuestaCopiloto {
  return {
    operaciones: [],
    explicacion: `Motor simulado: no propone cambios. Recibí el pedido «${e.pedido.slice(0, 120)}».`,
    dudas: [],
  };
}

export class AdaptadorSimulado implements Adaptador {
  readonly ruta = 'simulado' as const;

  async llamar(p: PedidoAdaptador): Promise<LlamadaCruda> {
    const inicio = performance.now();
    let salida: unknown;
    if (p.funcion === 'interpretar') salida = interpretarSimulado(p.entrada as EntradaInterpretar);
    else if (p.funcion === 'responder') salida = responderSimulado(p.entrada as EntradaResponder);
    else salida = copilotoSimulado(p.entrada as EntradaCopiloto);
    const contenido = JSON.stringify(salida);
    return {
      ok: true,
      contenido,
      error: null,
      demoraMs: Math.round(performance.now() - inicio),
      costoUsd: 0,
      tokensEntrada: Math.ceil((p.sistema.length + p.usuario.length) / 4),
      tokensSalida: Math.ceil(contenido.length / 4),
      tokensCache: 0,
      tokensRazonamiento: 0,
      proveedor: 'simulado',
      idGeneracion: null,
    };
  }
}
