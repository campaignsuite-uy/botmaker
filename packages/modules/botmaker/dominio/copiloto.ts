/**
 * Copiloto (etapa 4, tareas 4.02 y 4.03): la IA propone operaciones sobre el borrador y una persona del equipo marca
 * cuáles aplicar. Nunca publica ni cambia nada por su cuenta: lo que se aplica es un cambio más del borrador (origen
 * "copiloto"), que se deshace como cualquier otro.
 *
 * Acá está lo que no depende del motor:
 *  - el catálogo de operaciones que puede proponer y cómo se escribe cada una (va en las instrucciones);
 *  - el borrador en forma legible, con las direcciones que usa el equipo ("2.4", "1.2 › C") al lado de cada id;
 *  - pasar las direcciones que escriba el motor ("caja": "3.4") a ids;
 *  - revisar la propuesta: cada operación se valida y se prueba sobre el borrador, en orden, antes de mostrarla.
 */
import { buscarDireccion, ETIQUETA_TIPO_CAJA, opcionesDe, type Caja, type Definicion } from './definicion';
import { aplicarOperacion, ErrorOperacion, esquemaOperacion, type Operacion } from './operaciones';

export const MODOS_COPILOTO = ['cambios', 'armar', 'frases', 'revision'] as const;
export type ModoCopiloto = (typeof MODOS_COPILOTO)[number];

export const MODO_COPILOTO: Record<ModoCopiloto, { titulo: string; ayuda: string; ejemplo: string; guia: string }> = {
  cambios: {
    titulo: 'Cambiar algo',
    ayuda: 'Un pedido puntual, con las direcciones de las cajas.',
    ejemplo: 'En 2.2 agregá la opción Voluntariado, que lleve a 3.1.',
    guia: 'Haz solo lo que pide el pedido, con la menor cantidad de operaciones.',
  },
  armar: {
    titulo: 'Armar el bot',
    ayuda: 'Adaptar el borrador a las consignas de la campaña y a su material.',
    ejemplo: 'El candidato se presenta como independiente. Priorizá las propuestas de empleo y seguridad, y sumá un flujo para voluntarios.',
    guia: 'Adapta el borrador a las consignas y al material: textos de bienvenida y de los menús, intenciones y temas que falten, flujos para las propuestas principales. Conservá lo que ya sirve; no quites intenciones ni flujos de la plantilla salvo que el pedido lo diga.',
  },
  frases: {
    titulo: 'Frases de ejemplo',
    ayuda: 'Frases como las que escribiría la gente, para cada intención.',
    ejemplo: 'Frases de ejemplo para las intenciones que tienen menos de 5.',
    guia: 'Para cada intención que corresponda, propón editar_intencion con "frases": la lista completa (las que ya tiene más las nuevas), entre 5 y 10, como las escribiría un ciudadano de ese país, con errores comunes y sin datos personales.',
  },
  revision: {
    titulo: 'Revisar el bot',
    ayuda: 'Dudas y sugerencias sobre el borrador, con arreglos propuestos.',
    ejemplo: 'Revisá el bot antes de pedir publicar.',
    guia: 'Revisa el borrador como lo haría un editor exigente: caminos sin salida, textos confusos o largos, intenciones que se pisan, cajas sin probar, promesas que el material no respalda. Pon cada hallazgo en "dudas" y propón operaciones solo para los arreglos seguros.',
  },
};

