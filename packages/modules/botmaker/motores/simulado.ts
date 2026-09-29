/**
 * Motor simulado: contesta por reglas, sin modelo, sin red y sin costo, siempre igual para la misma entrada. Lo usan la
 * demo, las pruebas automáticas y el simulador en desarrollo (BOTS_SIMULAR=1). Cumple los mismos contratos que un
 * motor real, así el resto del producto no distingue.
 */
import { buscarDireccion, validarDefinicion } from '../dominio/definicion';
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

/**
 * `semilla` (el id del motor) desempata cuando dos intenciones suman lo mismo: así, en doble lectura, dos motores
 * simulados pueden no coincidir, como pasa con los reales en los mensajes ambiguos.
 */
export function interpretarSimulado(e: EntradaInterpretar, semilla = ''): Interpretacion {
  const msj = palabras(e.mensaje);
  const saludo = /\b(hola|buenas|buen dia|buenos dias|xopa|que tal)\b/i.test(e.mensaje.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const puntaje = e.intenciones.map((i) => {
    let p = coinciden(msj, palabras([i.id.replace(/_/g, ' '), i.descripcion, ...(i.ejemplos ?? [])].join(' ')));
    // Un saludo suma poco: si el mensaje además pide algo, gana lo que pide.
    if (saludo && /saludo/.test(i.id)) p += 0.5;
    return { id: i.id, p };
  }).sort((a, b) => b.p - a.p);
  // Sin ninguna palabra en común: una pregunta para el material (así la demo contesta con base), o lo que haya.
  const sinEntender = e.intenciones.find((i) => /^(propuesta|otra|no_entendido|ninguna|otro)$/.test(i.id))?.id ?? e.intenciones[0]!.id;
  const empatados = puntaje.filter((x) => x.p > 0 && x.p === puntaje[0]!.p);
  const desempate = empatados.length > 1 ? [...semilla].reduce((a, c) => a + c.charCodeAt(0), 0) % empatados.length : 0;
  const mejor = empatados.length ? empatados[desempate]! : { id: sinEntender, p: 0 };
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
  // Responde del todo solo si la sección tiene todas las palabras de la pregunta; si no, es una respuesta parcial.
  return { respuesta: recorte, secciones: [mejor.s.codigo], tiene_respuesta: mejor.p === preg.size ? 'si' : 'parcial' };
}

const COMILLAS = /[«"“]([^»"”]+)[»"”]/;
const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const primeraMayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Copiloto simulado: entiende por reglas unos pocos pedidos, con direcciones, para que la demo y las pruebas recorran el
 * circuito entero (propuesta, revisión, aplicar y deshacer) sin un modelo. Con los motores reales entiende cualquiera.
 */
export function copilotoSimulado(e: EntradaCopiloto): PropuestaCopiloto {
  const r = validarDefinicion(e.definicion);
  const def = r.ok ? r.definicion : null;
  const pedido = e.pedido.trim();
  const p = sinTildes(pedido);
  const ops: PropuestaCopiloto['operaciones'] = [];
  const dudas: string[] = [];
  const caja = (dir: string) => (def ? buscarDireccion(def, dir) : null);

  if (e.modo === 'revision') {
    return {
      operaciones: [],
      explicacion: 'Revisión simulada: son los avisos del validador. Con los motores reales, el copiloto revisa también los textos y los caminos.',
      dudas: e.avisos?.length ? e.avisos.slice(0, 20) : ['El validador no marca nada.'],
    };
  }
  if (e.modo === 'frases' && def) {
    for (const i of def.intenciones.filter((x) => x.frases.length < 5).slice(0, 10)) {
      const nuevas = [`Consulta sobre ${i.nombre.toLowerCase()}`, `Quiero saber de ${i.nombre.toLowerCase()}`].filter((f) => !i.frases.includes(f));
      ops.push({ tipo: 'editar_intencion', datos: { intencion: i.id, cambios: { frases: [...i.frases, ...nuevas] } }, explicacion: `Suma ${nuevas.length} frases de ejemplo a ${i.nombre}.` });
    }
    return { operaciones: ops, explicacion: `Frases simuladas para ${ops.length} intenciones: con los motores reales salen como las escribiría la gente.`, dudas };
  }
  if (e.modo === 'armar' && def) {
    const inicio = def.flujos.flatMap((f) => f.cajas).find((c) => c.id === def.inicio);
    if (inicio && 'contenido' in inicio) {
      ops.push({ tipo: 'editar_contenido', datos: { contenido: inicio.contenido, cambios: { texto: `Hola. Este es el asistente virtual de ${def.identidad.candidato.nombre}. Las opciones de abajo llevan a cada tema.` } }, explicacion: 'Bienvenida con el nombre del candidato.' });
    }
    return { operaciones: ops, explicacion: 'Armado simulado: solo ajusta la bienvenida. Con los motores reales, el copiloto adapta textos, intenciones, temas y flujos al pedido y al material.', dudas };
  }

  // "en 3.4 agregá la opción Voluntariado (que lleve a 3.1)"
  let m = p.match(/(\d{1,2}\.\d{1,3})[^a-z0-9]+(?:agrega\w*|suma\w*)\s+(?:una\s+|la\s+)?opcion\s+(?:de\s+|para\s+)?(.+?)(?:,?\s*(?:que\s+(?:lleve|vaya|mande)\s+a|hacia|a)\s+(\d{1,2}\.\d{1,3}))?\.?$/);
  if (m) {
    const original = pedido.match(COMILLAS)?.[1] ?? pedido.slice(p.indexOf(m[2]!), p.indexOf(m[2]!) + m[2]!.length);
    const texto = primeraMayuscula(original.trim()).slice(0, 20);
    let destino: string | null = m[3] ?? null;
    if (!destino && def) {
      const clave = sinTildes(texto).slice(0, 7);
      destino = def.intenciones.find((i) => sinTildes(`${i.id} ${i.nombre}`).includes(clave))?.destino ?? null;
      // Una opción solo lleva a una caja de su flujo: si el destino es de otro, se usa la caja "Ir a flujo" que va ahí.
      const flujo = def.flujos.find((f) => f.cajas.some((c) => c.id === caja(m![1]!)?.cajaId));
      if (destino && flujo && !flujo.cajas.some((c) => c.id === destino)) {
        destino = flujo.cajas.find((c) => c.tipo === 'ir_a_flujo' && c.caja === destino)?.id ?? null;
      }
    }
    if (caja(m[1]!)) ops.push({ tipo: 'agregar_opcion', datos: { caja: m[1], texto, destino }, explicacion: `Agrega la opción «${texto}» en ${m[1]}${destino ? '' : ' (sin destino: elegilo en el editor)'}.` });
    else dudas.push(`No hay una caja ${m[1]} en el borrador.`);
  }
  // "en 2.2 › B cambiá el texto a «Otra cosa»"
  m = p.match(/(\d{1,2}\.\d{1,3})\s*(?:›|>)\s*([a-z]{1,2})\b.*?(?:cambia|pone|pon)\w*/);
  if (!ops.length && m && COMILLAS.test(pedido)) {
    ops.push({ tipo: 'editar_opcion', datos: { caja: `${m[1]} › ${m[2]!.toUpperCase()}`, texto: pedido.match(COMILLAS)![1]!.trim().slice(0, 24) }, explicacion: `Cambia el texto de la opción ${m[1]} › ${m[2]!.toUpperCase()}.` });
  }
  // "cambiá el texto de 1.1 por «…»"
  m = p.match(/texto\s+de\s+(?:la\s+caja\s+)?(\d{1,2}\.\d{1,3})\b/);
  if (!ops.length && m && COMILLAS.test(pedido) && def) {
    const c = caja(m[1]!);
    const x = c ? def.flujos.flatMap((f) => f.cajas).find((y) => y.id === c.cajaId) : null;
    if (x && 'contenido' in x) ops.push({ tipo: 'editar_contenido', datos: { contenido: x.contenido, cambios: { texto: pedido.match(COMILLAS)![1]!.trim() } }, explicacion: `Cambia el texto que muestra ${m[1]}.` });
    else dudas.push(`La caja ${m[1]} no muestra un texto.`);
  }
  // "quitá 2.3 › C" / "quitá la caja 2.3"
  m = p.match(/(?:quita|saca|borra)\w*\s+(?:la\s+(?:opcion|caja)\s+)?(\d{1,2}\.\d{1,3})(?:\s*(?:›|>)\s*([a-z]{1,2})\b)?/);
  if (!ops.length && m) {
    if (m[2]) ops.push({ tipo: 'quitar_opcion', datos: { caja: `${m[1]} › ${m[2].toUpperCase()}` }, explicacion: `Quita la opción ${m[1]} › ${m[2].toUpperCase()}.` });
    else ops.push({ tipo: 'quitar_caja', datos: { caja: m[1] }, explicacion: `Quita la caja ${m[1]}.` });
  }
  return {
    operaciones: ops,
    explicacion: ops.length
      ? 'Propuesta del copiloto simulado (por reglas).'
      : 'El copiloto simulado entiende pedidos como «en 2.2 agregá la opción Voluntariado», «en 2.2 › B cambiá el texto a "Otra cosa"», «cambiá el texto de 1.1 por "…"» o «quitá 2.3 › C». Con los motores reales entiende cualquier pedido.',
    dudas,
  };
}

export class AdaptadorSimulado implements Adaptador {
  readonly ruta = 'simulado' as const;

  async llamar(p: PedidoAdaptador): Promise<LlamadaCruda> {
    const inicio = performance.now();
    let salida: unknown;
    if (p.funcion === 'interpretar') salida = interpretarSimulado(p.entrada as EntradaInterpretar, p.ficha.id);
    else if (p.funcion === 'responder') salida = responderSimulado(p.entrada as EntradaResponder);
    else {
      // Como un motor real: los datos de cada operación van como texto JSON (contratoCopiloto los lee).
      const c = copilotoSimulado(p.entrada as EntradaCopiloto);
      salida = { ...c, operaciones: c.operaciones.map((o) => ({ tipo: o.tipo, datos_json: JSON.stringify(o.datos), explicacion: o.explicacion })) };
    }
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
