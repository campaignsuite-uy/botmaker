/**
 * Prueba de pantallas: arma cada vista con cada persona de la demo y dibuja su pantalla a HTML (sin navegador), y
 * controla qué ve cada rol: qué formularios y botones aparecen y cuáles no. Complementa las pruebas unitarias de
 * vistas (vistas/vistas.test.ts): acá lo que se prueba es lo que queda dibujado.
 *
 * Uso: pnpm probar (desde la raíz). Sale con código 1 si algo falla.
 */
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { nucleoMemoria, reiniciarNucleoMemoria } from '@campaignsuite/platform/memoria';
import { rolEfectivo } from '../acciones/comun';
import { RepositorioDemo } from '../datos/demo/repositorio-demo';
import type { ContextoPantalla } from '../ui/contexto';
import { Marco } from '../ui/marco';
import { PantallaBot } from '../ui/bot';
import { PantallaBots } from '../ui/bots';
import { PantallaCostos } from '../ui/costos';
import { PantallaEquipo } from '../ui/equipo';
import { PantallaMotores } from '../ui/motores';
import { PantallaNuevoBot } from '../ui/nuevo';
import { PantallaFlujos } from '../ui/flujos';
import { vistaEditor } from '../vistas/editor';
import { PantallaContenidos, PantallaIntenciones, PantallaVariables, PantallaYaml } from '../ui/partes';
import { vistaContenidos, vistaIntenciones, vistaVariables, vistaYaml } from '../vistas/partes';
import { PantallaSimulador } from '../ui/simulador';
import { vistaSimulador } from '../vistas/simulador';
import { vistaBot } from '../vistas/bot';
import { vistaBots } from '../vistas/bots';
import { vistaCostos } from '../vistas/costos';
import { vistaEquipo } from '../vistas/equipo';
import { datosMarco } from '../vistas/marco';
import { vistaMotores } from '../vistas/motores';
import { vistaNuevoBot } from '../vistas/nuevo';

// tsx compila @campaignsuite/ui (fuera de este tsconfig) con JSX clásico, que espera un React global (igual que en
// CampaignSuite, scripts/probar-comun.ts).
(globalThis as { React?: typeof React }).React = React;

let fallas = 0;
let total = 0;
function prueba(nombre: string, ok: boolean, detalle = '') {
  total++;
  if (!ok) fallas++;
  console.log(`  ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `\n      ${detalle}`}`);
}

function ctx(personaId: string, demo = false): ContextoPantalla {
  const n = nucleoMemoria();
  const p = n.personas.find((x) => x.id === personaId)!;
  return {
    persona: { id: p.id, nombre: p.nombre, iniciales: p.iniciales },
    organizacion: { slug: 'otro-camino', nombre: 'Movimiento Otro Camino', demo },
    campana: { id: 'c-pa-2029', organizacionId: 'org-moca', slug: 'pa-2029', nombre: 'Generales 2029', paisIso: 'PA', pais: 'Panamá', zonaHoraria: 'America/Panama', fechaEleccion: '2029-05-06' },
    rol: demo ? 'observador' : rolEfectivo(n, personaId, 'c-pa-2029')!,
    base: '/otro-camino/pa-2029/bots',
    plataforma: { inicio: '/otro-camino/pa-2029', configuracion: null },
    nucleo: n,
    parametros: {},
  };
}

const html = (e: ReactElement) => renderToStaticMarkup(e);
const tiene = (h: string, texto: string) => h.includes(texto);

interface Esperado {
  crear: boolean;
  datos: boolean;
  motores: boolean;
  datosPersonales: boolean;
  archivar: boolean;
  costos: boolean;
  equipo: boolean;
}

const PERSONAS: [string, string, boolean, Esperado][] = [
  ['p-joaquin', 'Dueño (administrador en cascada)', false, { crear: true, datos: true, motores: true, datosPersonales: true, archivar: true, costos: true, equipo: true }],
  ['p-lucia', 'Editora', false, { crear: true, datos: true, motores: false, datosPersonales: false, archivar: false, costos: false, equipo: false }],
  ['p-andres', 'Agente', false, { crear: false, datos: false, motores: false, datosPersonales: false, archivar: false, costos: false, equipo: false }],
  ['p-equipo', 'Lector', false, { crear: false, datos: false, motores: false, datosPersonales: false, archivar: false, costos: false, equipo: false }],
  ['p-joaquin', 'Observador de una demo', true, { crear: false, datos: false, motores: false, datosPersonales: false, archivar: false, costos: true, equipo: false }],
];