/** Lo que el copiloto puede proponer. No: restaurar, importar ni cargar material o casos en bloque (eso lo hace una persona). */
export const OPERACIONES_COPILOTO: Record<string, string> = {
  agregar_flujo: '{"id"?: "f_xxxx", "nombre": "…", "primera": <caja nueva>}',
  renombrar_flujo: '{"flujo": "f_xxxx o su número", "nombre": "…"}',
  agregar_caja: '{"flujo": "f_xxxx", "caja": <caja nueva>, "desde"?: {"caja": "n_xxxx o 2.4", "salida": <salida>}}',
  editar_caja: '{"caja": "n_xxxx o 2.4", "cambios": {campos de la caja salvo id, codigo, tipo y opciones}}',
  quitar_caja: '{"caja": "n_xxxx o 2.4"}',
  cambiar_ruta: '{"caja": "n_xxxx o 2.4", "salida": <salida>, "destino": "n_xxxx, 3.1 o null"}',
  agregar_opcion: '{"caja": "n_xxxx o 2.4", "texto": "…", "descripcion"?: "…", "destino": "n_xxxx, 3.1 o null"}',
  editar_opcion: '{"caja": "n_xxxx o 2.4", "letra": "B", "texto"?: "…", "descripcion"?: "…"}',
  quitar_opcion: '{"caja": "n_xxxx o 2.4", "letra": "B"}',
  cambiar_inicio_flujo: '{"flujo": "f_xxxx", "caja": "n_xxxx"}',
  agregar_contenido: '{"contenido": {"id"?: "c_xxxx", "nombre": "…", "texto": "…"}}',
  editar_contenido: '{"contenido": "c_xxxx", "cambios": {"nombre"?: "…", "texto"?: "…"}}',
  agregar_intencion: '{"intencion": {"id": "minusculas_y_guiones", "nombre": "…", "descripcion": "…", "limite"?: "…", "frases": ["…"], "destino": "n_xxxx o null", "tema"?: "id de tema o null"}}',
  editar_intencion: '{"intencion": "id", "cambios": {"nombre"?, "descripcion"?, "limite"?, "frases"?, "destino"?, "tema"?}}',
  quitar_intencion: '{"intencion": "id"}',
  agregar_tema: '{"tema": {"id": "minusculas_y_guiones", "nombre": "…", "descripcion"?: "…"}}',
  editar_tema: '{"tema": "id", "cambios": {"nombre"?, "descripcion"?}}',
  agregar_variable: '{"variable": {"nombre": "bot.algo o contacto.algo", "descripcion"?: "…", "valor"?: "solo las del bot"}}',
  editar_variable: '{"variable": "bot.algo", "cambios": {"descripcion"?, "valor"?}}',
  editar_sistema: '{"clave": "noEntendi | aclaracion | cierre | sinMotor | tramite", "contenido": "c_xxxx"}',
  editar_seccion: '{"seccion": "S12", "cambios": {"temas"?: ["id de tema"], "titulo"?: "…"}}',
  agregar_caso: '{"caso": {"tipo": "intencion", "mensaje": "…", "intencion": "id", "alternativas": []} o {"tipo": "base", "pregunta": "…", "tieneRespuesta": "si | no | parcial", "queDecir": "…"}}',
};

export const AYUDA_CAJAS = `Cajas nuevas ("tipo" y sus campos; las opciones sin letra, las pone el sistema):
- mensaje: {"tipo": "mensaje", "nombre"?, "contenido": "c_xxxx", "opciones": [{"texto": "hasta 20 letras", "destino": "n_xxxx o null"}] (hasta 3), "siguiente": "n_xxxx o null"}
- menu: {"tipo": "menu", "nombre"?, "contenido": "c_xxxx", "modo": "botones (hasta 3, 20 letras) | lista (hasta 10, 24 letras)", "opciones": [{"texto", "descripcion"?, "destino"}], "textoLibre": "n_xxxx o null"}
- interpretar: {"tipo": "interpretar", "nombre"?, "rutas": {"id_intencion": "n_xxxx"}, "noEntendio": "n_xxxx o null"}
- respuesta_base: {"tipo": "respuesta_base", "nombre"?, "temas": ["id"], "pregunta"?: "…", "conDato": "n_xxxx o null", "sinDato": "n_xxxx o null"}
- pedir_dato: {"tipo": "pedir_dato", "nombre"?, "contenido": "c_xxxx", "dato": "nombre | correo | telefono | texto", "variable": "contacto.algo", "siguiente": …, "siFalla": …}
- derivacion: {"tipo": "derivacion", "nombre"?, "contenido": "c_xxxx", "motivo": "…", "alVolver": "n_xxxx o null"}
- ir_a_flujo: {"tipo": "ir_a_flujo", "flujo": "f_xxxx", "caja": "n_xxxx"}
<salida>: "siguiente" | "textoLibre" | "noEntendio" | "conDato" | "sinDato" | "siFalla" | "sino" | "alVolver" | {"opcion": "B"} | {"intencion": "id"}
Un contenido nuevo se agrega antes que la caja que lo muestra, con un id que elijas (c_ y de 4 a 12 letras o números), y una caja nueva a la que apunta otra operación también lleva su id (n_…).`;

