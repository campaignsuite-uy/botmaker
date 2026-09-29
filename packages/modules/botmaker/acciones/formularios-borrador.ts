/**
 * Formularios de las pantallas del borrador que no son el diagrama (Contenidos, Intenciones y temas, Variables y
 * datos): cada formulario dice qué es (`forma`) y sus campos se convierten en operaciones. Sin Next: se prueba sin
 * navegador. Lo que no se puede convertir vuelve con un código de error de vistas/mensajes.ts.
 */
import { RE_ID_CATALOGO, RE_VARIABLE, type Definicion } from '../dominio/definicion';
import { texto } from './comun';

export type ResultadoForma = { ops: Record<string, unknown>[] } | { codigo: string };

const lineas = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
const lista = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
const nulo = (t: string) => (t ? t : null);

/** "Voto en el exterior" → "voto_en_el_exterior" (el id de una intención o un tema nuevo si no se escribe uno). */
export function idDeNombre(nombre: string): string {
  const id = nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return /^[a-z]/.test(id) ? id : `x_${id}`.slice(0, 40);
}

function archivo(fd: FormData): Record<string, unknown> {
  const tipo = texto(fd, 'tipo') || 'texto';
  if (tipo === 'texto') return { tipo };
  const url = texto(fd, 'archivoUrl');
  return { tipo, ...(url ? { archivo: { url, nombre: texto(fd, 'archivoNombre') || url.split('/').pop() || 'archivo' } } : {}) };
}

function canal(fd: FormData, prefijo: string): { canal: string; valor: string } | null {
  const c = texto(fd, `${prefijo}Canal`);
  const v = texto(fd, `${prefijo}Valor`);
  return c && v ? { canal: c, valor: v } : null;
}

export function operacionesDeForma(fd: FormData, def: Definicion): ResultadoForma {
  const forma = texto(fd, 'forma');
  switch (forma) {
    case 'contenido_agregar': {
      const nombre = texto(fd, 'nombre');
      if (!nombre) return { codigo: 'nombre_vacio' };
      return { ops: [{ tipo: 'agregar_contenido', contenido: { nombre, texto: String(fd.get('texto') ?? '').trim(), ...archivo(fd) } }] };
    }
    case 'contenido_editar': {
      const cambios: Record<string, unknown> = { nombre: texto(fd, 'nombre'), texto: String(fd.get('texto') ?? '').trim() };
      const a = archivo(fd);
      if (a.tipo !== 'texto' || fd.has('tipo')) Object.assign(cambios, a);
      return { ops: [{ tipo: 'editar_contenido', contenido: texto(fd, 'contenido'), cambios }] };
    }
    case 'contenido_quitar':
      return { ops: [{ tipo: 'quitar_contenido', contenido: texto(fd, 'contenido') }] };

    case 'intencion_agregar': {
      const nombre = texto(fd, 'nombre');
      if (!nombre) return { codigo: 'nombre_vacio' };
      const id = texto(fd, 'id') || idDeNombre(nombre);
      if (!RE_ID_CATALOGO.test(id)) return { codigo: 'id_invalido' };
      if (def.intenciones.some((i) => i.id === id)) return { codigo: 'id_repetido' };
      return {
        ops: [{
          tipo: 'agregar_intencion',
          intencion: { id, nombre, descripcion: texto(fd, 'descripcion') || nombre, limite: texto(fd, 'limite'), frases: lineas(String(fd.get('frases') ?? '')), destino: nulo(texto(fd, 'destino')), tema: nulo(texto(fd, 'tema')) },
        }],
      };
    }
    case 'intencion_editar':
      return {
        ops: [{
          tipo: 'editar_intencion', intencion: texto(fd, 'intencion'),
          cambios: { nombre: texto(fd, 'nombre'), descripcion: texto(fd, 'descripcion'), limite: texto(fd, 'limite'), frases: lineas(String(fd.get('frases') ?? '')), destino: nulo(texto(fd, 'destino')), tema: nulo(texto(fd, 'tema')) },
        }],
      };
    case 'intencion_quitar':
      return { ops: [{ tipo: 'quitar_intencion', intencion: texto(fd, 'intencion') }] };

    case 'tema_agregar': {
      const nombre = texto(fd, 'nombre');
      if (!nombre) return { codigo: 'nombre_vacio' };
      const id = texto(fd, 'id') || idDeNombre(nombre);
      if (!RE_ID_CATALOGO.test(id)) return { codigo: 'id_invalido' };
      if (def.temas.some((t) => t.id === id)) return { codigo: 'id_repetido' };
      return { ops: [{ tipo: 'agregar_tema', tema: { id, nombre, descripcion: texto(fd, 'descripcion') } }] };
    }
    case 'tema_editar':
      return { ops: [{ tipo: 'editar_tema', tema: texto(fd, 'tema'), cambios: { nombre: texto(fd, 'nombre'), descripcion: texto(fd, 'descripcion') } }] };
    case 'tema_quitar':
      return { ops: [{ tipo: 'quitar_tema', tema: texto(fd, 'tema') }] };

    case 'variable_agregar': {
      const ambito = texto(fd, 'ambito') === 'contacto' ? 'contacto' : 'bot';
      const nombre = `${ambito}.${idDeNombre(texto(fd, 'nombre')).slice(0, 30)}`;
      if (!RE_VARIABLE.test(nombre)) return { codigo: 'variable_invalida' };
      if (def.variables.some((v) => v.nombre === nombre)) return { codigo: 'id_repetido' };
      return { ops: [{ tipo: 'agregar_variable', variable: { nombre, descripcion: texto(fd, 'descripcion'), ...(ambito === 'bot' ? { valor: texto(fd, 'valor') } : {}) } }] };
    }
    case 'variable_editar': {
      const nombre = texto(fd, 'variable');
      return { ops: [{ tipo: 'editar_variable', variable: nombre, cambios: { descripcion: texto(fd, 'descripcion'), ...(nombre.startsWith('bot.') ? { valor: texto(fd, 'valor') } : {}) } }] };
    }
    case 'variable_quitar':
      return { ops: [{ tipo: 'quitar_variable', variable: texto(fd, 'variable') }] };

    case 'identidad': {
      const partido = texto(fd, 'partido');
      const ops: Record<string, unknown>[] = [{
        tipo: 'editar_identidad',
        candidato: { nombre: texto(fd, 'candidato'), alias: lista(texto(fd, 'candidatoAlias')) },
        partido: partido ? { nombre: partido, alias: lista(texto(fd, 'partidoAlias')) } : null,
      }];
      // Las variables del bot con el nombre del candidato y del partido siguen a la identidad.
      for (const [v, valor] of [['bot.candidato', texto(fd, 'candidato')], ['bot.partido', partido]] as const) {
        const actual = def.variables.find((x) => x.nombre === v);
        if (actual && (actual.valor ?? '') !== valor) ops.push({ tipo: 'editar_variable', variable: v, cambios: { valor } });
      }
      return { ops };
    }
    case 'contacto':
      return { ops: [{ tipo: 'editar_contacto', consultas: canal(fd, 'consultas'), aportes: canal(fd, 'aportes') }] };
    case 'sistema': {
      const ops = (['noEntendi', 'aclaracion', 'cierre', 'sinMotor'] as const)
        .filter((k) => texto(fd, k) && texto(fd, k) !== def.sistema[k])
        .map((k) => ({ tipo: 'editar_sistema', clave: k, contenido: texto(fd, k) }));
      return ops.length ? { ops } : { codigo: 'sin_cambios' };
    }
    default:
      return { codigo: 'datos' };
  }
}
