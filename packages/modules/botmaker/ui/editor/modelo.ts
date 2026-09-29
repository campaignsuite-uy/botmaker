/**
 * Lo que el editor de flujos calcula sin dibujar (se prueba sin navegador):
 *  - el diagrama de un flujo: cada caja con sus salidas y su lugar (distribución automática con dagre, de arriba abajo);
 *  - los valores del inspector de una caja y las operaciones que salen de cambiarlos (un solo cambio: se deshace junto);
 *  - la caja nueva de cada tipo, con su contenido si lleva, y el flujo nuevo.
 * El editor nunca cambia la definición por su cuenta: manda operaciones y dibuja lo que vuelve del servidor.
 */
import { Graph, layout } from '@dagrejs/dagre';
import {
  ETIQUETA_TIPO_CAJA, idsUsados, nuevoId, opcionesDe, salidasDe, ubicar, type Caja, type CajaDe, type Condicion, type Definicion, type Flujo,
  type TipoCaja,
} from '../../dominio/definicion';

// ── Diagrama ────────────────────────────────────────────────────────────────────────────────────

export const ANCHO_NODO = 250;

export interface SalidaNodo {
  /** Id del punto de salida en el nodo (s-0, s-1…). */
  id: string;
  etiqueta: string;
  letra?: string;
  destino: string | null;
  /** Dirección del destino ("2.5"), o "Termina". */
  destinoTexto: string;
  /** El destino está en otro flujo (solo "Ir a flujo"): no se dibuja la flecha, se ofrece ir. */
  otroFlujo?: string;
}

export interface NodoDiagrama {
  id: string;
  x: number;
  y: number;
  alto: number;
  direccion: string;
  tipo: TipoCaja;
  tipoTexto: string;
  nombre: string;
  resumen: string;
  salidas: SalidaNodo[];
  inicioFlujo: boolean;
  inicioBot: boolean;
  textoLibre: boolean;
}

export interface AristaDiagrama {
  id: string;
  desde: string;
  salida: string;
  hasta: string;
}

export interface Diagrama {
  nodos: NodoDiagrama[];
  aristas: AristaDiagrama[];
}

const recortar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Lo que dice la caja, en una o dos líneas. */
export function resumenCaja(def: Definicion, c: Caja): string {
  const texto = (id: string) => def.contenidos.find((x) => x.id === id)?.texto ?? '';
  switch (c.tipo) {
    case 'mensaje':
    case 'menu':
    case 'derivacion':
      return recortar(texto(c.contenido), 110);
    case 'pedir_dato':
      return recortar(`${texto(c.contenido)} → ${c.variable}`, 110);
    case 'interpretar':
      return Object.keys(c.rutas).length ? `Rutas propias: ${Object.keys(c.rutas).join(', ')}` : 'Cada intención va a su destino.';
    case 'respuesta_base':
      return recortar(`${c.pregunta ? `Pregunta fija: ${c.pregunta}` : 'Contesta lo que escribió'} · ${c.temas.length ? `temas: ${c.temas.join(', ')}` : 'todo el material'}`, 110);
    case 'condicion':
      return recortar(c.casos.map((k, i) => `${i + 1}: ${textoCondicion(k.si)}`).join(' · '), 110);
    case 'ir_a_flujo': {
      const f = def.flujos.find((x) => x.id === c.flujo);
      return `Salta al flujo ${f ? `${f.codigo} (${f.nombre})` : '?'}`;
    }
  }
}

export function textoCondicion(si: Condicion): string {
  if (si.tipo === 'horario') return si.dentro ? 'en horario de atención' : 'fuera de horario';
  const op = { existe: 'tiene valor', no_existe: 'no tiene valor', igual: 'es', distinto: 'no es', contiene: 'contiene' }[si.operador];
  return `${si.variable} ${op}${si.valor !== undefined && si.operador !== 'existe' && si.operador !== 'no_existe' ? ` "${si.valor}"` : ''}`;
}

export function direccionDe(def: Definicion, cajaId: string | null): string {
  if (!cajaId) return 'Termina';
  const u = ubicar(def, cajaId);
  return u ? `${u.flujo.codigo}.${u.caja.codigo}` : '¿?';
}

