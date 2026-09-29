/**
 * El material del bot (etapa 3, tarea 3.01): lo que el bot puede usar para contestar, dividido en secciones con
 * título, texto, fuente, fecha y temas. Se pega o se sube como texto con títulos de segundo nivel:
 *
 *   ## [S01] Quién es el candidato        (el código entre corchetes es opcional: si no está, se asigna)
 *   Texto de la sección…
 *   Temas: salud, educacion               (opcional: ids de temas del bot)
 *   Fecha: 2026-09-28                      (opcional)
 *   Fuentes: La Prensa, 28/04/2024.        (opcional; también "Fuente:")
 *
 * Lo que está antes del primer título (la presentación del documento) no es una sección.
 */
import { LIMITES, RE_CODIGO_SECCION, type Seccion } from './definicion';

export interface SeccionLeida {
  codigo: string | null;
  titulo: string;
  texto: string;
  fuente: string;
  fecha: string;
  temas: string[];
}

export interface ResultadoMaterial {
  secciones: SeccionLeida[];
  avisos: string[];
}

const RE_TITULO = /^##\s+(?:\[(S\d{2,3})\]\s*)?(.+?)\s*$/;
const RE_META = /^(fuentes?|fecha|temas?)\s*:\s*(.*)$/i;

export function dividirMaterial(texto: string): ResultadoMaterial {
  const avisos: string[] = [];
  const secciones: SeccionLeida[] = [];
  let actual: SeccionLeida | null = null;
  let cuerpo: string[] = [];
  const cerrar = () => {
    if (!actual) return;
    actual.texto = cuerpo.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!actual.texto) avisos.push(`La sección "${actual.titulo}" no tiene texto: no se cargó.`);
    else if (actual.texto.length > LIMITES.textoSeccion) avisos.push(`La sección "${actual.titulo}" tiene más de ${LIMITES.textoSeccion} caracteres: conviene partirla.`);
    else secciones.push(actual);
  };
  for (const linea of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const t = linea.match(RE_TITULO);
    if (t && !linea.startsWith('###')) {
      cerrar();
      actual = { codigo: t[1] ? t[1].toUpperCase() : null, titulo: t[2]!.slice(0, 120), texto: '', fuente: '', fecha: '', temas: [] };
      cuerpo = [];
      continue;
    }
    if (!actual) continue;
    const m = linea.trim().match(RE_META);
    if (m) {
      const clave = m[1]!.toLowerCase();
      const valor = m[2]!.trim();
      if (clave.startsWith('fuente')) actual.fuente = [actual.fuente, valor].filter(Boolean).join(' ').slice(0, 600);
      else if (clave === 'fecha') actual.fecha = valor.slice(0, 40);
      else actual.temas = valor.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      continue;
    }
    cuerpo.push(linea);
  }
  cerrar();
  if (!secciones.length) avisos.push('No se encontró ninguna sección: cada una empieza con un título de segundo nivel ("## Título").');
  return { secciones, avisos };
}

/**
 * Pone códigos a las secciones leídas sin reusar ninguno: respeta el que traen si está libre; si no, el siguiente al
 * último asignado. Devuelve las secciones y el último número.
 */
export function asignarCodigos(leidas: SeccionLeida[], usados: Set<string>, ultima: number): { secciones: Seccion[]; ultima: number } {
  const ocupados = new Set(usados);
  let n = ultima;
  const secciones = leidas.map((l) => {
    let codigo = l.codigo && RE_CODIGO_SECCION.test(l.codigo) && !ocupados.has(l.codigo) ? l.codigo : null;
    if (!codigo) {
      do codigo = `S${String(++n).padStart(2, '0')}`;
      while (ocupados.has(codigo));
    }
    ocupados.add(codigo);
    n = Math.max(n, Number(codigo.slice(1)));
    return { codigo, titulo: l.titulo, texto: l.texto, fuente: l.fuente, fecha: l.fecha, temas: l.temas };
  });
  return { secciones, ultima: n };
}

/** El material como texto, en el mismo formato que se carga (para exportarlo o editarlo de golpe). */
export function materialComoTexto(secciones: readonly Seccion[]): string {
  return secciones.map((s) => [
    `## [${s.codigo}] ${s.titulo}`, '', s.texto, '',
    ...(s.temas.length ? [`Temas: ${s.temas.join(', ')}`] : []),
    ...(s.fecha ? [`Fecha: ${s.fecha}`] : []),
    ...(s.fuente ? [`Fuentes: ${s.fuente}`] : []),
  ].join('\n').trim()).join('\n\n');
}

/** Tokens aproximados (4 caracteres por token): para avisar el costo del material en cada respuesta. */
export function tokensAproximados(secciones: readonly Pick<Seccion, 'titulo' | 'texto'>[]): number {
  return Math.round(secciones.reduce((a, s) => a + s.titulo.length + s.texto.length + 12, 0) / 4);
}
