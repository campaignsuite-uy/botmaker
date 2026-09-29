/**
 * La definición de un bot: lo que guarda cada versión (bots.versions.definition, etapa 2). Es la misma para el editor
 * visual, el YAML, el copiloto y el motor de conversación; el formato se valida con zod y las referencias entre partes
 * (destinos, contenidos, intenciones, temas, variables) con `problemasDeReferencias`.
 *
 * Direcciones: cada caja tiene un id interno que no cambia (n_7f3a) y un código humano (3.4: flujo 3, caja 4); cada
 * opción de un menú, una letra (G). Los códigos y las letras se asignan una sola vez y nunca se reusan ni se
 * renumeran, así "3.4 › G" sigue apuntando a lo mismo aunque se borren o agreguen cajas.
 */
import { z } from 'zod';

// ── Tipos de caja ───────────────────────────────────────────────────────────────────────────────

export const TIPOS_CAJA = ['mensaje', 'menu', 'interpretar', 'respuesta_base', 'pedir_dato', 'condicion', 'derivacion', 'ir_a_flujo'] as const;
export type TipoCaja = (typeof TIPOS_CAJA)[number];

export const ETIQUETA_TIPO_CAJA: Record<TipoCaja, string> = {
  mensaje: 'Mensaje',
  menu: 'Menú',
  interpretar: 'Interpretar',
  respuesta_base: 'Respuesta con base',
  pedir_dato: 'Pedir dato',
  condicion: 'Condición',
  derivacion: 'Derivación',
  ir_a_flujo: 'Ir a flujo',
};

export const DESCRIPCION_TIPO_CAJA: Record<TipoCaja, string> = {
  mensaje: 'Texto, imagen o documento, con hasta 3 botones.',
  menu: 'Botones (hasta 3) o lista (hasta 10 opciones), y qué hacer si escriben.',
  interpretar: 'Elige la intención y el tema de lo que escribió la persona.',
  respuesta_base: 'Redacta la respuesta con el material del bot.',
  pedir_dato: 'Pregunta nombre, correo, teléfono o un texto y lo guarda.',
  condicion: 'Elige el camino según el horario de atención o una variable.',
  derivacion: 'Pasa la conversación a la bandeja y silencia al bot.',
  ir_a_flujo: 'Salta a una caja de otro flujo.',
};

/** Límites que respetan los dos canales (web y WhatsApp): el validador los controla antes de publicar. */
export const LIMITES = {
  botones: 3,
  textoBoton: 20,
  opcionesLista: 10,
  textoOpcionLista: 24,
  descripcionOpcionLista: 72,
  texto: 4096,
  cajasPorFlujo: 200,
  flujos: 50,
  intenciones: 60,
  temas: 60,
  frasesPorIntencion: 30,
  alias: 10,
} as const;

// ── Piezas ──────────────────────────────────────────────────────────────────────────────────────

export const RE_ID_CAJA = /^n_[a-z0-9]{4,12}$/;
export const RE_ID_FLUJO = /^f_[a-z0-9]{4,12}$/;
export const RE_ID_CONTENIDO = /^c_[a-z0-9]{4,12}$/;
/** Intenciones y temas: minúsculas y guion bajo (propuesta, css_pensiones). */
export const RE_ID_CATALOGO = /^[a-z][a-z0-9_]{1,39}$/;
/** Variables: bot.horario (de la campaña) o contacto.nombre (de cada persona). */
export const RE_VARIABLE = /^(bot|contacto)\.[a-z][a-z0-9_]{0,29}$/;

const idCaja = z.string().regex(RE_ID_CAJA, 'id_caja');
const idFlujo = z.string().regex(RE_ID_FLUJO, 'id_flujo');
const idContenido = z.string().regex(RE_ID_CONTENIDO, 'id_contenido');
const idCatalogo = z.string().regex(RE_ID_CATALOGO, 'id_catalogo');
const refVariable = z.string().regex(RE_VARIABLE, 'variable');
const letra = z.string().regex(/^[A-Z]{1,2}$/, 'letra');
/** Adónde sigue: una caja, o null = termina el recorrido y el próximo texto va a interpretar. */
const destino = idCaja.nullable();
const texto = (max: number) => z.string().trim().max(max);

const opcion = z.object({
  letra,
  texto: texto(LIMITES.textoOpcionLista).min(1, 'opcion_vacia'),
  descripcion: texto(LIMITES.descripcionOpcionLista).optional(),
  destino,
});