/** Alto de un nodo según lo que muestra (el diagrama necesita saberlo antes de dibujar para distribuir). */
function altoNodo(resumen: string, salidas: number, nombre: boolean): number {
  const lineas = Math.min(3, Math.ceil(resumen.length / 38) || 1);
  return 34 + (nombre ? 20 : 0) + lineas * 16 + 10 + salidas * 24 + 8;
}

export function diagramaDeFlujo(def: Definicion, flujoId: string): Diagrama {
  const flujo = def.flujos.find((f) => f.id === flujoId);
  if (!flujo) return { nodos: [], aristas: [] };
  const enFlujo = new Set(flujo.cajas.map((c) => c.id));
  const nodos: NodoDiagrama[] = flujo.cajas.map((c) => {
    const salidas: SalidaNodo[] = salidasDe(c).map((s, i) => {
      const otro = s.destino && !enFlujo.has(s.destino) ? ubicar(def, s.destino)?.flujo : undefined;
      return {
        id: `s-${i}`, etiqueta: s.etiqueta, ...(s.letra ? { letra: s.letra } : {}), destino: s.destino,
        destinoTexto: direccionDe(def, s.destino), ...(otro ? { otroFlujo: otro.id } : {}),
      };
    });
    const resumen = resumenCaja(def, c);
    return {
      id: c.id, x: 0, y: 0, alto: altoNodo(resumen, salidas.length, !!c.nombre), direccion: `${flujo.codigo}.${c.codigo}`,
      tipo: c.tipo, tipoTexto: ETIQUETA_TIPO_CAJA[c.tipo], nombre: c.nombre ?? '', resumen, salidas,
      inicioFlujo: flujo.inicio === c.id, inicioBot: def.inicio === c.id, textoLibre: def.textoLibre === c.id,
    };
  });
  const aristas: AristaDiagrama[] = nodos.flatMap((n) => n.salidas
    .filter((s) => s.destino && enFlujo.has(s.destino))
    .map((s) => ({ id: `${n.id}:${s.id}`, desde: n.id, salida: s.id, hasta: s.destino! })));

  const g = new Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodos) g.setNode(n.id, { width: ANCHO_NODO, height: n.alto });
  // El inicio del flujo arriba: las flechas que vuelven al inicio no lo empujan hacia abajo.
  for (const a of aristas) if (a.hasta !== flujo.inicio || a.desde === a.hasta) g.setEdge(a.desde, a.hasta, {}, a.id);
  layout(g);
  for (const n of nodos) {
    const p = g.node(n.id);
    n.x = Math.round(p.x - ANCHO_NODO / 2);
    n.y = Math.round(p.y - n.alto / 2);
  }
  return { nodos, aristas };
}

// ── Inspector: valores de una caja y operaciones ────────────────────────────────────────────────

/** Lo que se edita de una caja en el inspector: sus campos, el texto de su contenido y sus opciones. */
export type ValoresCaja = Record<string, unknown> & {
  nombre: string;
  contenidoTexto?: string;
  opciones?: { letra: string; texto: string; descripcion?: string; destino: string | null }[];
};

export function valoresDeCaja(def: Definicion, c: Caja): ValoresCaja {
  const v: ValoresCaja = { ...structuredClone(c), nombre: c.nombre ?? '' } as ValoresCaja;
  if ('contenido' in c) v.contenidoTexto = def.contenidos.find((x) => x.id === c.contenido)?.texto ?? '';
  return v;
}

