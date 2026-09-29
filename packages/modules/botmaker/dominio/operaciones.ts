/**
 * Capa de operaciones: la única forma de cambiar el borrador de un bot. La usan el editor visual, el YAML (que se
 * compara con el borrador y se convierte en operaciones) y el copiloto (etapa 4).
 *
 * Cada operación se valida, se aplica sobre una copia y devuelve su inversa. La inversa es siempre una operación
 * `restaurar` con el estado anterior de las partes que cambiaron (flujos, contenidos, intenciones, temas, variables y
 * los datos sueltos): deshacer es aplicar la inversa, y la inversa de una inversa rehace. Una operación que dejaría la
 * definición inválida (un destino que no existe, un id repetido) se rechaza entera.
 */
import { z } from 'zod';
import {
  esquemaCaja, esquemaContenido, esquemaIntencion, esquemaTema, esquemaVariable, idsUsados, letraDeNumero, nuevoId, opcionesDe, problemasDeReferencias,
  esquemaDefinicion, ubicar, type Caja, type Definicion, type Problema,
} from './definicion';

export class ErrorOperacion extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly problemas: Problema[] = []) {
    super(mensaje);
  }
}

// ── Qué operaciones hay ─────────────────────────────────────────────────────────────────────────

const idCaja = z.string().min(1);
const destino = z.string().min(1).nullable();
/** Qué salida de una caja: una clave (siguiente, textoLibre…), una opción por letra, un caso de condición o una ruta de interpretar. */
const salida = z.union([
  z.enum(['siguiente', 'textoLibre', 'noEntendio', 'conDato', 'sinDato', 'siFalla', 'sino', 'alVolver']),
  z.object({ opcion: z.string().min(1) }),
  z.object({ caso: z.number().int().min(1) }),
  z.object({ intencion: z.string().min(1) }),
]);
/**
 * Una caja nueva: su tipo y sus campos, sin código (lo pone la operación). Las opciones, sin letra. El id es opcional:
 * quien arma varias operaciones juntas (el editor, el copiloto) lo elige para poder apuntar a la caja en la siguiente.
 */
const cajaNueva = z.object({ tipo: z.string() }).loose();
const partes = z.object({
  flujos: z.array(z.object({ id: z.string(), indice: z.number().int().min(0), valor: z.unknown() })).default([]),
  contenidos: z.array(z.object({ id: z.string(), indice: z.number().int().min(0), valor: z.unknown() })).default([]),
  intenciones: z.array(z.object({ id: z.string(), indice: z.number().int().min(0), valor: z.unknown() })).default([]),
  temas: z.array(z.object({ id: z.string(), indice: z.number().int().min(0), valor: z.unknown() })).default([]),
  variables: z.array(z.object({ id: z.string(), indice: z.number().int().min(0), valor: z.unknown() })).default([]),
  sueltos: z.record(z.string(), z.unknown()).default({}),
});

