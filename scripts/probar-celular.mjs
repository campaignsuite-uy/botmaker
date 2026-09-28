/**
 * Prueba de uso en el celular. Copia de la de CampaignSuite (scripts/probar-celular.mjs, ef6a364) con las personas de
 * la demo de BotMaker.
 *
 * Recorre todas las pantallas a las que llega cada persona de la demo en memoria (siguiendo los enlaces, así cada rol
 * ve su propio menú) a 360 px de ancho (Android chico), y con el Administrador también a 390 px (iPhone). Comprueba que:
 *  - la página responde y no se desplaza a lo ancho: lo ancho (las tablas) se desplaza dentro de su caja (salvo los
 *    informes para imprimir, hojas A4 pensadas para la computadora);
 *  - la barra de arriba no se parte en dos renglones y "Salir" queda a la vista;
 *  - en el módulo el menú lateral no se ve, y el botón "Menú" abre un panel dentro de la pantalla con las secciones;
 *  - la página no tira errores (por ejemplo, una hidratación de React que no coincide).
 *
 * Necesita el build de la app (pnpm build). Levanta `next start` con los datos de la demo en memoria en un puerto
 * propio y lo apaga al terminar. No usa ninguna clave ni la base.
 *
 * Uso: pnpm probar:celular
 *   CHROMIUM=/ruta/al/chrome  si el navegador de Playwright no está instalado (se instala con
 *                             `pnpm exec playwright install chromium`).
 *   URL=http://localhost:3000 para probar contra una app que ya está andando (no levanta ninguna).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PUERTO || 3190);
const BASE = process.env.URL || `http://localhost:${PUERTO}`;
// Cada persona a 360 px (lo más angosto); el Administrador, que llega a todas las pantallas, también a 390.
const PERSONAS = ['p-joaquin', 'p-lucia', 'p-andres', 'p-equipo', 'p-mariana'];
const RECORRIDOS = [[390, 'p-joaquin'], ...PERSONAS.map((p) => [360, p])];
const MAX_PAGINAS = 90;
// Rutas que no son pantallas (descargas, salir, callbacks) o que cambian algo al abrirlas.
const NO_SEGUIR = [/^\/salir/, /^\/auth\//, /^\/descargas\//, /^\/fichas\//, /\/seguir$/];
// Los informes para imprimir (hojas A4) siguen pensados para la computadora (definición, §15): se abren, pero su
// ancho no se controla.
const SIN_CONTROL_DE_ANCHO = [/^\/imprimir\//];

const fallas = [];
const falla = (ancho, persona, url, que) => fallas.push(`${ancho}px · ${persona} · ${url.replace(BASE, '')}: ${que}`);

async function levantarApp() {
  if (process.env.URL) return null;
  const app = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PUERTO)], {
    cwd: `${RAIZ}apps/web`,
    env: { ...process.env, CAMPAIGNSUITE_DATOS: 'demo', CAMPAIGNSUITE_SOLO_LECTURA: '', PORT: String(PUERTO) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  app.stdout.on('data', (d) => { salida += d; });
  app.stderr.on('data', (d) => { salida += d; });
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`${BASE}/ingresar`);
      if (r.ok) return app;
    } catch { /* todavía no levantó */ }
    if (app.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  app.kill();
  throw new Error(`La app no levantó en ${BASE}. ¿Corriste pnpm build?\n${salida.slice(-2000)}`);
}