const base = {
  id: idCaja,
  codigo: z.number().int().min(1).max(999),
  /** Nombre interno para el editor ("Menú principal"). No lo ve la persona. */
  nombre: texto(60).optional(),
  /** Cuántas letras se asignaron en esta caja (no se reusan). */
  ultimaLetra: z.number().int().min(0).max(702).default(0),
};

const cajaMensaje = z.object({
  ...base,
  tipo: z.literal('mensaje'),
  contenido: idContenido,
  opciones: z.array(opcion).max(LIMITES.botones).default([]),
  siguiente: destino.default(null),
  /** Algo que pasa al mandar el mensaje. dar_de_baja: la persona pidió que no le escriban más (etapa 6). */
  accion: z.enum(['dar_de_baja']).optional(),
});

const cajaMenu = z.object({
  ...base,
  tipo: z.literal('menu'),
  contenido: idContenido,
  modo: z.enum(['botones', 'lista']),
  opciones: z.array(opcion).min(1).max(LIMITES.opcionesLista),
  /** Si en vez de tocar una opción escriben: normalmente, una caja de interpretar. */
  textoLibre: destino,
});

const cajaInterpretar = z.object({
  ...base,
  tipo: z.literal('interpretar'),
  /** Destinos propios de esta caja para algunas intenciones; las demás van al destino de la intención. */
  rutas: z.record(idCatalogo, destino).default({}),
  /** Si no se entendió (ningún motor, o la intención no tiene destino). */
  noEntendio: destino,
});

const cajaRespuesta = z.object({
  ...base,
  tipo: z.literal('respuesta_base'),
  /** Solo el material de estos temas (vacío: todo el material). */
  temas: z.array(idCatalogo).default([]),
  /** Si se llega sin un texto de la persona (desde un botón), contesta esta pregunta. Sin pregunta, espera un texto. */
  pregunta: texto(300).optional(),
  conDato: destino,
  /** Sin el dato en el material: la respuesta de sin dato y después esta caja. */
  sinDato: destino,
});

const cajaPedirDato = z.object({
  ...base,
  tipo: z.literal('pedir_dato'),
  contenido: idContenido,
  dato: z.enum(['nombre', 'correo', 'telefono', 'texto']),
  variable: refVariable,
  reintentos: z.number().int().min(0).max(3).default(1),
  siguiente: destino,
  siFalla: destino,
});

const condicion = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('horario'), dentro: z.boolean() }),
  z.object({
    tipo: z.literal('variable'),
    variable: refVariable,
    operador: z.enum(['existe', 'no_existe', 'igual', 'distinto', 'contiene']),
    valor: texto(200).optional(),
  }),
]);

const cajaCondicion = z.object({
  ...base,
  tipo: z.literal('condicion'),
  casos: z.array(z.object({ si: condicion, destino })).min(1).max(10),
  sino: destino,
});

const cajaDerivacion = z.object({
  ...base,
  tipo: z.literal('derivacion'),
  contenido: idContenido,
  /** Para la bandeja: por qué se derivó ("Quiere sumarse como voluntario"). */
  motivo: texto(120).default(''),
  /** Cuando el equipo devuelve la conversación al bot. */
  alVolver: destino,
});

const cajaIrAFlujo = z.object({
  ...base,
  tipo: z.literal('ir_a_flujo'),
  flujo: idFlujo,
  caja: idCaja,
});

export const esquemaCaja = z.discriminatedUnion('tipo', [cajaMensaje, cajaMenu, cajaInterpretar, cajaRespuesta, cajaPedirDato, cajaCondicion, cajaDerivacion, cajaIrAFlujo]);

export const esquemaFlujo = z.object({
  id: idFlujo,
  codigo: z.number().int().min(1).max(99),
  nombre: texto(60).min(1, 'nombre_vacio'),
  inicio: idCaja,
  cajas: z.array(esquemaCaja).min(1).max(LIMITES.cajasPorFlujo),
  /** El último código de caja asignado en este flujo (no se reusan). */
  ultimoCodigo: z.number().int().min(0).max(999),
});

export const esquemaContenido = z.object({
  id: idContenido,
  nombre: texto(60).min(1, 'nombre_vacio'),
  tipo: z.enum(['texto', 'imagen', 'documento']),
  /** El texto (o el pie de la imagen o del documento). Puede llevar variables: {{bot.horario}}, {{contacto.nombre}}. */
  texto: texto(LIMITES.texto),
  archivo: z.object({ url: z.url(), nombre: texto(120).min(1) }).optional(),
});