export const esquemaOperacion = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('agregar_flujo'), id: z.string().optional(), nombre: z.string(), primera: cajaNueva }),
  z.object({ tipo: z.literal('renombrar_flujo'), flujo: z.string(), nombre: z.string() }),
  z.object({ tipo: z.literal('quitar_flujo'), flujo: z.string() }),
  z.object({ tipo: z.literal('agregar_caja'), flujo: z.string(), caja: cajaNueva, desde: z.object({ caja: idCaja, salida }).optional() }),
  z.object({ tipo: z.literal('editar_caja'), caja: idCaja, cambios: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('quitar_caja'), caja: idCaja }),
  z.object({ tipo: z.literal('cambiar_ruta'), caja: idCaja, salida, destino }),
  z.object({ tipo: z.literal('agregar_opcion'), caja: idCaja, texto: z.string(), descripcion: z.string().optional(), destino: destino.default(null) }),
  z.object({ tipo: z.literal('editar_opcion'), caja: idCaja, letra: z.string(), texto: z.string().optional(), descripcion: z.string().optional() }),
  z.object({ tipo: z.literal('quitar_opcion'), caja: idCaja, letra: z.string() }),
  z.object({ tipo: z.literal('cambiar_inicio'), caja: idCaja }),
  z.object({ tipo: z.literal('cambiar_texto_libre'), caja: idCaja }),
  z.object({ tipo: z.literal('cambiar_inicio_flujo'), flujo: z.string(), caja: idCaja }),
  z.object({ tipo: z.literal('agregar_contenido'), contenido: z.object({ id: z.string().optional(), nombre: z.string(), tipo: z.enum(['texto', 'imagen', 'documento']).default('texto'), texto: z.string().default(''), archivo: z.unknown().optional() }) }),
  z.object({ tipo: z.literal('editar_contenido'), contenido: z.string(), cambios: z.object({ nombre: z.string().optional(), texto: z.string().optional(), archivo: z.unknown().optional() }) }),
  z.object({ tipo: z.literal('quitar_contenido'), contenido: z.string() }),
  z.object({ tipo: z.literal('agregar_intencion'), intencion: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('editar_intencion'), intencion: z.string(), cambios: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('quitar_intencion'), intencion: z.string() }),
  z.object({ tipo: z.literal('agregar_tema'), tema: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('editar_tema'), tema: z.string(), cambios: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('quitar_tema'), tema: z.string() }),
  z.object({ tipo: z.literal('agregar_variable'), variable: z.record(z.string(), z.unknown()) }),
  z.object({ tipo: z.literal('editar_variable'), variable: z.string(), cambios: z.object({ descripcion: z.string().optional(), valor: z.string().optional() }) }),
  z.object({ tipo: z.literal('quitar_variable'), variable: z.string() }),
  z.object({ tipo: z.literal('editar_identidad'), candidato: z.record(z.string(), z.unknown()).optional(), partido: z.record(z.string(), z.unknown()).nullable().optional() }),
  z.object({ tipo: z.literal('editar_contacto'), consultas: z.unknown().optional(), aportes: z.unknown().optional() }),
  z.object({ tipo: z.literal('editar_sistema'), clave: z.enum(['noEntendi', 'aclaracion', 'cierre', 'sinMotor']), contenido: z.string() }),
  z.object({ tipo: z.literal('restaurar'), partes }),
  /** Reemplazar partes enteras con lo que vino de un YAML (operacionImportar arma las partes y el resumen). */
  z.object({ tipo: z.literal('importar'), partes, resumen: z.string().max(400).default('Importó el YAML') }),
]);

export type Operacion = z.infer<typeof esquemaOperacion>;
/** Lo que se escribe al pedir una operación (los campos con valor por defecto se pueden omitir). */
export type OperacionEntrada = z.input<typeof esquemaOperacion>;
export type TipoOperacion = Operacion['tipo'];

export interface ResultadoOperacion {
  definicion: Definicion;
  /** Aplicarla deshace la operación. */
  inversa: Operacion;
  /** Para el historial y la actividad: "Agregó la caja 3.5 (Mensaje)". */
  resumen: string;
  /** El id de lo que se creó (caja, flujo, contenido), si se creó algo. */
  creado?: string;
}

export interface OpcionesOperacion {
  /** Para ids nuevos reproducibles en las pruebas. */
  azar?: () => number;
}

// ── Partes: de dónde sale la inversa ───────────────────────────────────────────────────────────

type Coleccion = 'flujos' | 'contenidos' | 'intenciones' | 'temas' | 'variables';
const COLECCIONES: Coleccion[] = ['flujos', 'contenidos', 'intenciones', 'temas', 'variables'];
const SUELTOS = ['formato', 'inicio', 'textoLibre', 'ultimoFlujo', 'identidad', 'contacto', 'sistema'] as const;
const claveDe = (c: Coleccion, x: { id?: string; nombre?: string }) => (c === 'variables' ? x.nombre! : x.id!);
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Partes = z.infer<typeof partes>;

/** Lo que hay que volver a poner para pasar de `despues` a `antes`. */
function partesParaVolver(antes: Definicion, despues: Definicion): Partes {
  const p: Partes = { flujos: [], contenidos: [], intenciones: [], temas: [], variables: [], sueltos: {} };
  for (const c of COLECCIONES) {
    const a = antes[c] as { id?: string; nombre?: string }[];
    const d = despues[c] as { id?: string; nombre?: string }[];
    const claves = new Set([...a.map((x) => claveDe(c, x)), ...d.map((x) => claveDe(c, x))]);
    for (const k of claves) {
      const ia = a.findIndex((x) => claveDe(c, x) === k);
      const id = d.findIndex((x) => claveDe(c, x) === k);
      if (ia === id && ia >= 0 && igual(a[ia], d[id])) continue;
      p[c].push({ id: k, indice: ia >= 0 ? ia : 0, valor: ia >= 0 ? a[ia] : null });
    }
  }
  for (const s of SUELTOS) if (!igual(antes[s], despues[s])) p.sueltos[s] = antes[s];
  return p;
}

