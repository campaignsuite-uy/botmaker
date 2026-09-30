/**
 * Un efecto de React (useEffect, useLayoutEffect) solo puede devolver una función de limpieza. Con una flecha sin llaves
 * devuelve lo que devuelva la llamada: en Chrome 153 scrollIntoView devuelve una promesa y React la llamaba como
 * limpieza, con lo que el simulador se caía («i is not a function»). TypeScript no lo ve (para él devuelve void), así
 * que se controla acá sobre el código de las pantallas.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('efectos de React', () => {
  it('ninguno devuelve algo que no sea una función de limpieza (flecha sin llaves)', () => {
    const malos: string[] = [];
    for (const a of archivos(RAIZ)) {
      readFileSync(a, 'utf8').split('\n').forEach((linea, i) => {
        if (/\buse(Layout|Insertion)?Effect\(\s*(async\s*)?\(\)\s*=>\s*[^\s{]/.test(linea)) malos.push(`${a.slice(RAIZ.length)}:${i + 1}`);
      });
    }
    expect(malos).toEqual([]);
  });
});