const corto = (t: string, n = 140) => {
  const x = t.replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

/** El borrador en forma legible para el motor: cada caja con su dirección, id, tipo, texto y adónde lleva. */
export function borradorLegible(def: Definicion): string {
  const dir = new Map(def.flujos.flatMap((f) => f.cajas.map((c) => [c.id, `${f.codigo}.${c.codigo}`] as const)));
  const a = (id: string | null | undefined) => (id ? `${dir.get(id) ?? '?'} [${id}]` : 'fin');
  const contenido = new Map(def.contenidos.map((c) => [c.id, c]));
  const texto = (id: string) => {
    const c = contenido.get(id);
    return c ? `${c.id} «${corto(c.texto)}»` : id;
  };
  const caja = (c: Caja): string[] => {
    const l: string[] = [];
    const cab = `${dir.get(c.id)} [${c.id}] ${ETIQUETA_TIPO_CAJA[c.tipo]}${c.nombre ? ` · ${c.nombre}` : ''}`;
    switch (c.tipo) {
      case 'mensaje': l.push(`${cab}: ${texto(c.contenido)}${c.accion ? ` · acción ${c.accion}` : ''} → ${a(c.siguiente)}`); break;
      case 'menu': l.push(`${cab} (${c.modo}): ${texto(c.contenido)} · si escriben → ${a(c.textoLibre)}`); break;
      case 'interpretar': l.push(`${cab}: rutas propias ${Object.entries(c.rutas).map(([i, d]) => `${i} → ${a(d)}`).join(', ') || 'ninguna'} · si no entiende → ${a(c.noEntendio)}`); break;
      case 'respuesta_base': l.push(`${cab}: temas ${c.temas.join(', ') || 'todos'}${c.pregunta ? ` · pregunta fija «${c.pregunta}»` : ''} · con dato → ${a(c.conDato)} · sin dato → ${a(c.sinDato)}`); break;
      case 'pedir_dato': l.push(`${cab}: pide ${c.dato} en ${c.variable} con ${texto(c.contenido)} → ${a(c.siguiente)} · si no lo da → ${a(c.siFalla)}`); break;
      case 'condicion': l.push(`${cab}: ${c.casos.map((k, i) => `caso ${i + 1} (${k.si.tipo === 'horario' ? (k.si.dentro ? 'dentro de horario' : 'fuera de horario') : `${k.si.variable} ${k.si.operador} ${k.si.valor ?? ''}`.trim()}) → ${a(k.destino)}`).join(' · ')} · si no → ${a(c.sino)}`); break;
      case 'derivacion': l.push(`${cab}: ${texto(c.contenido)} · motivo «${c.motivo}» · al volver → ${a(c.alVolver)}`); break;
      case 'ir_a_flujo': l.push(`${cab}: salta a ${a(c.caja)}`); break;
    }
    for (const o of opcionesDe(c)) l.push(`   ${dir.get(c.id)} › ${o.letra} «${o.texto}»${o.descripcion ? ` (${o.descripcion})` : ''} → ${a(o.destino)}`);
    return l;
  };
  const partes = [
    `Inicio: ${a(def.inicio)} · textos libres: ${a(def.textoLibre)}`,
    `Candidato: ${def.identidad.candidato.nombre}${def.identidad.partido ? ` · partido: ${def.identidad.partido.nombre}` : ''}`,
    '',
    ...def.flujos.flatMap((f) => [`## Flujo ${f.codigo} [${f.id}] ${f.nombre} (empieza en ${a(f.inicio)})`, ...f.cajas.flatMap(caja), '']),
    '## Intenciones (id: nombre · destino · frases)',
    ...def.intenciones.map((i) => `- ${i.id}: ${i.nombre} · ${corto(i.descripcion, 100)} · → ${a(i.destino)}${i.tema ? ` · tema ${i.tema}` : ''} · ${i.frases.length} frases${i.frases.length ? `: ${i.frases.slice(0, 3).map((x) => `«${corto(x, 60)}»`).join(', ')}` : ''}`),
    '',
    `## Temas: ${def.temas.map((t) => `${t.id} (${t.nombre})`).join(', ') || 'ninguno'}`,
    `## Variables: ${def.variables.map((v) => `${v.nombre}${v.valor ? ` = «${corto(v.valor, 60)}»` : ''}`).join(', ') || 'ninguna'}`,
    `## Contenidos sin caja: ${def.contenidos.filter((c) => !def.flujos.some((f) => f.cajas.some((x) => 'contenido' in x && x.contenido === c.id))).map((c) => `${c.id} ${c.nombre}`).join(', ') || 'ninguno'}`,
    `## Mensajes del sistema: ${Object.entries(def.sistema).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
    `## Material: ${def.material.length} secciones${def.material.length ? ` (${def.material.map((s) => `${s.codigo} ${corto(s.titulo, 50)}${s.temas.length ? ` [${s.temas.join(', ')}]` : ''}`).join('; ')})` : ''}`,
    `## Casos de prueba: ${def.casos.length}`,
  ];
  return partes.join('\n');
}

// ── Direcciones → ids ───────────────────────────────────────────────────────────────────────────

const CLAVES_CAJA = new Set(['caja', 'destino', 'siguiente', 'textoLibre', 'noEntendio', 'conDato', 'sinDato', 'siFalla', 'sino', 'alVolver', 'inicio']);
const RE_DIRECCION = /^\s*(\d{1,2})\.(\d{1,3})\s*$/;
const RE_DIRECCION_OPCION = /^\s*(\d{1,2})\.(\d{1,3})\s*(?:›|>)\s*([A-Za-z]{1,2})\s*$/;

/**
 * Cambia las direcciones que escribió el motor por ids: "caja": "3.4" → "n_…", "flujo": "3" → "f_…", "caja": "3.4 › B"
 * → caja + letra (editar_opcion, quitar_opcion) o salida {opcion: "B"} (cambiar_ruta). Lo que no reconoce lo deja igual:
 * la validación de la operación dice qué está mal.
 */
export function resolverDirecciones(def: Definicion, tipo: string, datos: Record<string, unknown>): Record<string, unknown> {
  const caja = (v: string) => {
    const m = v.match(RE_DIRECCION);
    if (!m) return v;
    return buscarDireccion(def, `${m[1]}.${m[2]}`)?.cajaId ?? v;
  };
  const flujo = (v: unknown) => {
    const m = String(v).match(/^\s*(?:flujo\s*)?(\d{1,2})\s*$/i);
    return m ? def.flujos.find((f) => f.codigo === Number(m[1]))?.id ?? v : v;
  };
  const recorrer = (x: unknown, clave: string | null): unknown => {
    if (Array.isArray(x)) return x.map((y) => recorrer(y, clave === 'rutas' ? 'destino' : null));
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (clave === 'rutas' && typeof v === 'string') r[k] = caja(v);
        else r[k] = recorrer(v, k);
      }
      return r;
    }
    if (typeof x === 'string' && clave && CLAVES_CAJA.has(clave)) return caja(x);
    if (clave === 'flujo' && (typeof x === 'string' || typeof x === 'number')) return flujo(x);
    return x;
  };
  const r = recorrer(datos, null) as Record<string, unknown>;
  if (typeof r.caja === 'string') {
    const m = r.caja.match(RE_DIRECCION_OPCION);
    if (m) {
      const id = buscarDireccion(def, `${m[1]}.${m[2]}`)?.cajaId;
      if (id) {
        r.caja = id;
        const letra = m[3]!.toUpperCase();
        if (tipo === 'cambiar_ruta') r.salida = { opcion: letra };
        else r.letra = r.letra ?? letra;
      }
    }
  }
  if (r.desde && typeof r.desde === 'object') {
    const d = r.desde as Record<string, unknown>;
    const m = typeof d.caja === 'string' ? d.caja.match(RE_DIRECCION_OPCION) : null;
    if (m) {
      const id = buscarDireccion(def, `${m[1]}.${m[2]}`)?.cajaId;
      if (id) r.desde = { caja: id, salida: { opcion: m[3]!.toUpperCase() } };
    }
  }
  return r;
}