async function main() {
  console.log('\nPantallas de BotMaker con cada persona de la demo\n');
  for (const [id, nombre, demo, e] of PERSONAS) {
    reiniciarNucleoMemoria();
    const repo = new RepositorioDemo();
    const c = ctx(id, demo);
    console.log(nombre);
    try {
      const marco = html(createElement(Marco, { ctx: c, datos: await datosMarco(repo, c), children: createElement('p', null, 'contenido') }));
      prueba('marco: menú de BotMaker y costos solo si los ve', tiene(marco, 'BotMaker') && tiene(marco, '/bots/costos') === e.costos);

      const lista = html(createElement(PantallaBots, { v: await vistaBots(repo, c) }));
      prueba('bots: la lista con los dos bots', tiene(lista, 'Asistente de la campaña') && tiene(lista, 'Consultas del partido'));
      prueba(`bots: «Nuevo bot» ${e.crear ? 'aparece' : 'no aparece'}`, tiene(lista, '>Nuevo bot<') === e.crear);

      const nuevo = html(createElement(PantallaNuevoBot, { v: vistaNuevoBot(c) }));
      prueba(`nuevo bot: ${e.crear ? 'formulario' : 'solo lectura'}`, tiene(nuevo, 'Crear bot') === e.crear);

      const vb = await vistaBot(repo, c, 'bot-demo-2');
      const bot = html(createElement(PantallaBot, { v: vb! }));
      prueba(`ajustes: datos ${e.datos ? 'editables' : 'de lectura'}`, tiene(bot, 'Guardar datos') === e.datos);
      prueba(`ajustes: motores y topes ${e.motores ? 'editables, con «Probar»' : 'de lectura'}`, tiene(bot, 'Guardar motores y topes') === e.motores && tiene(bot, '>Probar<') === e.motores);
      prueba(`ajustes: datos personales ${e.datosPersonales ? 'editables' : 'de lectura'}`, tiene(bot, 'name="dias"') === e.datosPersonales);
      prueba(`ajustes: archivar ${e.archivar ? 'aparece' : 'no aparece'}`, tiene(bot, 'Archivar el bot') === e.archivar);
      prueba(`ajustes: gasto del bot ${e.costos ? 'a la vista' : 'oculto'}`, tiene(bot, 'Gasto de hoy') === e.costos);
      prueba('ajustes: los avisos de los motores se ven siempre', tiene(bot, 'Avisos de los motores elegidos'));

      const flujos = html(createElement(PantallaFlujos, { v: (await vistaEditor(repo, c, 'bot-demo-1'))! }));
      prueba('flujos: el editor con los flujos y las pestañas del bot', tiene(flujos, 'Partes del bot') && tiene(flujos, 'ed-barra') && tiene(flujos, 'Datos personales</button>'));
      prueba(`flujos: ${e.datos ? 'se edita (+ Caja, deshacer)' : 'solo mirar'}`, tiene(flujos, '+ Caja') === e.datos && tiene(flujos, 'Deshacer') === e.datos);

      const contenidos = html(createElement(PantallaContenidos, { v: (await vistaContenidos(repo, c, 'bot-demo-1'))! }));
      prueba(`contenidos: vista previa web y WhatsApp; ${e.datos ? 'se editan' : 'solo mirar'}`, tiene(contenidos, 'WhatsApp') && tiene(contenidos, 'Bienvenida') && tiene(contenidos, 'Agregar contenido') === e.datos);
      const intenciones = html(createElement(PantallaIntenciones, { v: (await vistaIntenciones(repo, c, 'bot-demo-1'))! }));
      prueba(`intenciones y temas: las 23 y los temas; ${e.datos ? 'se editan' : 'solo mirar'}`, tiene(intenciones, 'Intenciones (23)') && tiene(intenciones, 'Temas (') && tiene(intenciones, 'Agregar intención') === e.datos);
      const variables = html(createElement(PantallaVariables, { v: (await vistaVariables(repo, c, 'bot-demo-1'))! }));
      prueba(`variables y datos: ${e.datos ? 'se editan' : 'solo mirar'}`, tiene(variables, 'Candidato y partido') && tiene(variables, '{{bot.horario}}') && tiene(variables, 'Agregar variable') === e.datos);
      const yaml = html(createElement(PantallaYaml, { v: (await vistaYaml(repo, c, 'bot-demo-1'))! }));
      prueba(`yaml: exportar${e.datos ? ' e importar' : ''}`, tiene(yaml, 'Descargar .yaml') && tiene(yaml, 'Importar</button>') === e.datos);

      const simulador = html(createElement(PantallaSimulador, { v: (await vistaSimulador(repo, c, 'bot-demo-1'))! }));
      prueba(`simulador: ${e.datos ? 'el chat' : 'no lo usa (tiene costo)'}`, tiene(simulador, 'sim-controles') === e.datos && tiene(simulador, 'lo usan el editor y el administrador') === !e.datos);

      const motores = html(createElement(PantallaMotores, { v: await vistaMotores(repo, c) }));
      prueba('motores: fichas y por defecto', tiene(motores, 'Ficha de cada motor') && tiene(motores, 'gpt-oss-120b (Groq)'));

      if (e.costos) {
        const costos = html(createElement(PantallaCostos, { v: await vistaCostos(repo, c) }));
        prueba('costos: totales, por motor y últimas llamadas', tiene(costos, 'Por motor') && tiene(costos, 'Últimas llamadas'));
      }

      const equipo = html(createElement(PantallaEquipo, { v: vistaEquipo(c) }));
      prueba(`equipo: ${e.equipo ? 'cambia roles' : 'solo lectura'}`, tiene(equipo, 'name="rol"') === e.equipo);
      prueba('equipo: la matriz de permisos a la vista', tiene(equipo, 'Roles de BotMaker') && tiene(equipo, 'Armar el equipo de BotMaker en la campaña'));
    } catch (err) {
      prueba('las pantallas se dibujan sin errores', false, (err as Error).stack ?? String(err));
    }
  }
  console.log(`\n${total - fallas} de ${total} pruebas bien.${fallas ? ` ${fallas} fallaron.` : ''}\n`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
