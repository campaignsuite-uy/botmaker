/**
 * El bot escrito como YAML (tarea 2.07): para revisarlo de corrido, compararlo o cambiar muchas cosas de golpe.
 *
 * Exportar: la misma definición que guarda la versión, con un comentario con la dirección de cada caja ("# 2.4 ·
 * Mensaje · Pedir la pregunta") y de cada flujo. Importar: se lee, se completa lo que se puede completar solo (ids,
 * códigos y letras de lo nuevo) y se valida; los errores vuelven con línea y motivo. El servidor lo compara con el
 * borrador y lo guarda como un solo cambio, que se deshace como cualquier otro.
 *
 * Los códigos y las letras nunca se reusan: al importar, el último código de cada flujo no baja del que tenía el
 * borrador, aunque el YAML diga otra cosa.
 */
import { Document, LineCounter, parseDocument, type Node } from 'yaml';
import {
  ETIQUETA_TIPO_CAJA, esquemaDefinicion, idsUsados, letraDeNumero, nuevoId, problemasDeReferencias, validarDefinicion, type Definicion,
} from './definicion';

export interface ProblemaYaml {
  /** Línea (desde 1) donde está el problema, si se puede ubicar. */
  linea: number | null;
  mensaje: string;
}

export type ResultadoYaml = { ok: true; definicion: Definicion } | { ok: false; problemas: ProblemaYaml[] };

const LARGO_MAXIMO = 1_500_000;

export function exportarYaml(def: Definicion, encabezado: string[] = []): string {
  const doc = new Document(def);
  doc.commentBefore = [
    ...encabezado,
    'Definición de un bot de BotMaker. Cada caja lleva su dirección (flujo.caja) en el comentario de arriba.',
    'Para agregar una caja o una opción, se puede dejar sin id, sin código o sin letra: se completan al importar.',
  ].map((l) => ` ${l}`).join('\n');
  def.flujos.forEach((f, i) => {
    const nodoFlujo = doc.getIn(['flujos', i], true) as Node | undefined;
    if (nodoFlujo) nodoFlujo.commentBefore = ` Flujo ${f.codigo} · ${f.nombre}`;
    f.cajas.forEach((c, j) => {
      const nodo = doc.getIn(['flujos', i, 'cajas', j], true) as Node | undefined;
      if (nodo) nodo.commentBefore = ` ${f.codigo}.${c.codigo} · ${ETIQUETA_TIPO_CAJA[c.tipo]}${c.nombre ? ` · ${c.nombre}` : ''}`;
    });
  });
  return doc.toString({ lineWidth: 0, indentSeq: true });
}

type Objeto = Record<string, unknown>;
const esObjeto = (x: unknown): x is Objeto => !!x && typeof x === 'object' && !Array.isArray(x);

/** Completa ids, códigos y letras de lo nuevo, sin bajar nunca los últimos asignados del borrador `actual`. */
function completar(x: Objeto, actual: Definicion | null, azar?: () => number): void {
  const usados = actual ? idsUsados(actual) : new Set<string>();
  const anotar = (v: unknown) => typeof v === 'string' && usados.add(v);
  const flujos = Array.isArray(x.flujos) ? x.flujos.filter(esObjeto) : [];
  for (const f of flujos) {
    anotar(f.id);
    for (const c of Array.isArray(f.cajas) ? f.cajas.filter(esObjeto) : []) anotar(c.id);
  }
  for (const c of Array.isArray(x.contenidos) ? x.contenidos.filter(esObjeto) : []) anotar(c.id);

  const idNuevo = (prefijo: 'n' | 'f' | 'c') => {
    const id = nuevoId(prefijo, usados, azar);
    usados.add(id);
    return id;
  };
  const numero = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
  let ultimoFlujo = Math.max(numero(x.ultimoFlujo), actual?.ultimoFlujo ?? 0, ...flujos.map((f) => numero(f.codigo)));
  for (const f of flujos) {
    if (f.id === undefined) f.id = idNuevo('f');
    if (f.codigo === undefined) f.codigo = ++ultimoFlujo;
    const previo = actual?.flujos.find((y) => y.id === f.id);
    const cajas = Array.isArray(f.cajas) ? f.cajas.filter(esObjeto) : [];
    let ultimo = Math.max(numero(f.ultimoCodigo), previo?.ultimoCodigo ?? 0, ...cajas.map((c) => numero(c.codigo)));
    for (const c of cajas) {
      if (c.id === undefined) c.id = idNuevo('n');
      if (c.codigo === undefined) c.codigo = ++ultimo;
      const cajaPrevia = previo?.cajas.find((y) => y.id === c.id);
      const opciones = Array.isArray(c.opciones) ? c.opciones.filter(esObjeto) : [];
      const valorLetra = (l: unknown) => (typeof l === 'string' && /^[A-Z]{1,2}$/.test(l) ? (l.length === 1 ? l.charCodeAt(0) - 64 : (l.charCodeAt(0) - 64) * 26 + l.charCodeAt(1) - 64) : 0);
      let letra = Math.max(numero(c.ultimaLetra), cajaPrevia?.ultimaLetra ?? 0, ...opciones.map((o) => valorLetra(o.letra)));
      for (const o of opciones) if (o.letra === undefined) o.letra = letraDeNumero(++letra);
      if (opciones.length || c.ultimaLetra !== undefined || cajaPrevia) c.ultimaLetra = letra;
      if (f.inicio === undefined && c === cajas[0]) f.inicio = c.id;
    }
    f.ultimoCodigo = ultimo;
  }
  x.ultimoFlujo = ultimoFlujo;
  for (const c of Array.isArray(x.contenidos) ? x.contenidos.filter(esObjeto) : []) {
    if (c.id === undefined) c.id = idNuevo('c');
  }
}

