/**
 * Casos de prueba (etapa 4, tarea 4.04): se cargan de a muchos como texto, un caso por renglón.
 *
 *   ¿Qué propone para la Caja?  |  propuesta  |  sobre_el_candidato       (mensaje | intención | otras válidas)
 *   ? ¿Dónde nació el candidato? |  si  |  En Ciudad de Panamá, en 1973.  (pregunta al material | si, no o parcial | qué tiene que decir)
 *
 * Los renglones vacíos y los que empiezan con # no cuentan. También sirve pegar dos columnas de una planilla
 * (separadas por tabulador).
 */
import type { Caso } from './definicion';

/** Omit sobre cada variante de la unión (el Omit común la aplana). */
type SinId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type CasoNuevo = SinId<Caso>;

export interface CasosLeidos {
  casos: CasoNuevo[];
  errores: { linea: number; mensaje: string }[];
}

export function leerCasos(texto: string, intenciones: ReadonlySet<string>): CasosLeidos {
  const casos: CasoNuevo[] = [];
  const errores: CasosLeidos['errores'] = [];
  texto.replace(/\r\n?/g, '\n').split('\n').forEach((linea, i) => {
    const t = linea.trim();
    if (!t || t.startsWith('#')) return;
    const partes = t.split(/\s*[|\t]\s*/).map((x) => x.trim());
    if (partes[0]!.startsWith('?')) {
      const pregunta = partes[0]!.replace(/^\?\s*/, '');
      const tiene = (partes[1] ?? 'si').toLowerCase().replace('í', 'i');
      if (!pregunta) return errores.push({ linea: i + 1, mensaje: 'Falta la pregunta.' });
      if (!['si', 'no', 'parcial'].includes(tiene)) return errores.push({ linea: i + 1, mensaje: `"${partes[1]}" no es si, no ni parcial.` });
      casos.push({ tipo: 'base', pregunta, tieneRespuesta: tiene as 'si', queDecir: partes.slice(2).join(' ') });
      return;
    }
    const [mensaje, intencion, otras] = partes;
    if (!intencion) return errores.push({ linea: i + 1, mensaje: 'Falta la intención esperada (mensaje | intención).' });
    const alternativas = (otras ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const desconocidas = [intencion, ...alternativas].filter((x) => !intenciones.has(x));
    if (desconocidas.length) return errores.push({ linea: i + 1, mensaje: `La intención ${desconocidas.join(', ')} no existe en el bot.` });
    casos.push({ tipo: 'intencion', mensaje: mensaje!, intencion, alternativas });
  });
  return { casos, errores };
}

/** Los casos como texto, en el mismo formato (para editarlos de golpe o descargarlos). */
export function casosComoTexto(casos: readonly Caso[]): string {
  return casos.map((c) => (c.tipo === 'intencion'
    ? [c.mensaje, c.intencion, c.alternativas.join(', ')].filter(Boolean).join(' | ')
    : [`? ${c.pregunta}`, c.tieneRespuesta, c.queDecir].filter(Boolean).join(' | '))).join('\n');
}

export const idDeCaso = (n: number) => `c${String(n).padStart(3, '0')}`;