function restaurar(def: Definicion, p: Partes): Definicion {
  const d = structuredClone(def);
  for (const c of COLECCIONES) {
    const lista = d[c] as { id?: string; nombre?: string }[];
    const cambios = p[c];
    // Primero se sacan todos los que cambian; después se vuelven a poner en su lugar, del primero al último.
    const sin = lista.filter((x) => !cambios.some((k) => k.id === claveDe(c, x)));
    for (const k of [...cambios].filter((k) => k.valor !== null).sort((a, b) => a.indice - b.indice)) {
      sin.splice(Math.min(k.indice, sin.length), 0, structuredClone(k.valor) as never);
    }
    (d as Record<Coleccion, unknown[]>)[c] = sin;
  }
  for (const [k, v] of Object.entries(p.sueltos)) (d as Record<string, unknown>)[k] = structuredClone(v);
  return d;
}

// ── Aplicar ─────────────────────────────────────────────────────────────────────────────────────

const falla = (codigo: string, mensaje: string): never => {
  throw new ErrorOperacion(codigo, mensaje);
};

function cajaDe(def: Definicion, id: string) {
  return ubicar(def, id) ?? falla('caja_inexistente', 'La caja no existe.');
}

function flujoDe(def: Definicion, id: string) {
  return def.flujos.find((f) => f.id === id) ?? falla('flujo_inexistente', 'El flujo no existe.');
}

/** El id que pidió quien arma la operación (si es válido y está libre) o uno nuevo. */
function idPedido(d: Definicion, prefijo: 'n' | 'f' | 'c', pedido: unknown, azar: () => number): string {
  const usados = idsUsados(d);
  if (pedido === undefined) return nuevoId(prefijo, usados, azar);
  if (typeof pedido !== 'string' || !new RegExp(`^${prefijo}_[a-z0-9]{4,12}$`).test(pedido)) falla('id_invalido', `El id ${String(pedido)} no tiene el formato ${prefijo}_ y de 4 a 12 letras o números.`);
  if (usados.has(pedido as string)) falla('id_repetido', `El id ${String(pedido)} ya está en uso.`);
  return pedido as string;
}