/**
 * Lee un YAML. Con `actual` (el borrador), completa lo nuevo sin reusar códigos ni letras. Devuelve la definición
 * validada o los problemas con su línea.
 */
export function importarYaml(texto: string, actual: Definicion | null = null, opciones: { azar?: () => number } = {}): ResultadoYaml {
  if (texto.length > LARGO_MAXIMO) return { ok: false, problemas: [{ linea: null, mensaje: 'El YAML es demasiado largo (más de 1,5 MB).' }] };
  const lineas = new LineCounter();
  const doc = parseDocument(texto, { lineCounter: lineas, prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length) {
    return { ok: false, problemas: doc.errors.slice(0, 20).map((e) => ({ linea: e.linePos?.[0]?.line ?? null, mensaje: `No se puede leer el YAML: ${traducirError(e.code, e.message)}` })) };
  }
  const x = doc.toJS({ maxAliasCount: 50 }) as unknown;
  if (!esObjeto(x)) return { ok: false, problemas: [{ linea: 1, mensaje: 'El YAML tiene que ser un bot: un objeto con formato, inicio, flujos y lo demás.' }] };
  completar(x, actual, opciones.azar);

  const lineaDe = (camino: (string | number)[]): number | null => {
    for (let n = camino.length; n >= 0; n--) {
      const nodo = doc.getIn(camino.slice(0, n), true) as Node | undefined;
      if (nodo?.range) return lineas.linePos(nodo.range[0]).line;
    }
    return null;
  };

  const formato = esquemaDefinicion.safeParse(x);
  if (!formato.success) {
    return {
      ok: false,
      problemas: formato.error.issues.slice(0, 30).map((i) => ({
        linea: lineaDe(i.path as (string | number)[]),
        mensaje: `${describirCamino(x, i.path as (string | number)[])}: ${traducirZod(i.message, i.code)}`,
      })),
    };
  }
  const v = validarDefinicion(formato.data);
  if (!v.ok) {
    return {
      ok: false,
      problemas: problemasDeReferencias(formato.data).slice(0, 30).map((p) => ({ linea: lineaDe(caminoDeDonde(formato.data, p.donde)), mensaje: p.mensaje })),
    };
  }
  return { ok: true, definicion: v.definicion };
}

/** El camino de una dirección ("2.4 › B", "flujo 3", "intención propuesta") dentro de la definición. */
function caminoDeDonde(def: Definicion, donde: string): (string | number)[] {
  const caja = donde.match(/^(\d+)\.(\d+)(?: › ([A-Z]{1,2}))?$/);
  if (caja) {
    const fi = def.flujos.findIndex((f) => f.codigo === Number(caja[1]));
    const ci = fi >= 0 ? def.flujos[fi]!.cajas.findIndex((c) => c.codigo === Number(caja[2])) : -1;
    if (ci >= 0) {
      const c = def.flujos[fi]!.cajas[ci]!;
      const oi = caja[3] && 'opciones' in c ? c.opciones.findIndex((o) => o.letra === caja[3]) : -1;
      return oi >= 0 ? ['flujos', fi, 'cajas', ci, 'opciones', oi] : ['flujos', fi, 'cajas', ci];
    }
  }
  const flujo = donde.match(/^flujo (\d+)$/);
  if (flujo) return ['flujos', def.flujos.findIndex((f) => f.codigo === Number(flujo[1]))];
  const intencion = donde.match(/^intención (.+)$/);
  if (intencion) return ['intenciones', def.intenciones.findIndex((i) => i.id === intencion[1])];
  const tema = donde.match(/^tema (.+)$/);
  if (tema) return ['temas', def.temas.findIndex((t) => t.id === tema[1])];
  const contenido = donde.match(/^contenido (.+)$/);
  if (contenido) return ['contenidos', def.contenidos.findIndex((c) => c.nombre === contenido[1])];
  if (donde.startsWith('sistema ')) return ['sistema', donde.slice(8)];
  if (donde === 'inicio') return ['inicio'];
  if (donde === 'texto libre') return ['textoLibre'];
  return [];
}

/** "flujos.1.cajas.3.opciones.0.texto" → "Caja 2.4 › A, texto". */
function describirCamino(x: Objeto, camino: (string | number)[]): string {
  if (camino[0] === 'flujos' && typeof camino[1] === 'number') {
    const f = (x.flujos as Objeto[])[camino[1]];
    if (camino[2] === 'cajas' && typeof camino[3] === 'number') {
      const c = (f?.cajas as Objeto[] | undefined)?.[camino[3]];
      const dir = `Caja ${f?.codigo ?? '?'}.${c?.codigo ?? '?'}`;
      if (camino[4] === 'opciones' && typeof camino[5] === 'number') {
        const o = (c?.opciones as Objeto[] | undefined)?.[camino[5]];
        return `${dir} › ${o?.letra ?? '?'}${camino.length > 6 ? `, ${camino.slice(6).join('.')}` : ''}`;
      }
      return camino.length > 4 ? `${dir}, ${camino.slice(4).join('.')}` : dir;
    }
    return `Flujo ${f?.codigo ?? '?'}${camino.length > 2 ? `, ${camino.slice(2).join('.')}` : ''}`;
  }
  return camino.length ? camino.join('.') : 'El bot';
}

const CODIGOS_ZOD: Record<string, string> = {
  id_caja: 'el id de una caja es n_ y de 4 a 12 letras o números (o se deja sin id para que se complete)',
  id_flujo: 'el id de un flujo es f_ y de 4 a 12 letras o números',
  id_contenido: 'el id de un contenido es c_ y de 4 a 12 letras o números',
  id_catalogo: 'minúsculas, números y guion bajo, empezando con una letra',
  variable: 'una variable es bot.algo o contacto.algo',
  letra: 'la letra de una opción es de la A a la Z (o AA, AB…)',
  opcion_vacia: 'la opción no tiene texto',
  nombre_vacio: 'falta el nombre',
  descripcion_vacia: 'falta la descripción',
};

function traducirZod(mensaje: string, codigo: string): string {
  if (CODIGOS_ZOD[mensaje]) return CODIGOS_ZOD[mensaje]!;
  if (codigo === 'invalid_type' && /received undefined/.test(mensaje)) return 'falta este dato';
  if (codigo === 'invalid_type') return `el tipo no es el esperado (${mensaje})`;
  if (codigo === 'too_big') return `es demasiado largo o tiene demasiados elementos (${mensaje})`;
  if (codigo === 'too_small') return `es demasiado corto o le faltan elementos (${mensaje})`;
  if (codigo === 'invalid_value' || codigo === 'invalid_union') return `no es un valor admitido (${mensaje})`;
  return mensaje;
}

function traducirError(codigo: string, mensaje: string): string {
  if (codigo === 'DUPLICATE_KEY') return 'una clave está repetida';
  if (codigo === 'BAD_INDENT' || codigo === 'MISSING_CHAR') return 'la sangría o un carácter no están bien';
  return mensaje.split('\n')[0]!;
}
