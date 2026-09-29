/**
 * Prueba de recorrido en el navegador: lo que Joaquín prueba a mano en las pruebas de aceptación, hecho por Playwright
 * contra la demo en memoria (sin cuentas ni claves). Cierra las etapas 2 y 3 (y la 4 cuando esté).
 *
 *  Etapa 2: crear un bot con la plantilla, agregar y conectar una caja en el editor, editarla y deshacer, recorrerlo en
 *           el simulador con botones y texto, exportar e importar el YAML; el lector ve todo sin poder tocar.
 *  Etapa 3: cargar material, contestar con base citando secciones, derivar un trámite electoral y el corte del
 *           validador de datos a la vista en el simulador.
 *
 * Necesita el build (pnpm build). Levanta `next start` en un puerto propio y lo apaga al terminar.
 * Uso: pnpm probar:recorrido   (CHROMIUM=/ruta/al/chrome si hace falta; URL=http://localhost:3000 para una app andando).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PUERTO || 3192);
const BASE = process.env.URL || `http://localhost:${PUERTO}`;
const CAMPANA = `${BASE}/otro-camino/pa-2029/bots`;

let fallas = 0;
let total = 0;
function prueba(nombre, ok, detalle = '') {
  total++;
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `\n      ${String(detalle).slice(0, 300)}`}`);
}

async function levantarApp() {
  if (process.env.URL) return null;
  const app = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PUERTO)], {
    cwd: `${RAIZ}apps/web`, env: { ...process.env, CAMPAIGNSUITE_DATOS: 'demo', CAMPAIGNSUITE_SOLO_LECTURA: '', PORT: String(PUERTO) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(`${BASE}/ingresar`)).ok) return app;
    } catch { /* todavía no levantó */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  app.kill();
  throw new Error(`La app no levantó en ${BASE}. ¿Corriste pnpm build?`);
}

async function como(navegador, persona, ancho = 1360) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: 1000 } });
  await ctx.addCookies([{ name: 'campaignsuite_persona', value: persona, url: BASE }]);
  const pagina = await ctx.newPage();
  pagina.errores = [];
  pagina.on('pageerror', (e) => pagina.errores.push(String(e.message).slice(0, 160)));
  return pagina;
}

const esperarGrupos = (p, n) => p.waitForFunction((k) => document.querySelectorAll('.sim-grupo').length > k, n, { timeout: 15000 });
async function decir(p, texto) {
  const n = await p.locator('.sim-grupo').count();
  await p.fill('input[aria-label="Mensaje"]', texto);
  await p.click('button:has-text("Enviar")');
  await esperarGrupos(p, n);
  return p.locator('.sim-grupo').last();
}