export const esquemaIntencion = z.object({
  id: idCatalogo,
  nombre: texto(60).min(1, 'nombre_vacio'),
  descripcion: texto(300).min(1, 'descripcion_vacia'),
  /** Dónde termina lo que no es esta intención (lo lee el motor al interpretar). */
  limite: texto(300).default(''),
  frases: z.array(texto(200).min(1)).max(LIMITES.frasesPorIntencion).default([]),
  destino,
  tema: idCatalogo.nullable().default(null),
});

export const esquemaTema = z.object({
  id: idCatalogo,
  nombre: texto(60).min(1, 'nombre_vacio'),
  descripcion: texto(200).default(''),
});

export const esquemaVariable = z.object({
  nombre: refVariable,
  descripcion: texto(200).default(''),
  /** Solo las del bot: el valor que usa ({{bot.horario}}). Las del contacto se llenan en cada conversación. */
  valor: texto(500).optional(),
});

const persona = z.object({
  nombre: texto(80).min(1, 'nombre_vacio'),
  /** Cómo le dice la gente: "Otro Camino", "MOCA". Lo lee el motor al interpretar. */
  alias: z.array(texto(60).min(1)).max(LIMITES.alias).default([]),
});

const canal = z.object({
  canal: z.enum(['whatsapp', 'correo', 'web', 'telefono']),
  valor: texto(200).min(1),
});

export const esquemaDefinicion = z.object({
  formato: z.literal(1),
  /** La primera caja de una conversación nueva. */
  inicio: idCaja,
  /** Adónde va un texto cuando el bot no está esperando nada en particular (normalmente, una caja de interpretar). */
  textoLibre: idCaja,
  flujos: z.array(esquemaFlujo).min(1).max(LIMITES.flujos),
  /** El último código de flujo asignado (no se reusan). */
  ultimoFlujo: z.number().int().min(0).max(99),
  contenidos: z.array(esquemaContenido).default([]),
  intenciones: z.array(esquemaIntencion).max(LIMITES.intenciones).default([]),
  temas: z.array(esquemaTema).max(LIMITES.temas).default([]),
  variables: z.array(esquemaVariable).max(60).default([]),
  identidad: z.object({ candidato: persona, partido: persona.nullable().default(null) }),
  /** Canales de contacto: el de consultas es el que ofrece el bot cuando no sabe algo; el de aportes, solo para aportes. */
  contacto: z.object({ consultas: canal.nullable().default(null), aportes: canal.nullable().default(null) }),
  /** Mensajes que manda el motor de conversación por su cuenta. */
  sistema: z.object({
    /** Cuando no entendió: después sigue en la caja noEntendio. */
    noEntendi: idContenido,
    /** Cuando las dos lecturas no coinciden: la pregunta antes de los dos botones. */
    aclaracion: idContenido,
    /** Cortesía de cierre ("gracias", "ok"): la respuesta corta. */
    cierre: idContenido,
    /** Sin motor disponible (tope o falla): pedir que use las opciones. */
    sinMotor: idContenido,
  }),
});

export type Caja = z.infer<typeof esquemaCaja>;
export type Flujo = z.infer<typeof esquemaFlujo>;
export type Contenido = z.infer<typeof esquemaContenido>;
export type Intencion = z.infer<typeof esquemaIntencion>;
export type Tema = z.infer<typeof esquemaTema>;
export type Variable = z.infer<typeof esquemaVariable>;
export type Opcion = z.infer<typeof opcion>;
export type Condicion = z.infer<typeof condicion>;
export type Definicion = z.infer<typeof esquemaDefinicion>;
export type CajaDe<T extends TipoCaja> = Extract<Caja, { tipo: T }>;

// ── Direcciones ─────────────────────────────────────────────────────────────────────────────────

/** 1 → A, 26 → Z, 27 → AA. */
export function letraDeNumero(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 702) throw new Error(`Letra fuera de rango: ${n}`);
  return n <= 26 ? String.fromCharCode(64 + n) : String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));
}

export interface UbicacionCaja {
  flujo: Flujo;
  caja: Caja;
}

