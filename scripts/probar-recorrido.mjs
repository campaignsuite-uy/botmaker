/**
 * Prueba de recorrido en el navegador: lo que Joaquín prueba a mano en las pruebas de aceptación, hecho por Playwright
 * contra la demo en memoria (sin cuentas ni claves). Cierra las etapas 2 a 6.
 *
 *  Etapa 2: crear un bot con la plantilla, agregar y conectar una caja en el editor, editarla y deshacer, recorrerlo en
 *           el simulador con botones y texto, exportar e importar el YAML; el lector ve todo sin poder tocar.
 *  Etapa 3: cargar material, contestar con base citando secciones, derivar un trámite electoral y el corte del
 *           validador de datos a la vista en el simulador.
 *  Etapa 4: el copiloto propone y aplica un cambio por dirección (y se deshace), correr las pruebas con los motores del
 *           bot y con otros, comparar las dos corridas, pedir publicar, devolver sin comentario (no), aprobar, conversar
 *           con la versión publicada y armar el borrador siguiente.
 *  Etapa 5: el widget pegado en un sitio de prueba conversa con la versión publicada y deriva; la bandeja lo ve; el
 *           agente responde y le llega al widget; condiciones con aviso y con «Acepto»; ráfaga en solo menús; pausa.
 *  Etapa 6: alerta de derivada sin respuesta, revisión por muestreo, exportar y borrar los datos de un contacto.
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

  // ── Etapa 4 ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nEtapa 4: copiloto, pruebas y publicación\n');
  await ed.goto(`${CAMPANA}/nuevo`);
  await ed.fill('#nb-nombre', 'Bot de la etapa 4');
  await ed.fill('#nb-candidato', 'Candidata de prueba');
  await ed.click('button:has-text("Crear bot")');
  await ed.waitForURL(/\/flujos\?ok=bot_creado/);
  const bot4 = ed.url().split('/flujos')[0];

  await ed.goto(`${bot4}/copiloto`);
  await ed.fill('#copiloto-pedido', 'En 1.2 agregá la opción de voluntariado');
  await ed.click('button:has-text("Pedir al copiloto")');
  await ed.waitForSelector('.bots-copiloto');
  const propuesta = await ed.locator('.bots-copiloto').textContent();
  prueba('copiloto: "en 1.2 agregá la opción de voluntariado" propone la operación con su dirección', propuesta.includes('Agregó la opción 1.2 › F'), propuesta.slice(0, 200));
  await ed.click('button:has-text("Aplicar las 1 marcadas")');
  await ed.waitForURL(/ok=copiloto_aplicado/);
  prueba('copiloto: lo aplicado queda en su historial y en la barra de deshacer', (await ed.locator('.bots-diferencias').first().textContent()).includes('Agregó la opción 1.2 › F')
    && (await ed.locator('.bots-barra-borrador').textContent()).includes('Agregó la opción 1.2 › F'));
  await ed.click('.bots-barra-borrador button:has-text("Deshacer")');
  await ed.waitForURL(/ok=deshecho/);
  prueba('copiloto: lo aplicado se deshace como cualquier cambio', (await ed.locator('.bots-barra-borrador').textContent()).includes('Se puede rehacer: Agregó la opción 1.2 › F'));

  await ed.goto(`${bot4}/pruebas`);
  await ed.click('button:has-text("Correr las pruebas (46 casos)")');
  await ed.waitForSelector('a:has-text("Ver el resultado")', { timeout: 60000 });
  prueba('pruebas: corren los 46 casos en tandas con el avance a la vista', (await ed.locator('[role=status]').first().textContent()).includes('Terminó: 46 de 46'));
  const primera = await ed.getAttribute('a:has-text("Ver el resultado")', 'href');
  await ed.check('input[name=modo] >> nth=1');
  await ed.selectOption('select[aria-label="Interpretar: principal"]', { index: 1 });
  await ed.click('button:has-text("Correr las pruebas (46 casos)")');
  await ed.waitForFunction((h) => { const a = [...document.querySelectorAll('a')].find((x) => x.textContent === 'Ver el resultado'); return a && a.getAttribute('href') !== h; }, primera, { timeout: 60000 });
  await ed.goto(`${bot4}/pruebas`);
  const marcas = ed.locator('input[name=corrida]');
  prueba('pruebas: las dos corridas en la tabla, con sus motores', await marcas.count() === 2);
  await marcas.nth(0).check();
  await marcas.nth(1).check();
  await ed.click('button:has-text("Comparar las dos marcadas")');
  await ed.waitForURL(/comparar\?a=/);
  const cmp = await ed.textContent('main');
  prueba('pruebas: comparar dos corridas con motores distintos, caso por caso', cmp.includes('Comparar dos corridas') && cmp.includes('46 casos en común') && cmp.includes('Acierto de intenciones'), cmp.slice(0, 200));

  await ed.goto(`${bot4}/publicacion`);
  prueba('publicación: el borrador cumple los requisitos', (await ed.locator('.bots-requisitos').textContent()).split('✗').length === 1);
  await ed.fill('#pub-pedido', 'Primera versión del bot de la etapa 4');
  await ed.click('button:has-text("Pedir publicar")');
  await ed.waitForURL(/ok=publicacion_pedida/);
  const pedido = await ed.textContent('main');
  prueba('publicación: la editora pide publicar y no puede aprobar', pedido.includes('Pedido de publicación: versión 1') && pedido.includes('Primera versión del bot de la etapa 4') && !pedido.includes('Aprobar y publicar'));
  await bot2.goto(`${bot4}/publicacion`);
  prueba('publicación: el administrador ve qué cambia, con direcciones', (await bot2.textContent('main')).includes('Qué cambia contra lo publicado') && await bot2.locator('.bots-diferencias li:has-text("1.2")').count() > 0);
  await bot2.click('button:has-text("Devolver con el comentario")');
  await bot2.waitForURL(/error=falta_comentario/);
  prueba('publicación: devolver sin comentario no se puede', true);
  await bot2.fill('#pub-nota', 'Aprobado en la prueba de recorrido');
  await bot2.click('button:has-text("Aprobar y publicar")');
  await bot2.waitForURL(/ok=publicacion_aprobada/);
  const aprobado = await bot2.textContent('main');
  prueba('publicación: el administrador aprueba y queda en el historial', aprobado.includes('Versión 1: es la que conversa') && aprobado.includes('Aprobó y publicó') && aprobado.includes('Pidió publicar'));
  await bot2.goto(`${bot4}/simulador?version=publicada`);
  await bot2.waitForSelector('.sim-boton');
  prueba('el simulador conversa con la versión publicada', (await bot2.textContent('main')).includes('Versión publicada v1'));
  await ed.goto(`${bot4}/flujos`);
  await ed.click('button:has-text("Armar el borrador")');
  await ed.waitForURL(/ok=borrador_creado/);
  await ed.waitForSelector('.react-flow__node');
  prueba('después de publicar, el borrador nuevo (v2) parte de lo publicado', (await ed.textContent('main')).includes('Borrador v2'));
  prueba('etapa 4 sin errores en la página', !ed.errores.length && !bot2.errores.length, [...ed.errores, ...bot2.errores].join(' · '));

  // ── Etapa 5 ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nEtapa 5: canal web\n');
  const BOT_WEB = `${CAMPANA}/bot-demo-3`;
  const ciudadano = await navegador.newContext({ viewport: { width: 390, height: 800 } });
  const sitio = await ciudadano.newPage();
  const erroresSitio = [];
  sitio.on('pageerror', (e) => erroresSitio.push(String(e.message).slice(0, 160)));
  await sitio.goto(`${BASE}/publico/prueba?bot=p5v9c3h7pa`);
  await sitio.click('#botmaker-widget button');
  const marco = sitio.frameLocator('#botmaker-widget iframe');
  await marco.locator('.pub-opcion', { hasText: 'Hablar con alguien' }).waitFor({ timeout: 15000 });
  const primero = await marco.locator('.pub-chat__mensajes').textContent();
  prueba('el widget pegado en un sitio abre la conversación: aviso de IA con las condiciones, bienvenida y menú', primero.includes('asistente virtual con inteligencia artificial') && primero.includes('Leer las condiciones') && primero.includes('Ana Lucía Ríos'), primero.slice(0, 200));
  await marco.locator('.pub-opcion', { hasText: 'Hablar con alguien' }).click();
  await marco.locator('.pub-nota').waitFor({ timeout: 15000 });
  prueba('pedir hablar con alguien deriva al equipo y el widget lo dice', (await marco.locator('.pub-nota').textContent()).includes('equipo'));
  await marco.locator('input[aria-label="Mensaje"]').fill('Es por una reunión en mi barrio');
  await marco.locator('button:has-text("Enviar")').click();
  await sitio.waitForTimeout(800);

  const agente = await como(navegador, 'p-andres', 390);
  await agente.goto(`${CAMPANA}/bandeja?estado=derivada&bot=bot-demo-3`);
  const filasDerivadas = agente.locator('table.tabla tbody tr');
  prueba('la conversación del widget aparece en la bandeja como derivada', await filasDerivadas.count() >= 2 && (await agente.textContent('main')).includes('Es por una reunión en mi barrio'));
  await agente.locator('table.tabla tbody tr', { hasText: 'Es por una reunión' }).locator('a').first().click();
  await agente.waitForURL(/\/bandeja\/conv-/);
  const detalle = await agente.textContent('main');
  prueba('la conversación con el registro de decisiones de cada mensaje', detalle.includes('Por qué contestó esto') && detalle.includes('Derivada'), detalle.slice(0, 200));
  await agente.click('button:has-text("Tomar la conversación")');
  await agente.waitForURL(/ok=conversacion_tomada/);
  await agente.fill('#bandeja-respuesta', 'Hola, soy Andrés del equipo. ¿En qué barrio es?');
  await agente.click('button:has-text("Enviar")');
  await agente.waitForURL(/ok=respuesta_enviada/);
  await marco.locator('.pub-msj--agente').waitFor({ timeout: 12000 });
  prueba('el agente responde como la campaña y la respuesta le llega al widget', (await marco.locator('.pub-msj--agente').textContent()).includes('soy Andrés'));
  await agente.click('button:has-text("Devolver al bot")');
  await agente.waitForURL(/ok=conversacion_devuelta/);
  prueba('devolver la conversación al bot', (await agente.textContent('main')).includes('La atiende el bot'));

  await sitio.goto(`${BASE}/publico/b/p5v9c3h7pa/condiciones`);
  prueba('las condiciones del bot, con su versión', (await sitio.textContent('main')).includes('Seguir la conversación es aceptar') && (await sitio.textContent('main')).includes('Versión 1'));

  // Una ráfaga desde la misma IP: pasado el límite, solo menús (sin motores).
  let menus = 0;
  for (let i = 0; i < 40; i++) {
    const r = await sitio.request.post(`${BASE}/publico/api/conversar`, { data: { bot: 'p5v9c3h7pa', contacto: `rafaga-navegador-${String(i % 3).padStart(4, '0')}`, canal: 'web', id: `rafaga-${i}-${Date.now()}`, entrada: { tipo: 'texto', texto: '¿Qué propone para el transporte?' } } });
    const j = await r.json();
    if (j.ok && j.soloMenus) menus++;
  }
  prueba('una ráfaga de 40 mensajes desde una IP: pasado el límite por minuto, solo menús', menus >= 20, `solo menús: ${menus}`);

  const adminWeb = bot2;
  await adminWeb.goto(`${BOT_WEB}/canales`);
  prueba('Canales: la página del bot y el código del widget', (await adminWeb.textContent('main')).includes('/publico/b/p5v9c3h7pa') && (await adminWeb.textContent('main')).includes('data-bot="p5v9c3h7pa"'));
  await adminWeb.check('input[name=modoCondiciones][value=acepto]');
  await adminWeb.click('button:has-text("Guardar el canal")');
  await adminWeb.waitForURL(/ok=canal_guardado/);
  const nuevoCiudadano = await (await navegador.newContext()).newPage();
  await nuevoCiudadano.goto(`${BASE}/publico/b/p5v9c3h7pa`);
  await nuevoCiudadano.locator('.pub-opcion', { hasText: 'Acepto' }).waitFor({ timeout: 15000 });
  await nuevoCiudadano.locator('.pub-opcion', { hasText: 'Acepto' }).click();
  await nuevoCiudadano.locator('.pub-opcion', { hasText: 'Propuestas' }).waitFor({ timeout: 15000 });
  prueba('con «Acepto», las condiciones se aceptan con un botón antes de empezar', true);
  await adminWeb.check('input[name=modoCondiciones][value=aviso]');
  await adminWeb.click('button:has-text("Guardar el canal")');
  await adminWeb.waitForURL(/ok=canal_guardado/);
  await adminWeb.goto(`${BOT_WEB}/publicacion`);
  await adminWeb.click('button:has-text("Pausar el bot")');
  await adminWeb.waitForURL(/ok=bot_pausado/);
  const enPausa = await (await navegador.newContext()).newPage();
  await enPausa.goto(`${BASE}/publico/b/p5v9c3h7pa`);
  await enPausa.locator('.pub-msj', { hasText: 'en pausa' }).waitFor({ timeout: 15000 });
  prueba('con el bot en pausa, la página lo dice y no contesta', true);
  await adminWeb.click('button:has-text("Reanudar el bot")');
  await adminWeb.waitForURL(/ok=bot_reanudado/);
  prueba('etapa 5 sin errores en la página', !erroresSitio.length && !agente.errores.length && !adminWeb.errores.length, [...erroresSitio, ...agente.errores, ...adminWeb.errores].join(' · '));

  // ── Etapa 6 ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nEtapa 6: bandeja\n');
  await agente.goto(`${CAMPANA}/bandeja`);
  prueba('alerta de una derivada sin respuesta hace más de 2 horas', (await agente.locator('.aviso--error').textContent()).includes('Derivada sin respuesta'));
  await ed.goto(`${CAMPANA}/bandeja/revision`);
  const antes = await ed.locator('.bots-muestra__item').count();
  await ed.locator('.bots-muestra__item').first().locator('button:has-text("Correcta y convertir en contenido")').click();
  await ed.waitForURL(/ok=respuesta_convertida/);
  prueba('revisión por muestreo: una respuesta correcta se convierte en contenido', await ed.locator('.bots-muestra__item').count() === antes - 1);
  await bot2.goto(`${CAMPANA}/bandeja/datos?buscar=Marcos`);
  const exportar = bot2.locator('a:has-text("Exportar (JSON)")');
  const json = await (await bot2.request.get(`${BASE}${await exportar.getAttribute('href')}`)).json();
  prueba('datos de un contacto: el administrador lo busca y exporta sus datos', json.contacto?.nombre === 'Marcos' && json.conversaciones?.[0]?.mensajes?.length > 0);
  await bot2.locator('summary:has-text("Borrar sus datos")').click();
  await bot2.fill('input[name=confirmar]', 'BORRAR');
  await bot2.click('button:has-text("Borrar los datos")');
  await bot2.waitForURL(/ok=contacto_borrado/);
  prueba('borrar los datos del contacto queda en el registro de pedidos', (await bot2.textContent('main')).includes('Borró los datos') && (await bot2.textContent('main')).includes('Exportó los datos'));
  const lectorBandeja = await como(navegador, 'p-equipo');
  await lectorBandeja.goto(`${CAMPANA}/bandeja`);
  prueba('el lector no entra a la bandeja', !lectorBandeja.url().includes('/bandeja'));
  prueba('etapa 6 sin errores en la página', !agente.errores.length && !ed.errores.length && !bot2.errores.length, [...agente.errores, ...ed.errores, ...bot2.errores].join(' · '));

  // ── La app pública aparte (apps/bots-publico), con su propia demo ─────────────────────────────
  if (!process.env.URL) {
    console.log('\nApp pública aparte (apps/bots-publico)\n');
    const PUERTO_PUB = PUERTO + 4;
    const pubApp = spawn('pnpm', ['exec', 'next', 'start', '-p', String(PUERTO_PUB)], {
      cwd: `${RAIZ}apps/bots-publico`, env: { ...process.env, CAMPAIGNSUITE_DATOS: 'demo', PORT: String(PUERTO_PUB) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const PUB = `http://localhost:${PUERTO_PUB}`;
      const limite = Date.now() + 60_000;
      while (Date.now() < limite) {
        try { if ((await fetch(`${PUB}/widget.js`)).ok) break; } catch { /* todavía no levantó */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      const pag = await (await fetch(`${PUB}/b/p5v9c3h7pa`)).text();
      prueba('la página del bot publicado de la demo', pag.includes('Ana Lucía Ríos'));
      const r = await (await fetch(`${PUB}/api/conversar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot: 'p5v9c3h7pa', contacto: 'app-publica-00000001', canal: 'landing', id: 'app-publica-inicio', entrada: { tipo: 'inicio' } }) })).json();
      prueba('conversa con la versión publicada', r.ok && r.mensajes.some((m) => m.opcionesDe === 'n_menu'), JSON.stringify(r).slice(0, 200));
      const w = await fetch(`${PUB}/widget.js`);
      prueba('sirve el script del widget', (await w.text()).includes('botmaker-widget') && (w.headers.get('content-type') ?? '').includes('javascript'));
      const b = await fetch(`${PUB}/b/p5v9c3h7pa`);
      prueba('la página del bot se puede mostrar dentro del widget en cualquier sitio', (b.headers.get('content-security-policy') ?? '').includes('frame-ancestors *'));
      prueba('las tareas de fondo piden su clave', (await fetch(`${PUB}/api/tareas`)).status === 401);
      prueba('un bot que no está publicado no se muestra', (await (await fetch(`${PUB}/b/k7m2q9x4pa`)).text()).includes('no está disponible'));
    } finally {
      pubApp.kill();
    }
  }
} catch (e) {
  prueba('el recorrido termina sin errores', false, e.stack ?? String(e));
} finally {
  await navegador.close();
  app?.kill();
}
console.log(`\n${total - fallas} de ${total} pruebas bien.${fallas ? ` ${fallas} fallaron.` : ''}\n`);
process.exit(fallas ? 1 : 0);
