/**
 * Arma los dos archivos para el SQL Editor del proyecto de Supabase de desarrollo (packages/db/salida/, que no se sube):
 *  1-estructura.sql: el núcleo de desarrollo y las migraciones de BotMaker, en orden. Se corre una vez (y de nuevo solo
 *                    con un proyecto vacío). Cuando haya una migración nueva, se corre solo esa.
 *  2-semilla.sql:    la organización, la campaña y el equipo de prueba, con los correos puestos. Se puede correr de nuevo.
 *  3-semilla-demo.sql (con --demo): los bots de ejemplo de la demo, con conversaciones, analítica y costos inventados,
 *                    sobre la campaña de 2-semilla.sql. Se puede correr de nuevo (los vuelve a cargar con las horas a hoy).
 *
 * Uso: pnpm db:sql --dueno tu@correo.com [--editor otro@correo.com] [--agente …] [--lector …] [--demo]
 * Los correos no son claves: son los de las cuentas de Google con que se ingresa a la app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { archivosMigracion, DIR_CORE_DEV } from './supabase-simulado.ts';
import { sqlSemillaDemo } from './semilla-demo.ts';

const args = process.argv.slice(2);
const arg = (nombre: string) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? (args[i + 1] ?? '').trim().toLowerCase() : '';
};
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const correos = { DUENO: arg('dueno'), EDITOR: arg('editor'), AGENTE: arg('agente'), LECTOR: arg('lector') };
for (const [k, v] of Object.entries(correos)) {
  if (v && !CORREO.test(v)) {
    console.error(`El correo de --${k.toLowerCase()} no parece un correo: ${v}`);
    process.exit(1);
  }
}

const salida = new URL('../salida/', import.meta.url).pathname;
mkdirSync(salida, { recursive: true });

const archivos = archivosMigracion();
const estructura = [
  '-- BotMaker · estructura para el proyecto de Supabase de desarrollo. Generado por `pnpm db:sql`.',
  `-- Incluye, en orden: ${archivos.map((a) => basename(a)).join(', ')}.`,
  '-- Cada archivo va entero entre begin y commit: si uno falla, no queda a medias.',
  '',
  ...archivos.map((a) => `-- ═══ ${basename(a)} ═══\n${readFileSync(a, 'utf8')}`),
].join('\n');
writeFileSync(join(salida, '1-estructura.sql'), estructura);

let semilla = readFileSync(join(DIR_CORE_DEV, 'semilla-desarrollo.sql'), 'utf8');
for (const [k, v] of Object.entries(correos)) semilla = semilla.replace(`{{${k}}}`, v);
writeFileSync(join(salida, '2-semilla.sql'), semilla);

const conDemo = args.includes('--demo');
if (conDemo) writeFileSync(join(salida, '3-semilla-demo.sql'), sqlSemillaDemo({ ahora: new Date() }));

console.log(`Listo, en packages/db/salida/:
  1-estructura.sql  (${archivos.length} archivos)
  2-semilla.sql     ${correos.DUENO ? `(Dueño: ${correos.DUENO})` : '(falta el correo del Dueño: completalo en el archivo o volvé a correr con --dueno)'}${conDemo ? '\n  3-semilla-demo.sql (los bots de ejemplo: después de 2-semilla.sql)' : ''}`);