export function ubicar(def: Definicion, cajaId: string): UbicacionCaja | null {
  for (const flujo of def.flujos) {
    const caja = flujo.cajas.find((c) => c.id === cajaId);
    if (caja) return { flujo, caja };
  }
  return null;
}

/** "3.4" o "3.4 › G". */
export function direccion(def: Definicion, cajaId: string, letraOpcion?: string): string {
  const u = ubicar(def, cajaId);
  if (!u) return cajaId;
  return `${u.flujo.codigo}.${u.caja.codigo}${letraOpcion ? ` › ${letraOpcion}` : ''}`;
}

/** La referencia completa, con la versión: "v12 · 3.4 › G". */
export function direccionCompleta(version: number, def: Definicion, cajaId: string, letraOpcion?: string): string {
  return `v${version} · ${direccion(def, cajaId, letraOpcion)}`;
}

/** "3.4", "3.4 › G", "3.4G" o "3.4.G" → la caja (y la opción). */
export function buscarDireccion(def: Definicion, texto: string): { cajaId: string; letra?: string } | null {
  const m = texto.trim().toUpperCase().match(/^V?\d*\s*·?\s*(\d{1,2})\.(\d{1,3})\s*(?:›|>|\.)?\s*([A-Z]{1,2})?$/);
  if (!m) return null;
  const flujo = def.flujos.find((f) => f.codigo === Number(m[1]));
  const caja = flujo?.cajas.find((c) => c.codigo === Number(m[2]));
  if (!caja) return null;
  if (m[3] && !opcionesDe(caja).some((o) => o.letra === m[3])) return null;
  return m[3] ? { cajaId: caja.id, letra: m[3] } : { cajaId: caja.id };
}

export function opcionesDe(caja: Caja): Opcion[] {
  return caja.tipo === 'mensaje' || caja.tipo === 'menu' ? caja.opciones : [];
}

/** Todos los destinos de una caja, con de dónde sale cada uno (para el diagrama y el validador). */
export function salidasDe(caja: Caja): { etiqueta: string; destino: string | null; letra?: string }[] {
  const op = opcionesDe(caja).map((o) => ({ etiqueta: o.texto, destino: o.destino, letra: o.letra }));
  switch (caja.tipo) {
    case 'mensaje': return caja.opciones.length ? op : [{ etiqueta: 'Sigue', destino: caja.siguiente }];
    case 'menu': return [...op, { etiqueta: 'Si escriben', destino: caja.textoLibre }];
    case 'interpretar': return [...Object.entries(caja.rutas).map(([i, d]) => ({ etiqueta: i, destino: d })), { etiqueta: 'No entendió', destino: caja.noEntendio }];
    case 'respuesta_base': return [{ etiqueta: 'Con dato', destino: caja.conDato }, { etiqueta: 'Sin dato', destino: caja.sinDato }];
    case 'pedir_dato': return [{ etiqueta: 'Dato válido', destino: caja.siguiente }, { etiqueta: 'No lo dio', destino: caja.siFalla }];
    case 'condicion': return [...caja.casos.map((c, i) => ({ etiqueta: `Caso ${i + 1}`, destino: c.destino })), { etiqueta: 'Si no', destino: caja.sino }];
    case 'derivacion': return [{ etiqueta: 'Al volver', destino: caja.alVolver }];
    case 'ir_a_flujo': return [{ etiqueta: 'Salta', destino: caja.caja }];
  }
}

/** Los contenidos que usa una caja. */
export function contenidosDe(caja: Caja): string[] {
  return 'contenido' in caja ? [caja.contenido] : [];
}

// ── Ids nuevos ──────────────────────────────────────────────────────────────────────────────────

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Un id nuevo con el prefijo (n_, f_, c_) que no está en `usados`. `azar` se inyecta en las pruebas. */
export function nuevoId(prefijo: 'n' | 'f' | 'c', usados: Set<string>, azar: () => number = Math.random): string {
  for (let largo = 4; largo <= 12; largo++) {
    for (let intento = 0; intento < 50; intento++) {
      let s = '';
      for (let i = 0; i < largo; i++) s += ALFABETO[Math.floor(azar() * ALFABETO.length)];
      const id = `${prefijo}_${s}`;
      if (!usados.has(id)) return id;
    }
  }
  throw new Error('No se pudo generar un id nuevo.');
}