/** Lo que se mide en cada pantalla, dentro del navegador. */
function medir() {
  const W = document.documentElement.clientWidth;
  const r = { W, ancho: document.documentElement.scrollWidth, culpables: [], barra: null, salir: null, marco: false, menuLateral: null, boton: null };
  if (r.ancho > W + 1) {
    // Los elementos que se salen de la pantalla sin estar dentro de algo que se desplace.
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.right <= W + 1 || b.width === 0) continue;
      const padre = el.parentElement.getBoundingClientRect();
      if (padre.right > W + 1) continue;
      r.culpables.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} «${(el.textContent || '').trim().slice(0, 40)}»`);
      if (r.culpables.length >= 3) break;
    }
  }
  const barra = document.querySelector('.barra-sup, .plataforma__barra, .impresion__barra');
  if (barra) r.barra = { alto: Math.round(barra.getBoundingClientRect().height), clase: barra.className };
  const salir = document.querySelector('.barra-sup a[href="/salir"], .plataforma__barra a[href="/salir"]');
  if (salir) { const b = salir.getBoundingClientRect(); r.salir = b.width > 0 && b.left >= 0 && b.right <= W + 1; }
  r.marco = !!document.querySelector('.marco');
  const menu = document.querySelector('.menu');
  if (menu) r.menuLateral = getComputedStyle(menu).display !== 'none';
  const boton = document.querySelector('.menu-movil__boton');
  if (boton) { const b = boton.getBoundingClientRect(); r.boton = b.width > 0 && b.left >= 0 && b.right <= W + 1; }
  r.enlaces = [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href'));
  return r;
}

async function probarMenu(pagina, ancho, persona, url) {
  await pagina.click('.menu-movil__boton');
  const panel = await pagina.evaluate(() => {
    const p = document.querySelector('.menu-movil__panel');
    if (!p) return null;
    const b = p.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    const H = window.innerHeight;
    const items = [...p.querySelectorAll('.menu__item[data-seccion]')].filter((a) => a.getBoundingClientRect().height > 0);
    const lateral = document.querySelector('.menu .menu__item[data-seccion]') ? document.querySelectorAll('.menu .menu__item[data-seccion]').length : 0;
    const activa = !!p.querySelector('.menu__item[aria-current="page"]');
    return { dentro: b.left >= 0 && b.right <= W + 1 && b.top >= 0 && b.height > 100 && b.top < H, items: items.length, lateral, activa, alto: Math.round(b.height), H };
  });
  if (!panel) return falla(ancho, persona, url, 'el botón "Menú" no abre ningún panel');
  if (!panel.dentro) falla(ancho, persona, url, `el panel del menú no queda dentro de la pantalla (alto ${panel.alto})`);
  if (panel.items === 0 || panel.items !== panel.lateral) falla(ancho, persona, url, `el menú del celular tiene ${panel.items} secciones y el lateral ${panel.lateral}`);
  await pagina.click('.menu-movil__boton');
  const cerrado = await pagina.evaluate(() => !document.querySelector('.menu-movil')?.hasAttribute('open'));
  if (!cerrado) falla(ancho, persona, url, 'el menú no se cierra con el mismo botón');
}

const app = await levantarApp();
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
// Nota: con CHROMIUM se usa un Chrome ya instalado (por ejemplo, /opt/pw-browsers/chromium).
let paginas = 0;
try {
  for (const [ancho, persona] of RECORRIDOS) {
    {
      const contexto = await navegador.newContext({
        viewport: { width: ancho, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      });
      await contexto.addCookies([{ name: 'campaignsuite_persona', value: persona, url: BASE }]);
      const pagina = await contexto.newPage();
      // Errores de la página (por ejemplo, una hidratación que no coincide: React vuelve a dibujar todo y los scripts
      // en línea pierden lo que habían enganchado).
      const errores = [];
      pagina.on('pageerror', (e) => errores.push(String(e.message).slice(0, 120)));
      const vistas = new Set();
      const porRuta = new Map();
      const cola = ['/', '/ingresar'];
      while (cola.length && vistas.size < MAX_PAGINAS) {
        const ruta = cola.shift();
        if (vistas.has(ruta)) continue;
        vistas.add(ruta);
        const url = BASE + ruta;
        errores.length = 0;
        const resp = await pagina.goto(url, { waitUntil: 'load' }).catch((e) => ({ ok: () => false, status: () => String(e.message).slice(0, 80) }));
        if (!resp || !resp.ok()) { falla(ancho, persona, url, `respondió ${resp?.status()}`); continue; }
        paginas++;
        const m = await pagina.evaluate(medir);
        if (m.ancho > m.W + 1 && !SIN_CONTROL_DE_ANCHO.some((re) => re.test(ruta))) falla(ancho, persona, url, `la página mide ${m.ancho} px de ancho (pantalla: ${m.W}) · ${m.culpables.join(' · ')}`);
        if (m.barra && m.barra.alto > 57 && !m.barra.clase.includes('impresion__barra')) falla(ancho, persona, url, `la barra de arriba mide ${m.barra.alto} px de alto (se partió en dos renglones)`);
        if (m.salir === false) falla(ancho, persona, url, '"Salir" queda fuera de la pantalla');
        if (m.marco) {
          if (m.menuLateral) falla(ancho, persona, url, 'el menú lateral se ve en el celular');
          if (!m.boton) falla(ancho, persona, url, 'no está el botón "Menú" (o queda fuera de la pantalla)');
          else await probarMenu(pagina, ancho, persona, url);
        }
        // La hidratación termina poco después de "load": se le da un momento antes de mirar los errores.
        await pagina.waitForTimeout(80);
        if (errores.length) falla(ancho, persona, url, `error en la página: ${errores.join(' · ')}`);
        // Siguientes pantallas: los enlaces internos. De una misma ruta con distintos parámetros, hasta tres.
        for (const h of m.enlaces) {
          const limpia = h.split('#')[0];
          if (!limpia || NO_SEGUIR.some((re) => re.test(limpia.split('?')[0]))) continue;
          const camino = limpia.split('?')[0];
          const n = porRuta.get(camino) ?? 0;
          if (vistas.has(limpia) || cola.includes(limpia) || n >= 3) continue;
          porRuta.set(camino, n + 1);
          cola.push(limpia);
        }
      }
      await contexto.close();
    }
  }
} finally {
  await navegador.close();
  app?.kill();
}

console.log(`Celular: ${paginas} pantallas recorridas (a 360 px con ${PERSONAS.length} personas y a 390 px con el Administrador).`);
if (fallas.length) {
  console.log(`\n${fallas.length} problema(s):`);
  for (const f of fallas.slice(0, Number(process.env.MOSTRAR || 60))) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ Ninguna pantalla se desplaza a lo ancho; barra, "Salir" y menú del celular en orden.');