const FIJOS = new Set(['id', 'codigo', 'tipo', 'opciones', 'ultimaLetra', 'contenidoTexto']);
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Las operaciones que llevan la caja de como está a como quedó en el inspector (vacío si no cambió nada). */
export function operacionesDeFormulario(def: Definicion, cajaId: string, v: ValoresCaja): Record<string, unknown>[] {
  const c = ubicar(def, cajaId)?.caja;
  if (!c) return [];
  const ops: Record<string, unknown>[] = [];
  const cambios: Record<string, unknown> = {};
  for (const [k, valor] of Object.entries(v)) {
    if (FIJOS.has(k)) continue;
    const actual = (c as Record<string, unknown>)[k];
    const nuevo = k === 'nombre' ? (String(valor).trim() || undefined) : valor;
    if (!igual(actual, nuevo)) cambios[k] = nuevo;
  }
  if (Object.keys(cambios).length) ops.push({ tipo: 'editar_caja', caja: cajaId, cambios });
  const contenidoId = (v.contenido as string | undefined) ?? ('contenido' in c ? c.contenido : undefined);
  if (contenidoId && v.contenidoTexto !== undefined) {
    const actual = def.contenidos.find((x) => x.id === contenidoId)?.texto ?? '';
    if (v.contenidoTexto.trim() !== actual) ops.push({ tipo: 'editar_contenido', contenido: contenidoId, cambios: { texto: v.contenidoTexto.trim() } });
  }
  for (const o of v.opciones ?? []) {
    const antes = opcionesDe(c).find((x) => x.letra === o.letra);
    if (!antes) continue;
    const texto = o.texto.trim();
    const descripcion = (o.descripcion ?? '').trim();
    if (texto !== antes.texto || descripcion !== (antes.descripcion ?? '')) {
      ops.push({ tipo: 'editar_opcion', caja: cajaId, letra: o.letra, texto, ...(c.tipo === 'menu' ? { descripcion } : {}) });
    }
    if (o.destino !== antes.destino) ops.push({ tipo: 'cambiar_ruta', caja: cajaId, salida: { opcion: o.letra }, destino: o.destino });
  }
  return ops;
}

/** Las cajas de un flujo a las que se puede apuntar, para los selectores de destino. */
export function destinosPosibles(def: Definicion, flujo: Flujo, excepto?: string): { valor: string; texto: string }[] {
  return flujo.cajas
    .filter((c) => c.id !== excepto)
    .map((c) => ({ valor: c.id, texto: `${flujo.codigo}.${c.codigo} · ${c.nombre || ETIQUETA_TIPO_CAJA[c.tipo]}` }));
}

/** En cuántas cajas (y cuáles) se usa un contenido: el inspector avisa que cambiarlo cambia todas. */
export function usosDeContenido(def: Definicion, contenidoId: string): string[] {
  const usos = def.flujos.flatMap((f) => f.cajas.filter((c) => 'contenido' in c && c.contenido === contenidoId).map((c) => `${f.codigo}.${c.codigo}`));
  const sistema = Object.entries(def.sistema).filter(([, id]) => id === contenidoId).map(([k]) => `sistema (${k})`);
  return [...usos, ...sistema];
}

// ── Cajas y flujos nuevos ───────────────────────────────────────────────────────────────────────

const TEXTO_INICIAL: Partial<Record<TipoCaja, string>> = {
  mensaje: 'Escribí acá lo que dice el bot.',
  menu: '¿Sobre qué quiere consultar?',
  pedir_dato: '¿Me dice su nombre?',
  derivacion: 'Le paso con una persona del equipo. En un rato le responden por acá.',
};

/**
 * Las operaciones para agregar una caja de un tipo en un flujo, conectada (si se pide) desde la salida de otra caja.
 * Las que llevan texto crean su contenido en el mismo cambio. Devuelve también el id de la caja nueva.
 */
export function operacionesCajaNueva(
  def: Definicion, flujoId: string, tipo: TipoCaja, desde?: { caja: string; salida: unknown }, azar?: () => number,
): { ops: Record<string, unknown>[]; cajaId: string } {
  const usados = idsUsados(def);
  const cajaId = nuevoId('n', usados, azar);
  usados.add(cajaId);
  const flujo = def.flujos.find((f) => f.id === flujoId)!;
  const codigo = flujo.ultimoCodigo + 1;
  const ops: Record<string, unknown>[] = [];
  let contenido: string | undefined;
  if (TEXTO_INICIAL[tipo]) {
    contenido = nuevoId('c', usados, azar);
    ops.push({ tipo: 'agregar_contenido', contenido: { id: contenido, nombre: `Caja ${flujo.codigo}.${codigo}`, texto: TEXTO_INICIAL[tipo] } });
  }
  const otro = def.flujos.find((f) => f.id !== flujoId);
  const variableContacto = def.variables.find((v) => v.nombre.startsWith('contacto.'))?.nombre;
  if (tipo === 'pedir_dato' && !variableContacto) ops.push({ tipo: 'agregar_variable', variable: { nombre: 'contacto.nombre', descripcion: 'Nombre de la persona' } });
  const cajas: Record<TipoCaja, Record<string, unknown>> = {
    mensaje: { tipo, contenido, siguiente: null },
    menu: { tipo, contenido, modo: 'botones', opciones: [{ texto: 'Opción 1', destino: null }], textoLibre: null },
    interpretar: { tipo, rutas: {}, noEntendio: null },
    respuesta_base: { tipo, temas: [], conDato: null, sinDato: null },
    pedir_dato: { tipo, contenido, dato: 'nombre', variable: variableContacto ?? 'contacto.nombre', reintentos: 1, siguiente: null, siFalla: null },
    condicion: { tipo, casos: [{ si: { tipo: 'horario', dentro: true }, destino: null }], sino: null },
    derivacion: { tipo, contenido, motivo: '', alVolver: null },
    ir_a_flujo: { tipo, flujo: otro?.id, caja: otro?.inicio },
  };
  ops.push({ tipo: 'agregar_caja', flujo: flujoId, caja: { id: cajaId, ...cajas[tipo] }, ...(desde ? { desde } : {}) });
  return { ops, cajaId };
}

