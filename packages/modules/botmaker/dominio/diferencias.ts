/**
 * Qué cambió entre dos versiones, con las direcciones de las cajas ("2.4", "1.2 › C"): lo ve el administrador antes de
 * aprobar una publicación (tarea 4.06). Sin versión publicada, todo es nuevo.
 */
import { ETIQUETA_TIPO_CAJA, opcionesDe, type Caja, type Definicion } from './definicion';

export interface Diferencia {
  tipo: 'agregado' | 'quitado' | 'cambiado';
  parte: 'flujo' | 'caja' | 'contenido' | 'intención' | 'tema' | 'variable' | 'material' | 'casos' | 'datos';
  donde: string;
  detalle: string;
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CAMPOS: Record<string, string> = {
  nombre: 'nombre', contenido: 'texto', siguiente: 'adónde sigue', opciones: 'opciones', modo: 'forma de mostrarse', textoLibre: 'si escriben',
  rutas: 'rutas', noEntendio: 'si no entiende', temas: 'temas', pregunta: 'pregunta fija', conDato: 'con dato', sinDato: 'sin dato',
  dato: 'dato pedido', variable: 'variable', reintentos: 'reintentos', siFalla: 'si no lo da', casos: 'casos', sino: 'si no',
  motivo: 'motivo', alVolver: 'al volver', flujo: 'flujo', caja: 'caja', accion: 'acción',
};

function camposDistintos(a: Caja, b: Caja): string[] {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !['id', 'codigo', 'tipo', 'ultimaLetra'].includes(k)));
  return [...claves].filter((k) => !igual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])).map((k) => CAMPOS[k] ?? k);
}

export function diferencias(antes: Definicion | null, despues: Definicion): Diferencia[] {
  const d: Diferencia[] = [];
  const cajasDe = (def: Definicion | null) => new Map((def?.flujos ?? []).flatMap((f) => f.cajas.map((c) => [c.id, { f, c }] as const)));
  const ca = cajasDe(antes);
  const cd = cajasDe(despues);

  for (const f of despues.flujos) {
    const previo = antes?.flujos.find((x) => x.id === f.id);
    if (!previo) d.push({ tipo: 'agregado', parte: 'flujo', donde: `flujo ${f.codigo}`, detalle: f.nombre });
    else if (previo.nombre !== f.nombre) d.push({ tipo: 'cambiado', parte: 'flujo', donde: `flujo ${f.codigo}`, detalle: `se llama "${f.nombre}" (antes "${previo.nombre}")` });
  }
  for (const f of antes?.flujos ?? []) if (!despues.flujos.some((x) => x.id === f.id)) d.push({ tipo: 'quitado', parte: 'flujo', donde: `flujo ${f.codigo}`, detalle: f.nombre });

  for (const [id, { f, c }] of cd) {
    const dir = `${f.codigo}.${c.codigo}`;
    const nombre = c.nombre || ETIQUETA_TIPO_CAJA[c.tipo];
    const previo = ca.get(id);
    if (!previo) {
      d.push({ tipo: 'agregado', parte: 'caja', donde: dir, detalle: `${ETIQUETA_TIPO_CAJA[c.tipo]}: ${nombre}` });
      continue;
    }
    if (igual(previo.c, c)) continue;
    const campos = camposDistintos(previo.c, c);
    const letrasAntes = opcionesDe(previo.c).map((o) => o.letra);
    const letras = opcionesDe(c).map((o) => o.letra);
    const nuevas = letras.filter((l) => !letrasAntes.includes(l)).map((l) => `${dir} › ${l}`);
    const quitadas = letrasAntes.filter((l) => !letras.includes(l)).map((l) => `${dir} › ${l}`);
    const extra = [nuevas.length ? `opciones nuevas: ${nuevas.join(', ')}` : '', quitadas.length ? `opciones quitadas: ${quitadas.join(', ')}` : ''].filter(Boolean);
    d.push({ tipo: 'cambiado', parte: 'caja', donde: dir, detalle: `${nombre}: ${[...campos.filter((x) => x !== 'opciones' || !extra.length), ...extra].join('; ')}` });
  }
  for (const [id, { f, c }] of ca) if (!cd.has(id)) d.push({ tipo: 'quitado', parte: 'caja', donde: `${f.codigo}.${c.codigo}`, detalle: c.nombre || ETIQUETA_TIPO_CAJA[c.tipo] });

  const coleccion = <T>(parte: Diferencia['parte'], a: readonly T[], b: readonly T[], clave: (x: T) => string, nombre: (x: T) => string, detalle: (x: T, y: T) => string) => {
    for (const x of b) {
      const y = a.find((z) => clave(z) === clave(x));
      if (!y) d.push({ tipo: 'agregado', parte, donde: nombre(x), detalle: '' });
      else if (!igual(x, y)) d.push({ tipo: 'cambiado', parte, donde: nombre(x), detalle: detalle(y, x) });
    }
    for (const y of a) if (!b.some((x) => clave(x) === clave(y))) d.push({ tipo: 'quitado', parte, donde: nombre(y), detalle: '' });
  };
  const campos = (x: object, y: object) => Object.keys({ ...x, ...y }).filter((k) => !igual((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])).join(', ');
  coleccion('contenido', antes?.contenidos ?? [], despues.contenidos, (x) => x.id, (x) => x.nombre, (a, b) => (a.texto !== b.texto ? `"${b.texto.slice(0, 120)}${b.texto.length > 120 ? '…' : ''}"` : campos(a, b)));
  coleccion('intención', antes?.intenciones ?? [], despues.intenciones, (x) => x.id, (x) => x.nombre, (a, b) => {
    const destino = (id: string | null) => (id && cd.get(id) ? `${cd.get(id)!.f.codigo}.${cd.get(id)!.c.codigo}` : 'sin destino');
    return a.destino !== b.destino ? `ahora va a ${destino(b.destino)}${campos(a, b) !== 'destino' ? `; también ${campos(a, b).replace('destino, ', '').replace(', destino', '')}` : ''}` : campos(a, b);
  });
  coleccion('tema', antes?.temas ?? [], despues.temas, (x) => x.id, (x) => x.nombre, campos);
  coleccion('variable', antes?.variables ?? [], despues.variables, (x) => x.nombre, (x) => x.nombre, (a, b) => (a.valor !== b.valor ? `"${a.valor ?? ''}" → "${b.valor ?? ''}"` : campos(a, b)));
  coleccion('material', antes?.material ?? [], despues.material, (x) => x.codigo, (x) => `${x.codigo} ${x.titulo}`, campos);

  const casosAntes = antes?.casos.length ?? 0;
  if (casosAntes !== despues.casos.length || !igual(antes?.casos ?? [], despues.casos)) {
    d.push({ tipo: 'cambiado', parte: 'casos', donde: 'casos de prueba', detalle: `${casosAntes} → ${despues.casos.length}` });
  }
  for (const k of ['inicio', 'textoLibre', 'identidad', 'contacto', 'sistema'] as const) {
    if (antes && !igual(antes[k], despues[k])) {
      const que = { inicio: 'la caja de inicio', textoLibre: 'la caja que recibe los textos libres', identidad: 'el candidato o el partido', contacto: 'los canales de contacto', sistema: 'los mensajes del sistema' }[k];
      d.push({ tipo: 'cambiado', parte: 'datos', donde: que, detalle: '' });
    }
  }
  return d;
}