function construirCaja(datos: Record<string, unknown>, id: string, codigo: number): Caja {
  const opciones = Array.isArray(datos.opciones) ? (datos.opciones as Record<string, unknown>[]).map((o, i) => ({ ...o, letra: letraDeNumero(i + 1) })) : undefined;
  const r = esquemaCaja.safeParse({ ...datos, id, codigo, ultimaLetra: opciones?.length ?? 0, ...(opciones ? { opciones } : {}) });
  if (!r.success) falla('caja_invalida', `La caja no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data!;
}

/** Cambia el destino de una salida de una caja. Devuelve la etiqueta de la salida (para el resumen). */
function ponerDestino(caja: Caja, s: z.infer<typeof salida>, d: string | null): string {
  if (typeof s === 'string') {
    if (!(s in caja)) falla('salida_inexistente', `La caja no tiene la salida ${s}.`);
    (caja as Record<string, unknown>)[s] = d;
    return s;
  }
  if ('opcion' in s) {
    const o = opcionesDe(caja).find((x) => x.letra === s.opcion) ?? falla('opcion_inexistente', `La opción ${s.opcion} no existe.`);
    o.destino = d;
    return s.opcion;
  }
  if ('caso' in s) {
    if (caja.tipo !== 'condicion' || !caja.casos[s.caso - 1]) falla('salida_inexistente', `La caja no tiene el caso ${s.caso}.`);
    (caja as Extract<Caja, { tipo: 'condicion' }>).casos[s.caso - 1]!.destino = d;
    return `caso ${s.caso}`;
  }
  if (caja.tipo !== 'interpretar') falla('salida_inexistente', 'Solo una caja de interpretar tiene rutas por intención.');
  const c = caja as Extract<Caja, { tipo: 'interpretar' }>;
  c.rutas = { ...c.rutas, [s.intencion]: d };
  return s.intencion;
}

/** Deja en null toda salida (y destino de intención) que apunte a la caja. */
function soltarReferencias(def: Definicion, cajaId: string): void {
  for (const f of def.flujos) {
    for (const c of f.cajas) {
      for (const o of opcionesDe(c)) if (o.destino === cajaId) o.destino = null;
      const x = c as Record<string, unknown>;
      for (const k of ['siguiente', 'textoLibre', 'noEntendio', 'conDato', 'sinDato', 'siFalla', 'sino', 'alVolver']) if (x[k] === cajaId) x[k] = null;
      if (c.tipo === 'condicion') for (const k of c.casos) if (k.destino === cajaId) k.destino = null;
      if (c.tipo === 'interpretar') for (const [i, d] of Object.entries(c.rutas)) if (d === cajaId) c.rutas[i] = null;
    }
  }
  for (const i of def.intenciones) if (i.destino === cajaId) i.destino = null;
}

function usosDeVariable(def: Definicion, nombre: string): boolean {
  const en = (t: string) => new RegExp(`\\{\\{\\s*${nombre.replace('.', '\\.')}\\s*\\}\\}`).test(t);
  return def.contenidos.some((c) => en(c.texto))
    || def.flujos.some((f) => f.cajas.some((c) => (c.tipo === 'pedir_dato' && c.variable === nombre) || (c.tipo === 'condicion' && c.casos.some((k) => k.si.tipo === 'variable' && k.si.variable === nombre))));
}

function aplicarSinValidar(d: Definicion, op: Operacion, o: OpcionesOperacion): { resumen: string; creado?: string } {
  const azar = o.azar ?? Math.random;
  switch (op.tipo) {
    case 'agregar_flujo': {
      const id = idPedido(d, 'f', op.id, azar);
      const codigo = d.ultimoFlujo + 1;
      if (codigo > 99) falla('limite', 'Un bot tiene hasta 99 flujos.');
      const idPrimera = idPedido(d, 'n', (op.primera as { id?: unknown }).id, azar);
      if (idPrimera === id) falla('id_repetido', 'El flujo y su primera caja no pueden tener el mismo id.');
      const primera = construirCaja(op.primera as Record<string, unknown>, idPrimera, 1);
      d.flujos.push({ id, codigo, nombre: op.nombre.trim(), inicio: primera.id, cajas: [primera], ultimoCodigo: 1 });
      d.ultimoFlujo = codigo;
      return { resumen: `Agregó el flujo ${codigo} (${op.nombre.trim()})`, creado: id };
    }
    case 'renombrar_flujo': {
      const f = flujoDe(d, op.flujo);
      f.nombre = op.nombre.trim();
      return { resumen: `Renombró el flujo ${f.codigo} a ${f.nombre}` };
    }
    case 'quitar_flujo': {
      const f = flujoDe(d, op.flujo);
      if (d.flujos.length === 1) falla('ultimo_flujo', 'Un bot necesita al menos un flujo.');
      if (f.cajas.some((c) => c.id === d.inicio || c.id === d.textoLibre)) falla('es_inicio', 'El flujo tiene la caja de inicio del bot o la que recibe los textos libres.');
      for (const c of f.cajas) soltarReferencias(d, c.id);
      d.flujos = d.flujos.filter((x) => x.id !== f.id);
      // Los saltos a este flujo desde otros quedan sin destino: se quitan.
      for (const g of d.flujos) g.cajas = g.cajas.filter((c) => !(c.tipo === 'ir_a_flujo' && c.flujo === f.id));
      return { resumen: `Quitó el flujo ${f.codigo} (${f.nombre})` };
    }
    case 'agregar_caja': {
      const f = flujoDe(d, op.flujo);
      const codigo = f.ultimoCodigo + 1;
      if (codigo > 999) falla('limite', 'Un flujo tiene hasta 999 cajas.');
      const caja = construirCaja(op.caja as Record<string, unknown>, idPedido(d, 'n', (op.caja as { id?: unknown }).id, azar), codigo);
      f.cajas.push(caja);
      f.ultimoCodigo = codigo;
      if (op.desde) ponerDestino(cajaDe(d, op.desde.caja).caja, op.desde.salida, caja.id);
      return { resumen: `Agregó la caja ${f.codigo}.${codigo} (${caja.tipo})`, creado: caja.id };
    }
    case 'editar_caja': {
      const { flujo, caja } = cajaDe(d, op.caja);
      for (const k of ['id', 'codigo', 'tipo', 'opciones', 'ultimaLetra']) if (k in op.cambios) falla('campo_fijo', `El campo ${k} no se cambia con editar_caja.`);
      const r = esquemaCaja.safeParse({ ...caja, ...op.cambios });
      if (!r.success) falla('caja_invalida', `La caja no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      flujo.cajas[flujo.cajas.indexOf(caja)] = r.data!;
      return { resumen: `Editó la caja ${flujo.codigo}.${caja.codigo}` };
    }
    case 'quitar_caja': {
      const { flujo, caja } = cajaDe(d, op.caja);
      if (d.inicio === caja.id) falla('es_inicio', 'Es la caja de inicio del bot.');
      if (d.textoLibre === caja.id) falla('es_inicio', 'Es la caja que recibe los textos libres: elegí otra antes de quitarla.');
      if (flujo.inicio === caja.id) falla('es_inicio', 'Es la caja de inicio del flujo: elegí otra antes de quitarla.');
      soltarReferencias(d, caja.id);
      flujo.cajas = flujo.cajas.filter((c) => c.id !== caja.id);
      for (const g of d.flujos) g.cajas = g.cajas.filter((c) => !(c.tipo === 'ir_a_flujo' && c.caja === caja.id));
      return { resumen: `Quitó la caja ${flujo.codigo}.${caja.codigo}` };
    }
    case 'cambiar_ruta': {
      const { flujo, caja } = cajaDe(d, op.caja);
      const s = ponerDestino(caja, op.salida, op.destino);
      return { resumen: `Cambió la salida ${s} de ${flujo.codigo}.${caja.codigo}` };
    }
    case 'agregar_opcion': {
      const { flujo, caja } = cajaDe(d, op.caja);
      if (caja.tipo !== 'mensaje' && caja.tipo !== 'menu') falla('sin_opciones', 'Esta caja no tiene opciones.');
      const c = caja as Extract<Caja, { tipo: 'mensaje' | 'menu' }>;
      const letra = letraDeNumero(c.ultimaLetra + 1);
      c.opciones.push({ letra, texto: op.texto.trim(), ...(op.descripcion ? { descripcion: op.descripcion.trim() } : {}), destino: op.destino });
      c.ultimaLetra += 1;
      return { resumen: `Agregó la opción ${flujo.codigo}.${caja.codigo} › ${letra}`, creado: letra };
    }
    case 'editar_opcion': {
      const { flujo, caja } = cajaDe(d, op.caja);
      const o = opcionesDe(caja).find((x) => x.letra === op.letra) ?? falla('opcion_inexistente', `La opción ${op.letra} no existe.`);
      if (op.texto !== undefined) o.texto = op.texto.trim();
      if (op.descripcion !== undefined) o.descripcion = op.descripcion.trim() || undefined;
      return { resumen: `Editó la opción ${flujo.codigo}.${caja.codigo} › ${op.letra}` };
    }
    case 'quitar_opcion': {
      const { flujo, caja } = cajaDe(d, op.caja);
      if (caja.tipo !== 'mensaje' && caja.tipo !== 'menu') falla('sin_opciones', 'Esta caja no tiene opciones.');
      const c = caja as Extract<Caja, { tipo: 'mensaje' | 'menu' }>;
      if (!c.opciones.some((x) => x.letra === op.letra)) falla('opcion_inexistente', `La opción ${op.letra} no existe.`);
      if (c.tipo === 'menu' && c.opciones.length === 1) falla('ultima_opcion', 'Un menú necesita al menos una opción.');
      c.opciones = c.opciones.filter((x) => x.letra !== op.letra);
      return { resumen: `Quitó la opción ${flujo.codigo}.${caja.codigo} › ${op.letra}` };
    }
    case 'cambiar_inicio': {
      cajaDe(d, op.caja);
      d.inicio = op.caja;
      return { resumen: `Cambió la caja de inicio del bot a ${ubicar(d, op.caja)!.flujo.codigo}.${ubicar(d, op.caja)!.caja.codigo}` };
    }
    case 'cambiar_texto_libre': {
      const u = cajaDe(d, op.caja);
      d.textoLibre = op.caja;
      return { resumen: `Los textos libres ahora van a ${u.flujo.codigo}.${u.caja.codigo}` };
    }
    case 'cambiar_inicio_flujo': {
      const f = flujoDe(d, op.flujo);
      const c = f.cajas.find((x) => x.id === op.caja) ?? falla('caja_de_otro_flujo', 'La caja no está en ese flujo.');
      f.inicio = c.id;
      return { resumen: `Cambió la caja de inicio del flujo ${f.codigo} a ${f.codigo}.${c.codigo}` };
    }
    case 'agregar_contenido': {
      const id = idPedido(d, 'c', op.contenido.id, azar);
      const r = esquemaContenido.safeParse({ ...op.contenido, id });
      if (!r.success) falla('contenido_invalido', `El contenido no es válido: ${r.error.issues.map((i) => i.message).join('; ')}`);
      d.contenidos.push(r.data!);
      return { resumen: `Agregó el contenido ${r.data!.nombre}`, creado: id };
    }
    case 'editar_contenido': {
      const i = d.contenidos.findIndex((c) => c.id === op.contenido);
      if (i < 0) falla('contenido_inexistente', 'El contenido no existe.');
      const r = esquemaContenido.safeParse({ ...d.contenidos[i], ...op.cambios });
      if (!r.success) falla('contenido_invalido', `El contenido no es válido: ${r.error.issues.map((x) => x.message).join('; ')}`);
      d.contenidos[i] = r.data!;
      return { resumen: `Editó el contenido ${r.data!.nombre}` };
    }
    case 'quitar_contenido': {
      const c = d.contenidos.find((x) => x.id === op.contenido) ?? falla('contenido_inexistente', 'El contenido no existe.');
      const usado = d.flujos.some((f) => f.cajas.some((x) => 'contenido' in x && x.contenido === c.id)) || Object.values(d.sistema).includes(c.id);
      if (usado) falla('contenido_en_uso', `El contenido ${c.nombre} se usa en alguna caja.`);
      d.contenidos = d.contenidos.filter((x) => x.id !== c.id);
      return { resumen: `Quitó el contenido ${c.nombre}` };
    }
    case 'agregar_intencion': {
      const r = esquemaIntencion.safeParse(op.intencion);
      if (!r.success) falla('intencion_invalida', `La intención no es válida: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      if (d.intenciones.some((i) => i.id === r.data!.id)) falla('id_repetido', `La intención ${r.data!.id} ya existe.`);
      d.intenciones.push(r.data!);
      return { resumen: `Agregó la intención ${r.data!.id}`, creado: r.data!.id };
    }
    case 'editar_intencion': {
      const i = d.intenciones.findIndex((x) => x.id === op.intencion);
      if (i < 0) falla('intencion_inexistente', 'La intención no existe.');
      if ('id' in op.cambios) falla('campo_fijo', 'El id de una intención no se cambia: se quita y se agrega otra.');
      const r = esquemaIntencion.safeParse({ ...d.intenciones[i], ...op.cambios });
      if (!r.success) falla('intencion_invalida', `La intención no es válida: ${r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`);
      d.intenciones[i] = r.data!;
      return { resumen: `Editó la intención ${op.intencion}` };
    }
    case 'quitar_intencion': {
      if (!d.intenciones.some((x) => x.id === op.intencion)) falla('intencion_inexistente', 'La intención no existe.');
      d.intenciones = d.intenciones.filter((x) => x.id !== op.intencion);
      for (const f of d.flujos) for (const c of f.cajas) if (c.tipo === 'interpretar' && op.intencion in c.rutas) {
        const { [op.intencion]: _, ...resto } = c.rutas;
        c.rutas = resto;
      }
      return { resumen: `Quitó la intención ${op.intencion}` };
    }
    case 'agregar_tema': {
      const r = esquemaTema.safeParse(op.tema);
      if (!r.success) falla('tema_invalido', `El tema no es válido: ${r.error.issues.map((i) => i.message).join('; ')}`);
      if (d.temas.some((t) => t.id === r.data!.id)) falla('id_repetido', `El tema ${r.data!.id} ya existe.`);
      d.temas.push(r.data!);
      return { resumen: `Agregó el tema ${r.data!.id}`, creado: r.data!.id };
    }
    case 'editar_tema': {
      const i = d.temas.findIndex((x) => x.id === op.tema);
      if (i < 0) falla('tema_inexistente', 'El tema no existe.');
      if ('id' in op.cambios) falla('campo_fijo', 'El id de un tema no se cambia.');
      const r = esquemaTema.safeParse({ ...d.temas[i], ...op.cambios });
      if (!r.success) falla('tema_invalido', `El tema no es válido: ${r.error.issues.map((x) => x.message).join('; ')}`);
      d.temas[i] = r.data!;
      return { resumen: `Editó el tema ${op.tema}` };
    }
    case 'quitar_tema': {
      if (!d.temas.some((x) => x.id === op.tema)) falla('tema_inexistente', 'El tema no existe.');
      d.temas = d.temas.filter((x) => x.id !== op.tema);
      for (const i of d.intenciones) if (i.tema === op.tema) i.tema = null;
      for (const f of d.flujos) for (const c of f.cajas) if (c.tipo === 'respuesta_base') c.temas = c.temas.filter((t) => t !== op.tema);
      return { resumen: `Quitó el tema ${op.tema}` };
    }
    case 'agregar_variable': {
      const r = esquemaVariable.safeParse(op.variable);
      if (!r.success) falla('variable_invalida', `La variable no es válida: ${r.error.issues.map((i) => i.message).join('; ')}`);
      if (d.variables.some((v) => v.nombre === r.data!.nombre)) falla('id_repetido', `La variable ${r.data!.nombre} ya existe.`);
      d.variables.push(r.data!);
      return { resumen: `Agregó la variable ${r.data!.nombre}`, creado: r.data!.nombre };
    }
    case 'editar_variable': {
      const i = d.variables.findIndex((x) => x.nombre === op.variable);
      if (i < 0) falla('variable_inexistente', 'La variable no existe.');
      const r = esquemaVariable.safeParse({ ...d.variables[i], ...op.cambios });
      if (!r.success) falla('variable_invalida', `La variable no es válida: ${r.error.issues.map((x) => x.message).join('; ')}`);
      d.variables[i] = r.data!;
      return { resumen: `Editó la variable ${op.variable}` };
    }
    case 'quitar_variable': {
      if (!d.variables.some((x) => x.nombre === op.variable)) falla('variable_inexistente', 'La variable no existe.');
      if (usosDeVariable(d, op.variable)) falla('variable_en_uso', `La variable ${op.variable} se usa en algún contenido o caja.`);
      d.variables = d.variables.filter((x) => x.nombre !== op.variable);
      return { resumen: `Quitó la variable ${op.variable}` };
    }
    case 'editar_identidad': {
      if (op.candidato) d.identidad.candidato = { ...d.identidad.candidato, ...op.candidato } as Definicion['identidad']['candidato'];
      if (op.partido !== undefined) d.identidad.partido = op.partido === null ? null : ({ ...(d.identidad.partido ?? { nombre: '', alias: [] }), ...op.partido } as Definicion['identidad']['candidato']);
      return { resumen: 'Editó el candidato y el partido' };
    }
    case 'editar_contacto': {
      if (op.consultas !== undefined) d.contacto.consultas = op.consultas as Definicion['contacto']['consultas'];
      if (op.aportes !== undefined) d.contacto.aportes = op.aportes as Definicion['contacto']['aportes'];
      return { resumen: 'Editó los canales de contacto' };
    }
    case 'editar_sistema': {
      d.sistema[op.clave] = op.contenido;
      return { resumen: `Cambió el mensaje del sistema ${op.clave}` };
    }
    case 'restaurar': {
      const r = restaurar(d, op.partes);
      Object.assign(d, r);
      return { resumen: 'Deshizo un cambio' };
    }
    case 'importar': {
      Object.assign(d, restaurar(d, op.partes));
      return { resumen: op.resumen };
    }
  }
}

/**
 * Aplica una operación sobre una copia. Si la operación no es válida, o dejaría la definición inválida, tira
 * ErrorOperacion y la definición original no cambia.
 */
export function aplicarOperacion(def: Definicion, x: unknown, o: OpcionesOperacion = {}): ResultadoOperacion {
  const p = esquemaOperacion.safeParse(x);
  if (!p.success) throw new ErrorOperacion('operacion_invalida', `La operación no es válida: ${p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const despues = structuredClone(def);
  const { resumen, creado } = aplicarSinValidar(despues, p.data, o);
  const formato = esquemaDefinicion.safeParse(despues);
  if (!formato.success) throw new ErrorOperacion('definicion_invalida', `El cambio deja el bot inválido: ${formato.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const problemas = problemasDeReferencias(formato.data);
  if (problemas.length) throw new ErrorOperacion('definicion_invalida', `El cambio deja el bot inválido: ${problemas[0]!.mensaje}`, problemas);
  return { definicion: formato.data, inversa: { tipo: 'restaurar', partes: partesParaVolver(def, formato.data) }, resumen, ...(creado ? { creado } : {}) };
}

/** Aplica varias operaciones en orden; si una falla, no se aplica ninguna. */
export function aplicarOperaciones(def: Definicion, ops: unknown[], o: OpcionesOperacion = {}): { definicion: Definicion; inversas: Operacion[]; resumenes: string[] } {
  let d = def;
  const inversas: Operacion[] = [];
  const resumenes: string[] = [];
  for (const op of ops) {
    const r = aplicarOperacion(d, op, o);
    d = r.definicion;
    inversas.push(r.inversa);
    resumenes.push(r.resumen);
  }
  return { definicion: d, inversas, resumenes };
}

/** La operación que lleva de `despues` a `antes` (un `restaurar` con solo las partes que cambiaron). */
export function inversaEntre(antes: Definicion, despues: Definicion): Operacion {
  return { tipo: 'restaurar', partes: partesParaVolver(antes, despues) };
}

export interface ResultadoCambio {
  definicion: Definicion;
  /** Una sola inversa para todo el cambio: deshacer vuelve atrás todas sus operaciones juntas. */
  inversa: Operacion;
  /** Las operaciones ya validadas (con sus valores por defecto), tal como se guardan en el historial. */
  operaciones: Operacion[];
  resumen: string;
  creados: string[];
}

/**
 * Un cambio del borrador: una o varias operaciones que se guardan y se deshacen juntas (el editor manda una; el YAML y
 * el copiloto, varias). Si una falla, no se aplica ninguna.
 */
export function aplicarCambio(def: Definicion, ops: unknown[], o: OpcionesOperacion = {}): ResultadoCambio {
  if (!ops.length) throw new ErrorOperacion('operacion_invalida', 'El cambio no tiene operaciones.');
  let d = def;
  const operaciones: Operacion[] = [];
  const resumenes: string[] = [];
  const creados: string[] = [];
  for (const x of ops) {
    const r = aplicarOperacion(d, x, o);
    operaciones.push(esquemaOperacion.parse(x));
    d = r.definicion;
    resumenes.push(r.resumen);
    if (r.creado) creados.push(r.creado);
  }
  // Lo que se crea para una caja o un flujo nuevo en el mismo cambio (su texto, su variable) no se nombra aparte.
  const estructura = operaciones.some((x) => x.tipo === 'agregar_caja' || x.tipo === 'agregar_flujo');
  const visibles = resumenes.filter((_, i) => !(estructura && (operaciones[i]!.tipo === 'agregar_contenido' || operaciones[i]!.tipo === 'agregar_variable')));
  const resumen = visibles.length === 1 ? visibles[0]! : `${visibles.length} cambios: ${visibles.join('; ')}`;
  return { definicion: d, inversa: inversaEntre(def, d), operaciones, resumen: resumen.length > 500 ? `${resumen.slice(0, 497)}...` : resumen, creados };
}

/**
 * La operación que lleva el borrador `actual` a lo que vino de un YAML (`importada`): las partes que cambian, con un
 * resumen de qué cambió ("Importó el YAML: cambió 2 flujos y 1 contenido; agregó 1 intención"). null si no cambia nada.
 */
export function operacionImportar(actual: Definicion, importada: Definicion): Operacion | null {
  const partes = partesParaVolver(importada, actual);
  const nombres: Record<Coleccion, [string, string]> = {
    flujos: ['flujo', 'flujos'], contenidos: ['contenido', 'contenidos'], intenciones: ['intención', 'intenciones'], temas: ['tema', 'temas'], variables: ['variable', 'variables'],
  };
  const cuantos = (n: number, c: Coleccion) => `${n} ${nombres[c][n === 1 ? 0 : 1]}`;
  const agregados: string[] = [];
  const cambiados: string[] = [];
  const quitados: string[] = [];
  for (const c of COLECCIONES) {
    const antes = new Set((actual[c] as { id?: string; nombre?: string }[]).map((x) => claveDe(c, x)));
    const despues = new Set((importada[c] as { id?: string; nombre?: string }[]).map((x) => claveDe(c, x)));
    const ids = partes[c].map((p) => p.id);
    const a = ids.filter((k) => !antes.has(k)).length;
    const q = ids.filter((k) => !despues.has(k)).length;
    // Los que solo cambiaron de lugar (porque se quitó o agregó otro) no cuentan como cambiados.
    const valor = (d: Definicion, k: string) => (d[c] as { id?: string; nombre?: string }[]).find((x) => claveDe(c, x) === k);
    const m = ids.filter((k) => antes.has(k) && despues.has(k) && !igual(valor(actual, k), valor(importada, k))).length;
    if (a) agregados.push(cuantos(a, c));
    if (m) cambiados.push(cuantos(m, c));
    if (q) quitados.push(cuantos(q, c));
  }
  const sueltos = Object.keys(partes.sueltos).length;
  if (!agregados.length && !cambiados.length && !quitados.length && !sueltos) return null;
  const y = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}` : xs[0] ?? '');
  const frases = [
    cambiados.length ? `cambió ${y(cambiados)}` : '',
    agregados.length ? `agregó ${y(agregados)}` : '',
    quitados.length ? `quitó ${y(quitados)}` : '',
    sueltos ? 'cambió los datos generales' : '',
  ].filter(Boolean);
  return { tipo: 'importar', partes, resumen: `Importó el YAML: ${frases.join('; ')}` };
}