/** Un flujo nuevo empieza con un mensaje. */
export function operacionesFlujoNuevo(def: Definicion, nombre: string, azar?: () => number): { ops: Record<string, unknown>[]; flujoId: string } {
  const usados = idsUsados(def);
  const flujoId = nuevoId('f', usados, azar);
  usados.add(flujoId);
  const contenido = nuevoId('c', usados, azar);
  usados.add(contenido);
  const cajaId = nuevoId('n', usados, azar);
  return {
    flujoId,
    ops: [
      { tipo: 'agregar_contenido', contenido: { id: contenido, nombre: `Inicio de ${nombre.trim()}`, texto: TEXTO_INICIAL.mensaje } },
      { tipo: 'agregar_flujo', id: flujoId, nombre: nombre.trim(), primera: { id: cajaId, tipo: 'mensaje', contenido, siguiente: null } },
    ],
  };
}

/** Las salidas de una caja a las que se puede conectar una caja nueva, con su valor para `desde.salida`. */
export function salidasConectables(c: Caja): { texto: string; salida: unknown }[] {
  const op = opcionesDe(c).map((o) => ({ texto: `Opción ${o.letra} (${o.texto})`, salida: { opcion: o.letra } }));
  switch (c.tipo) {
    case 'mensaje': return c.opciones.length ? op : [{ texto: 'Sigue', salida: 'siguiente' }];
    case 'menu': return [...op, { texto: 'Si escriben', salida: 'textoLibre' }];
    case 'interpretar': return [{ texto: 'No entendió', salida: 'noEntendio' }];
    case 'respuesta_base': return [{ texto: 'Con dato', salida: 'conDato' }, { texto: 'Sin dato', salida: 'sinDato' }];
    case 'pedir_dato': return [{ texto: 'Dato válido', salida: 'siguiente' }, { texto: 'No lo dio', salida: 'siFalla' }];
    case 'condicion': return [...c.casos.map((_, i) => ({ texto: `Caso ${i + 1}`, salida: { caso: i + 1 } })), { texto: 'Si no', salida: 'sino' }];
    case 'derivacion': return [{ texto: 'Al volver', salida: 'alVolver' }];
    case 'ir_a_flujo': return [];
  }
}

/** La salida de una caja que corresponde a su punto de salida n (el mismo orden que salidasDe), para cambiar_ruta. */
export function salidaDeIndice(c: Caja, n: number): unknown | null {
  const op = opcionesDe(c);
  switch (c.tipo) {
    case 'mensaje': return c.opciones.length ? (op[n] ? { opcion: op[n]!.letra } : null) : n === 0 ? 'siguiente' : null;
    case 'menu': return n < op.length ? { opcion: op[n]!.letra } : n === op.length ? 'textoLibre' : null;
    case 'interpretar': {
      const rutas = Object.keys(c.rutas);
      return n < rutas.length ? { intencion: rutas[n] } : n === rutas.length ? 'noEntendio' : null;
    }
    case 'respuesta_base': return (['conDato', 'sinDato'] as const)[n] ?? null;
    case 'pedir_dato': return (['siguiente', 'siFalla'] as const)[n] ?? null;
    case 'condicion': return n < c.casos.length ? { caso: n + 1 } : n === c.casos.length ? 'sino' : null;
    case 'derivacion': return n === 0 ? 'alVolver' : null;
    case 'ir_a_flujo': return null;
  }
}

export type { CajaDe };
