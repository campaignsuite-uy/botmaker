/**
 * Prueba de motores dentro del repositorio (tarea 2.15), con la capa de motores del producto.
 *
 *   pnpm motores:interpretar [--motores a+b,c] [--limite 20] [--paralelo 3] [--tiempo 2500] [--simular]
 *   pnpm motores:responder   [--motores a,b>c] [--juez claude-sonnet-5] [--sin-juez] [--limite 5] [--simular]
 *
 * Combinaciones: "a" solo, "a>b" con respaldo en serie, "a+b" en doble lectura (interpretar). Sin --motores, prueba
 * los motores por defecto. La clave es la de tareas de fondo (BOTS_OPENROUTER_API_KEY_FONDO, en apps/web/.env.local);
 * con --simular no llama a nadie. Deja resultados/<fecha>-<prueba>/resultados.xlsx y llamadas.jsonl.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carpetaResultados, cargarEntorno, faltaClave, leerOpciones, usd, validarSpecs } from './comun';
import { correrInterpretar, MOTORES_INTERPRETAR } from './interpretar';
import { escribirPlanilla } from './planilla';
import { correrResponder, MOTORES_RESPONDER } from './responder';

async function main() {
  const [comando, ...resto] = process.argv.slice(2);
  if (comando !== 'interpretar' && comando !== 'responder') {
    console.log('Uso: pnpm motores:interpretar | pnpm motores:responder  [--motores …] [--limite N] [--simular]');
    process.exit(1);
  }
  cargarEntorno();
  const o = leerOpciones(resto, { motores: comando === 'interpretar' ? MOTORES_INTERPRETAR : MOTORES_RESPONDER });
  const errores = validarSpecs(o.motores, comando, o.apagados);
  const clave = faltaClave(o);
  if (errores.length || clave) {
    for (const e of [...errores, ...(clave ? [clave] : [])]) console.log(`✗ ${e}`);
    process.exit(1);
  }
  console.log(`\nPrueba de ${comando} · ${o.motores.join(', ')}${o.simular ? ' · motor simulado' : ''}${o.limite ? ` · primeros ${o.limite}` : ''}\n`);
  const dir = carpetaResultados(comando);
  if (comando === 'interpretar') {
    const r = await correrInterpretar(o);
    await escribirPlanilla(join(dir, 'resultados.xlsx'), [
      { nombre: 'Resumen', filas: r.resumen },
      { nombre: 'Mensajes', filas: r.filas },
      { nombre: 'Llamadas', filas: r.llamadas },
    ]);
    writeFileSync(join(dir, 'llamadas.jsonl'), r.llamadas.map((l) => JSON.stringify(l)).join('\n'));
    console.log('\nCombinación · acierto · acierto cuando coinciden · aclaración · p50 · costo');
    for (const x of r.resumen) console.log(`  ${x.combinacion} · ${x.acierto ?? '-'} % · ${x.aciertoCuandoCoinciden ?? '-'} % · ${x.aclaracion ?? '-'} % · ${x.demoraP50 ?? '-'} ms · ${usd(x.costoUsd)}`);
  } else {
    const r = await correrResponder(o, !resto.includes('--sin-juez'));
    await escribirPlanilla(join(dir, 'resultados.xlsx'), [
      { nombre: 'Resumen', filas: r.resumen },
      { nombre: 'Respuestas', filas: r.filas },
      { nombre: 'Llamadas', filas: r.llamadas },
    ]);
    writeFileSync(join(dir, 'llamadas.jsonl'), r.llamadas.map((l) => JSON.stringify(l)).join('\n'));
    console.log(`\nCombinación · exactitud (0 a 2) · exactas · inventa · cortadas · sin respuesta del motor · costo${r.juez && !o.simular && !resto.includes('--sin-juez') ? ` (juez: ${r.juez})` : ' (sin juez)'}`);
    for (const x of r.resumen) console.log(`  ${x.combinacion} · ${x.exactitudPromedio ?? '-'} · ${x.exactas ?? '-'} % · ${x.inventa ?? '-'} % · ${x.cortadasPorElValidador ?? '-'} % · ${x.sinRespuestaDelMotor} · ${usd(x.costoUsd + x.costoJuezUsd)}`);
  }
  console.log(`\nResultados en ${dir}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