// ── Revisar la propuesta ────────────────────────────────────────────────────────────────────────

export interface PropuestaCruda {
  operaciones: { tipo: string; datos: Record<string, unknown>; explicacion: string }[];
  explicacion: string;
  dudas: string[];
}

export interface ItemPropuesta {
  indice: number;
  tipo: string;
  explicacion: string;
  /** Lo que hace, en palabras del historial ("Agregó la opción 2.2 › C"); vacío si no se pudo aplicar. */
  resumen: string;
  /** La operación lista para aplicar (con ids), o null si no sirve. */
  operacion: Operacion | null;
  error: string | null;
}

export interface PropuestaRevisada {
  items: ItemPropuesta[];
  explicacion: string;
  dudas: string[];
}

/** Máximo de operaciones que se muestran de una propuesta (un bot armado entero entra de sobra). */
export const MAX_OPERACIONES_COPILOTO = 150;

/**
 * Valida cada operación y la prueba sobre el borrador, en orden (una puede usar lo que creó la anterior). La que falla
 * queda marcada con su error y no se tiene en cuenta para las siguientes. Los ids que la operación eligió sola quedan
 * fijos, así lo que se aplica después es exactamente lo que se mostró.
 */
export function revisarPropuesta(def: Definicion, p: PropuestaCruda, azar?: () => number): PropuestaRevisada {
  let d = def;
  const items: ItemPropuesta[] = [];
  for (const [indice, x] of p.operaciones.slice(0, MAX_OPERACIONES_COPILOTO).entries()) {
    const base = { indice, tipo: x.tipo, explicacion: x.explicacion.trim().slice(0, 400) };
    if (!(x.tipo in OPERACIONES_COPILOTO)) {
      items.push({ ...base, resumen: '', operacion: null, error: `El copiloto no puede hacer "${x.tipo}".` });
      continue;
    }
    const datos = resolverDirecciones(d, x.tipo, x.datos ?? {});
    const v = esquemaOperacion.safeParse({ ...datos, tipo: x.tipo });
    if (!v.success) {
      items.push({ ...base, resumen: '', operacion: null, error: `No es válida: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`).join('; ')}` });
      continue;
    }
    try {
      const r = aplicarOperacion(d, v.data, azar ? { azar } : {});
      const op = structuredClone(v.data);
      if (r.creado) {
        if (op.tipo === 'agregar_caja' && !(op.caja as { id?: string }).id) (op.caja as { id?: string }).id = r.creado;
        if (op.tipo === 'agregar_contenido' && !op.contenido.id) op.contenido.id = r.creado;
        if (op.tipo === 'agregar_flujo' && !op.id) {
          op.id = r.creado;
          const f = r.definicion.flujos.find((y) => y.id === r.creado);
          if (f && !(op.primera as { id?: string }).id) (op.primera as { id?: string }).id = f.inicio;
        }
      }
      d = r.definicion;
      items.push({ ...base, resumen: r.resumen, operacion: op, error: null });
    } catch (e) {
      items.push({ ...base, resumen: '', operacion: null, error: e instanceof ErrorOperacion ? e.message : 'No se pudo aplicar.' });
    }
  }
  const sobran = p.operaciones.length - MAX_OPERACIONES_COPILOTO;
  return {
    items,
    explicacion: p.explicacion.trim().slice(0, 3000),
    dudas: [...p.dudas.map((x) => x.trim()).filter(Boolean).slice(0, 30), ...(sobran > 0 ? [`La propuesta traía ${sobran} operaciones más: pedilas en otro pedido.`] : [])],
  };
}