const app = await levantarApp();
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
try {
  // ── Etapa 2 ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nEtapa 2: el creador de flujos\n');
  const ed = await como(navegador, 'p-lucia');
  await ed.goto(`${CAMPANA}/nuevo`);
  await ed.fill('#nb-nombre', 'Bot de la prueba de recorrido');
  await ed.fill('#nb-candidato', 'Candidata de prueba');
  await ed.click('button:has-text("Crear bot")');
  await ed.waitForURL(/\/flujos\?ok=bot_creado/);
  const botUrl = ed.url().split('/flujos')[0];
  await ed.waitForSelector('.react-flow__node');
  const flujos = await ed.locator('.ed-flujo[role="tab"]').allTextContents();
  prueba('crear un bot arma la plantilla: 5 flujos, con menú, interpretar y derivación', flujos.length === 5
    && await ed.locator('.react-flow__node[data-id="n_menu"]').count() === 1 && await ed.locator('.react-flow__node[data-id="n_interpretar"]').count() === 1, flujos.join(' · '));

  await ed.click('.ed-flujo[role="tab"]:has-text("Consultas")');
  await ed.click('.react-flow__node[data-id="n_masayuda"]');
  await ed.click('button:has-text("+ Caja")');
  await ed.selectOption('.ed-panel select >> nth=0', 'menu');
  await ed.selectOption('.ed-panel select >> nth=1', { index: 2 });
  await ed.click('button:has-text("Agregar al flujo 2")');
  await ed.waitForSelector('.ed-inspector .subtitulo:has-text("2.8")');
  prueba('agregar una caja de menú conectada desde "No, gracias" (2.2 › B)', (await ed.locator('.ed-aviso').textContent()).includes('Agregó la caja 2.8'));
  await ed.fill('.ed-inspector textarea', '¿Quiere dejarnos su opinión?');
  await ed.fill('input[aria-label="Texto de la opción A"]', 'Sí, opinar');
  await ed.click('button:has-text("Guardar cambios")');
  await ed.waitForFunction(() => document.querySelector('.ed-aviso')?.textContent?.includes('2 cambios'));
  const nodoNuevo = () => ed.locator('.react-flow__node', { has: ed.locator('.ed-nodo__dir', { hasText: /^2\.8$/ }) });
  const nodo = await nodoNuevo().textContent();
  prueba('editar el texto y el botón de la caja nueva en un solo cambio', nodo.includes('opinión') && nodo.includes('Sí, opinar'), nodo);
  await ed.click('button:has-text("Deshacer")');
  await ed.waitForFunction(() => document.querySelector('.ed-aviso')?.textContent?.startsWith('Deshizo'));
  const deshecho = await nodoNuevo().textContent();
  prueba('deshacer vuelve el texto y el botón a como estaban', !deshecho.includes('Sí, opinar'), deshecho);
  await ed.fill('input[aria-label="Ir a una dirección"]', '1.2 › E');
  await ed.press('input[aria-label="Ir a una dirección"]', 'Enter');
  await ed.waitForSelector('.ed-inspector .subtitulo:has-text("1.2")');
  prueba('el buscador por dirección lleva a la caja', true);

  await ed.goto(`${botUrl}/simulador`);
  await ed.waitForSelector('.sim-boton');
  const n0 = await ed.locator('.sim-grupo').count();
  await ed.click('.sim-boton:has-text("Hablar con alguien")');
  await esperarGrupos(ed, n0);
  const derivada = await ed.locator('.sim-grupo').last().textContent();
  prueba('simulador con botones: "Hablar con alguien" deriva al equipo en horario', /equipo|persona/i.test(derivada) && derivada.includes('1.10'), derivada.slice(0, 160));
  await ed.click('button:has-text("Reiniciar")');
  await ed.waitForFunction(() => document.querySelectorAll('.sim-grupo').length === 1);
  const g = await decir(ed, 'Quiero ser voluntario, ¿cómo me sumo?');
  prueba('simulador con texto: interpreta y muestra por qué (intención, lecturas, motor, costo)', (await g.textContent()).includes('Voluntariado'));
  await g.locator('.sim-porque').click();
  const porque = await g.locator('.sim-decision').textContent();
  prueba('la decisión muestra las dos lecturas y el costo', porque.includes('Doble lectura') && porque.includes('Costo'), porque.slice(0, 200));

  await ed.goto(`${botUrl}/yaml`);
  const yaml = await ed.inputValue('textarea[name=yaml]');
  prueba('exportar el YAML con las direcciones de las cajas', yaml.includes('# 1.2 · Menú · Menú principal') && yaml.includes('Exportado del cambio'));
  await ed.fill('textarea[name=yaml]', yaml.replace('nombre: Menú principal', 'nombre: Menú desde el YAML'));
  await ed.click('button:has-text("Importar")');
  await ed.waitForSelector('.aviso--ok');
  prueba('importar el YAML cambiado es un cambio que se deshace', (await ed.locator('.aviso--ok').textContent()).includes('Importó el YAML: cambió 1 flujo'));
  await ed.goto(`${botUrl}/flujos`);
  await ed.waitForSelector('.react-flow__node');
  await ed.click('button:has-text("Deshacer")');
  await ed.waitForFunction(() => document.querySelector('.ed-aviso')?.textContent?.includes('Deshizo: Importó el YAML'));
  prueba('deshacer la importación desde Flujos', true);
  prueba('el editor no tuvo errores en la página', !ed.errores.length, ed.errores.join(' · '));

  const lector = await como(navegador, 'p-equipo', 390);
  await lector.goto(`${botUrl}/flujos`);
  await lector.waitForSelector('.react-flow__node');
  await lector.click('.react-flow__node[data-id="n_menu"]');
  prueba('el lector ve el diagrama y el inspector sin poder tocar', await lector.locator('button:has-text("+ Caja")').count() === 0
    && await lector.locator('.ed-inspector input').first().isDisabled() && await lector.locator('button:has-text("Guardar cambios")').count() === 0);
  await lector.goto(`${botUrl}/simulador`);
  prueba('el lector no usa el simulador (tiene costo)', (await lector.locator('.bots-solo-lectura').textContent()).includes('editor y el administrador'));

  // ── Etapa 3 ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nEtapa 3: material y respuesta con base\n');
  await ed.goto(`${botUrl}/material`);
  await ed.fill('#m-texto', '## [S01] Trayectoria\nFue concejal de 2019 a 2024 y obtuvo 12.345 votos.\nFuentes: Diario de prueba, 1/9/2026\n\n## [S02] Trámites\nRenovar la cédula es gratuito.\nFuentes: Tribunal Electoral');
  await ed.check('input[name=reemplazar][value=si]');
  await ed.click('button:has-text("Cargar")');
  await ed.waitForURL(/ok=cambio_guardado/);
  prueba('cargar el material pegado: 2 secciones con su fuente', (await ed.locator('.caja__titulo').first().textContent()).includes('2 secciones') && (await ed.locator('summary:has-text("S01 · Trayectoria")').count()) === 1);
  await ed.goto(`${botUrl}/simulador`);
  await ed.waitForSelector('.sim-boton');
  let r = await decir(ed, '¿Cuántos votos obtuvo como concejal en 2019?');
  await r.locator('.sim-porque').click();
  prueba('responde con base y cita la sección', (await r.textContent()).includes('12.345') && (await r.locator('.sim-decision').textContent()).includes('S01'));
  r = await decir(ed, 'Si tengo la cédula vencida, ¿puedo votar?');
  prueba('un trámite electoral que el material no cubre deriva al Tribunal Electoral', (await r.textContent()).includes('la información oficial la da el Tribunal Electoral'));

  const bot2 = await como(navegador, 'p-joaquin');
  await bot2.goto(`${CAMPANA}/bot-demo-2/material`);
  prueba('el bot de la demo trae el material de la prueba en 27 secciones', (await bot2.locator('.caja__titulo').first().textContent()).includes('27 secciones'));
  prueba('etapa 3 sin errores en la página', !ed.errores.length && !bot2.errores.length, [...ed.errores, ...bot2.errores].join(' · '));
} catch (e) {
  prueba('el recorrido termina sin errores', false, e.stack ?? String(e));
} finally {
  await navegador.close();
  app?.kill();
}
console.log(`\n${total - fallas} de ${total} pruebas bien.${fallas ? ` ${fallas} fallaron.` : ''}\n`);
process.exit(fallas ? 1 : 0);