/** Todos los ids de cajas, flujos y contenidos de la definición. */
export function idsUsados(def: Definicion): Set<string> {
  return new Set([
    ...def.flujos.map((f) => f.id),
    ...def.flujos.flatMap((f) => f.cajas.map((c) => c.id)),
    ...def.contenidos.map((c) => c.id),
  ]);
}

// ── Referencias ─────────────────────────────────────────────────────────────────────────────────

export interface Problema {
  codigo: string;
  mensaje: string;
  /** Dónde: una dirección ("3.4 › G") o la parte ("intención propuesta"). */
  donde: string;
}

/** Lo que zod no ve: que cada id sea único y que cada referencia apunte a algo que existe. */
export function problemasDeReferencias(def: Definicion): Problema[] {
  const p: Problema[] = [];
  const agregar = (codigo: string, mensaje: string, donde: string) => p.push({ codigo, mensaje, donde });

  const repetidos = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
  const cajas = def.flujos.flatMap((f) => f.cajas.map((c) => ({ f, c })));
  for (const id of repetidos(cajas.map((x) => x.c.id))) agregar('id_repetido', `Hay dos cajas con el id ${id}.`, id);
  for (const id of repetidos(def.flujos.map((f) => f.id))) agregar('id_repetido', `Hay dos flujos con el id ${id}.`, id);
  for (const id of repetidos(def.contenidos.map((c) => c.id))) agregar('id_repetido', `Hay dos contenidos con el id ${id}.`, id);
  for (const id of repetidos(def.intenciones.map((i) => i.id))) agregar('id_repetido', `La intención ${id} está dos veces.`, `intención ${id}`);
  for (const id of repetidos(def.temas.map((t) => t.id))) agregar('id_repetido', `El tema ${id} está dos veces.`, `tema ${id}`);
  for (const id of repetidos(def.variables.map((v) => v.nombre))) agregar('id_repetido', `La variable ${id} está dos veces.`, id);
  for (const c of repetidos(def.flujos.map((f) => String(f.codigo)))) agregar('codigo_repetido', `Hay dos flujos con el número ${c}.`, `flujo ${c}`);
  for (const f of def.flujos) if (f.codigo > def.ultimoFlujo) agregar('codigo_fuera', `El flujo ${f.codigo} tiene un número mayor que el último asignado.`, `flujo ${f.codigo}`);

  const idCajas = new Set(cajas.map((x) => x.c.id));
  const flujoDe = new Map(cajas.map((x) => [x.c.id, x.f.id]));
  const contenidos = new Set(def.contenidos.map((c) => c.id));
  const intenciones = new Set(def.intenciones.map((i) => i.id));
  const temas = new Set(def.temas.map((t) => t.id));
  const variables = new Set(def.variables.map((v) => v.nombre));

  if (!idCajas.has(def.inicio)) agregar('destino_inexistente', 'La caja de inicio del bot no existe.', 'inicio');
  if (!idCajas.has(def.textoLibre)) agregar('destino_inexistente', 'La caja que recibe los textos libres no existe.', 'texto libre');
  for (const [clave, id] of Object.entries(def.sistema)) if (!contenidos.has(id)) agregar('contenido_inexistente', `El mensaje del sistema "${clave}" usa un contenido que no existe.`, `sistema ${clave}`);

  for (const f of def.flujos) {
    const donde = `flujo ${f.codigo}`;
    if (flujoDe.get(f.inicio) !== f.id) agregar('inicio_ajeno', `La caja de inicio del flujo ${f.codigo} no está en ese flujo.`, donde);
    for (const c of repetidos(f.cajas.map((x) => String(x.codigo)))) agregar('codigo_repetido', `Hay dos cajas ${f.codigo}.${c}.`, `${f.codigo}.${c}`);
    for (const caja of f.cajas) {
      const dir = `${f.codigo}.${caja.codigo}`;
      if (caja.codigo > f.ultimoCodigo) agregar('codigo_fuera', `La caja ${dir} tiene un número mayor que el último asignado.`, dir);
      const letras = opcionesDe(caja).map((o) => o.letra);
      for (const l of repetidos(letras)) agregar('letra_repetida', `La opción ${l} está dos veces.`, `${dir} › ${l}`);
      for (const o of opcionesDe(caja)) {
        const n = o.letra.length === 1 ? o.letra.charCodeAt(0) - 64 : (o.letra.charCodeAt(0) - 64) * 26 + o.letra.charCodeAt(1) - 64;
        if (n > caja.ultimaLetra) agregar('letra_fuera', `La opción ${o.letra} tiene una letra posterior a la última asignada.`, `${dir} › ${o.letra}`);
      }
      for (const cont of contenidosDe(caja)) if (!contenidos.has(cont)) agregar('contenido_inexistente', `La caja ${dir} usa un contenido que no existe.`, dir);
      for (const s of salidasDe(caja)) {
        const d = s.destino;
        const aqui = s.letra ? `${dir} › ${s.letra}` : dir;
        if (d === null) continue;
        if (!idCajas.has(d)) agregar('destino_inexistente', `La salida "${s.etiqueta}" de ${aqui} va a una caja que no existe.`, aqui);
        else if (caja.tipo !== 'ir_a_flujo' && flujoDe.get(d) !== f.id) agregar('destino_otro_flujo', `La salida "${s.etiqueta}" de ${aqui} va a otro flujo: usá una caja "Ir a flujo".`, aqui);
      }
      if (caja.tipo === 'ir_a_flujo') {
        if (caja.flujo === f.id) agregar('ir_al_mismo_flujo', `La caja ${dir} salta a su propio flujo.`, dir);
        else if (flujoDe.get(caja.caja) !== caja.flujo) agregar('destino_inexistente', `La caja ${dir} salta a una caja que no está en el flujo elegido.`, dir);
      }
      if (caja.tipo === 'interpretar') for (const i of Object.keys(caja.rutas)) if (!intenciones.has(i)) agregar('intencion_inexistente', `La caja ${dir} tiene una ruta para la intención ${i}, que no existe.`, dir);
      if (caja.tipo === 'respuesta_base') for (const t of caja.temas) if (!temas.has(t)) agregar('tema_inexistente', `La caja ${dir} usa el tema ${t}, que no existe.`, dir);
      if (caja.tipo === 'pedir_dato') {
        if (!caja.variable.startsWith('contacto.')) agregar('variable_del_bot', `La caja ${dir} guarda en ${caja.variable}: los datos pedidos van en una variable del contacto.`, dir);
        if (!variables.has(caja.variable)) agregar('variable_inexistente', `La caja ${dir} guarda en ${caja.variable}, que no existe.`, dir);
      }
      if (caja.tipo === 'condicion') for (const c of caja.casos) if (c.si.tipo === 'variable' && !variables.has(c.si.variable)) agregar('variable_inexistente', `La caja ${dir} usa ${c.si.variable}, que no existe.`, dir);
    }
  }
  for (const i of def.intenciones) {
    const donde = `intención ${i.id}`;
    if (i.destino !== null && !idCajas.has(i.destino)) agregar('destino_inexistente', `La intención ${i.id} va a una caja que no existe.`, donde);
    if (i.tema !== null && !temas.has(i.tema)) agregar('tema_inexistente', `La intención ${i.id} usa el tema ${i.tema}, que no existe.`, donde);
  }
  for (const c of def.contenidos) {
    for (const [, nombre] of c.texto.matchAll(/\{\{\s*([a-z.0-9_]+)\s*\}\}/g)) {
      if (!variables.has(nombre!)) agregar('variable_inexistente', `El contenido "${c.nombre}" usa {{${nombre}}}, que no existe.`, `contenido ${c.nombre}`);
    }
    if (c.tipo !== 'texto' && !c.archivo) agregar('archivo_faltante', `El contenido "${c.nombre}" es ${c.tipo} y no tiene archivo.`, `contenido ${c.nombre}`);
    if (c.tipo === 'texto' && !c.texto) agregar('texto_vacio', `El contenido "${c.nombre}" está vacío.`, `contenido ${c.nombre}`);
  }
  return p;
}

export type ResultadoValidacion = { ok: true; definicion: Definicion } | { ok: false; problemas: Problema[] };

/** Valida el formato (zod) y, si pasa, las referencias. */
export function validarDefinicion(x: unknown): ResultadoValidacion {
  const r = esquemaDefinicion.safeParse(x);
  if (!r.success) {
    return {
      ok: false,
      problemas: r.error.issues.map((i) => ({ codigo: 'formato', mensaje: `${i.path.join('.') || 'definición'}: ${i.message}`, donde: i.path.join('.') })),
    };
  }
  const problemas = problemasDeReferencias(r.data);
  return problemas.length ? { ok: false, problemas } : { ok: true, definicion: r.data };
}
