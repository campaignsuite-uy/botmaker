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
import { PantallaContenidos, PantallaIntenciones, PantallaMaterial, PantallaVariables, PantallaYaml } from '../ui/partes';
import { vistaContenidos, vistaIntenciones, vistaMaterial, vistaVariables, vistaYaml } from '../vistas/partes';
import { PantallaSimulador } from '../ui/simulador';
import { vistaSimulador } from '../vistas/simulador';
import { PantallaComparar, PantallaCorrida, PantallaPruebas } from '../ui/pruebas';
import { vistaComparar, vistaCorrida, vistaPruebas } from '../vistas/pruebas';
import { PantallaPublicacion } from '../ui/publicacion';
import { vistaPublicacion } from '../vistas/publicacion';
import { PantallaCopiloto } from '../ui/copiloto';
import { vistaCopiloto } from '../vistas/copiloto';
import { CapaMotores } from '../motores/capa';
import { AdaptadorSimulado } from '../motores/simulado';
import { ejecutarAvanzarCorrida, ejecutarIniciarCorrida } from '../acciones/ejecutar-corridas';
import { ejecutarPedirPublicacion } from '../acciones/ejecutar-publicacion';
import { PantallaBandeja, PantallaConversacion, PantallaDatosContactos, PantallaRevision } from '../ui/bandeja';
import { vistaBandeja, vistaConversacion, vistaDatosContactos, vistaRevision } from '../vistas/bandeja';
import { PantallaAnalitica } from '../ui/analitica';
import { vistaAnalitica } from '../vistas/analitica';
import { PantallaContactos, PantallaFichaContacto } from '../ui/contactos';
import { vistaContactos, vistaFichaContacto } from '../vistas/contactos';
import { PantallaCanales } from '../ui/canales';
import { vistaCanales } from '../vistas/canales';
import { puede } from '../dominio/permisos';
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
    organizacion: { slug: 'pruebas', nombre: 'CampaignSuite · Pruebas', demo },
    campana: { id: 'c-pa-pruebas', organizacionId: 'org-pruebas', slug: 'pa-pruebas', nombre: 'Panamá · Pruebas', paisIso: 'PA', pais: 'Panamá', zonaHoraria: 'America/Panama', fechaEleccion: '2029-05-06' },
    rol: demo ? 'observador' : rolEfectivo(n, personaId, 'c-pa-pruebas')!,
    base: '/pruebas/pa-pruebas/bots',
    plataforma: { inicio: '/pruebas/pa-pruebas', configuracion: null },
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
      prueba('marco: «Contactos» para quien lee conversaciones', tiene(marco, '/bots/contactos') === puede(c.rol, 'leer_conversaciones'));
      prueba('marco: «Analítica» para todos', tiene(marco, '/bots/analitica'));

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
      const material = html(createElement(PantallaMaterial, { v: (await vistaMaterial(repo, c, 'bot-demo-2'))! }));
      prueba(`material: 27 secciones con su costo; ${e.datos ? 'se carga y se edita' : 'solo mirar'}`, tiene(material, '27 secciones') && tiene(material, 'S12 · Caja de Seguro Social') && tiene(material, '>Cargar</button>') === e.datos);
      const intenciones = html(createElement(PantallaIntenciones, { v: (await vistaIntenciones(repo, c, 'bot-demo-1'))! }));
      prueba(`intenciones y temas: las 23 y los temas; ${e.datos ? 'se editan' : 'solo mirar'}`, tiene(intenciones, 'Intenciones (23)') && tiene(intenciones, 'Temas (') && tiene(intenciones, 'Agregar intención') === e.datos);
      const variables = html(createElement(PantallaVariables, { v: (await vistaVariables(repo, c, 'bot-demo-1'))! }));
      prueba(`variables y datos: ${e.datos ? 'se editan' : 'solo mirar'}`, tiene(variables, 'Candidato y partido') && tiene(variables, '{{bot.horario}}') && tiene(variables, 'Agregar variable') === e.datos);
      const yaml = html(createElement(PantallaYaml, { v: (await vistaYaml(repo, c, 'bot-demo-1'))! }));
      prueba(`yaml: exportar${e.datos ? ' e importar' : ''}`, tiene(yaml, 'Descargar .yaml') && tiene(yaml, 'Importar</button>') === e.datos);
      // 3.06: sin borrador, lo publicado se lee en Contenidos, Material, Intenciones y Variables.
      const leer = [
        html(createElement(PantallaContenidos, { v: (await vistaContenidos(repo, c, 'bot-demo-3'))! })),
        html(createElement(PantallaMaterial, { v: (await vistaMaterial(repo, c, 'bot-demo-3'))! })),
        html(createElement(PantallaIntenciones, { v: (await vistaIntenciones(repo, c, 'bot-demo-3'))! })),
        html(createElement(PantallaVariables, { v: (await vistaVariables(repo, c, 'bot-demo-3'))! })),
      ];
      prueba(`sin borrador: lo publicado para leer${e.datos && !demo ? ', con el enlace para armar uno' : ''}`,
        leer.every((h) => tiene(h, 'Esto es lo publicado (v1), solo para leer.') && !tiene(h, 'no tiene borrador') && tiene(h, 'armá un borrador en Flujos') === (e.datos && !demo))
        && tiene(leer[0]!, 'Bienvenida') && !tiene(leer[0]!, 'Agregar contenido') && !tiene(leer[0]!, 'Los contenidos los cambian')
        && tiene(leer[1]!, '4 secciones') && !tiene(leer[1]!, '>Cargar</button>') && tiene(leer[2]!, 'Intenciones (23)') && tiene(leer[3]!, 'Ana Lucía Ríos'));

      const simulador = html(createElement(PantallaSimulador, { v: (await vistaSimulador(repo, c, 'bot-demo-1'))! }));
      prueba(`simulador: ${e.datos ? 'el chat' : 'no lo usa (tiene costo)'}`, tiene(simulador, 'sim-controles') === e.datos && tiene(simulador, 'lo usan el editor y el administrador') === !e.datos);

      // Etapa 4: una corrida terminada (la corre la editora, así hay qué ver con cualquier persona), comparar y publicar.
      const lucia = { repo, rol: rolEfectivo(nucleoMemoria(), 'p-lucia', 'c-pa-pruebas'), personaId: 'p-lucia', campanaId: 'c-pa-pruebas', campana: { nombre: 'Panamá · Pruebas' } };
      const capa = () => new CapaMotores({ repo, adaptadores: { openrouter: new AdaptadorSimulado() as never, simulado: new AdaptadorSimulado() }, simular: true });
      const i = await ejecutarIniciarCorrida(lucia, { botId: 'bot-demo-1' });
      for (let k = 0; k < 50 && i.corridaId; k++) if ((await ejecutarAvanzarCorrida(lucia, capa, { corridaId: i.corridaId })).terminada) break;
      const pruebas = html(createElement(PantallaPruebas, { v: (await vistaPruebas(repo, c, 'bot-demo-1'))! }));
      prueba(`pruebas: casos y corridas; ${e.datos ? 'corre y carga casos' : 'solo mirar'}`, tiene(pruebas, 'Casos de prueba (46)') && tiene(pruebas, 'Comparar las dos marcadas') && tiene(pruebas, 'Cargar casos</button>') === e.datos && tiene(pruebas, 'las corren el editor y el administrador') === !e.datos);
      prueba(`pruebas: el costo ${e.costos ? 'a la vista' : 'oculto'}`, tiene(pruebas, '<th>Costo</th>') === e.costos);
      const corrida = html(createElement(PantallaCorrida, { v: (await vistaCorrida(repo, c, 'bot-demo-1', i.corridaId!))! }));
      prueba('pruebas: una corrida con su resumen y cada caso', tiene(corrida, 'Acierto de intenciones') && tiene(corrida, 'Ver solo los que fallaron') && tiene(corrida, 'c001'));
      const comparar = html(createElement(PantallaComparar, { v: (await vistaComparar(repo, { ...c, parametros: { a: i.corridaId!, b: i.corridaId! } }, 'bot-demo-1'))! }));
      prueba('pruebas: comparar dos corridas', tiene(comparar, 'Comparar dos corridas') && tiene(comparar, 'Mejoran en B (0)') && tiene(comparar, '46 casos en común'));
      let publicacion = html(createElement(PantallaPublicacion, { v: (await vistaPublicacion(repo, c, 'bot-demo-1'))! }));
      prueba(`publicación: requisitos; ${e.datos ? 'pide publicar' : 'no pide'}`, tiene(publicacion, 'Las pruebas corrieron sobre el último cambio') && tiene(publicacion, 'Pedir publicar</button>') === e.datos);
      await ejecutarPedirPublicacion(lucia, { botId: 'bot-demo-1', seq: 0, nota: 'Primera versión' });
      publicacion = html(createElement(PantallaPublicacion, { v: (await vistaPublicacion(repo, c, 'bot-demo-1'))! }));
      prueba(`publicación: el pedido con sus cambios; ${e.motores ? 'aprueba o devuelve' : 'no aprueba'}`, tiene(publicacion, 'Pedido de publicación: versión 1') && tiene(publicacion, 'Qué cambia contra lo publicado') && tiene(publicacion, 'Aprobar y publicar</button>') === e.motores);
      const copiloto = html(createElement(PantallaCopiloto, { v: (await vistaCopiloto(repo, c, 'bot-demo-2'))! }));
      prueba(`copiloto: ${e.datos ? 'el panel para pedir' : 'solo lectura'}`, tiene(copiloto, 'Pedirle al copiloto') && tiene(copiloto, 'Pedir al copiloto</button>') === e.datos && tiene(copiloto, 'lo usan el editor y el administrador') === !e.datos);

      // Etapas 5 y 6: canales del bot publicado y la bandeja.
      const canales = html(createElement(PantallaCanales, { v: (await vistaCanales(repo, c, 'bot-demo-3'))! }));
      prueba(`canales: la página del bot y el widget; ${e.motores ? 'se configuran' : 'solo mirar'}`, tiene(canales, '/publico/b/p5v9c3h7pa') && tiene(canales, 'data-bot=&quot;p5v9c3h7pa&quot;') && tiene(canales, 'Guardar el canal</button>') === e.motores && tiene(canales, 'Publicar las condiciones</button>') === e.motores);
      // Etapa 7: WhatsApp en Canales (salud, aviso de política y plantillas) y en la ficha del bot.
      prueba(`whatsapp: salud, aviso de política y plantillas; ${e.motores ? 'se conecta y se crean plantillas' : 'solo mirar'}`,
        tiene(canales, 'Política de WhatsApp') && tiene(canales, 'Salud de los últimos 7 días') && tiene(canales, 'retomar_consulta') && tiene(canales, 'En revisión')
        && tiene(canales, 'teléfono de prueba') && tiene(canales, 'name="clave"') === e.motores && tiene(canales, 'Mandar a aprobar</button>') === e.motores
        && tiene(canales, 'Apagar WhatsApp</button>') === e.motores && tiene(canales, 'Actualizar los estados</button>'));
      const ficha = html(createElement(PantallaBot, { v: (await vistaBot(repo, c, 'bot-demo-3'))! }));
      prueba('whatsapp: la ficha del bot avisa la política', tiene(ficha, 'WhatsApp conectado.') && tiene(ficha, 'no admite partidos, candidatos ni campañas'));
      if (puede(c.rol, 'leer_conversaciones')) {
        const marta = html(createElement(PantallaConversacion, { v: (await vistaConversacion(repo, c, 'conv-demo-5'))! }));
        const atiendeWa = puede(c.rol, 'responder_conversaciones') && !demo;
        prueba(`whatsapp: la ventana cerrada solo deja plantillas; ${atiendeWa ? 'elige y completa una' : 'solo mirar'}`,
          tiene(marta, 'solo deja escribirle con una plantilla') && tiene(marta, 'WhatsApp: Leído') && !tiene(marta, 'Responder como la campaña')
          && tiene(marta, 'Mandar la plantilla</button>') === atiendeWa && tiene(marta, '+50761234567') === atiendeWa && tiene(marta, 'Marta G.'));
        const bandeja = html(createElement(PantallaBandeja, { v: await vistaBandeja(repo, c) }));
        prueba('bandeja: conversaciones, conteos y la alerta de la derivada sin respuesta', tiene(bandeja, 'Derivada sin respuesta') && tiene(bandeja, 'Rosa') && tiene(bandeja, 'Contacto '));
        const conv = html(createElement(PantallaConversacion, { v: (await vistaConversacion(repo, c, 'conv-demo-2'))! }));
        const atiende = puede(c.rol, 'responder_conversaciones') && !demo;
        prueba(`conversación: el registro de decisiones; ${atiende ? 'la atiende' : 'solo mirar'}`, tiene(conv, 'Por qué contestó esto') && tiene(conv, 'Hablar con una persona') && tiene(conv, 'Tomar la conversación</button>') === atiende);
        // Etapa 7 (7.06): la base de contactos, filtrada por lo que consultaron, y la ficha de un contacto.
        const verNumero = puede(c.rol, 'responder_conversaciones');
        const descarga = puede(c.rol, 'gestionar_datos_contactos');
        const base = html(createElement(PantallaContactos, { v: await vistaContactos(repo, c) }));
        prueba(`contactos: la base con lo que consultó cada uno; ${verNumero ? 'con el número' : 'sin el número'}; ${descarga ? 'se descarga' : 'no se descarga'}`,
          tiene(base, '5 contactos.') && tiene(base, 'Marta G.') && tiene(base, '>Transporte<') && tiene(base, '>Voluntariado<') && tiene(base, 'zona: Arraiján')
          && !tiene(base, '>Cortesía<') && tiene(base, '+50761234567') === verNumero && tiene(base, 'Descargar (CSV)') === descarga);
        const filtrada = html(createElement(PantallaContactos, { v: await vistaContactos(repo, { ...c, parametros: { consulta: 'tema:agua' } }) }));
        prueba('contactos: filtrar por lo que consultó', tiene(filtrada, '1 contacto consultó por «Agua».') && tiene(filtrada, 'Marcos') && !tiene(filtrada, 'Marta G.'));
        const fichaContacto = html(createElement(PantallaFichaContacto, { v: (await vistaFichaContacto(repo, c, 'ct-demo-5'))! }));
        prueba(`contactos: la ficha con lo que consultó y sus conversaciones; ${descarga ? 'con los pedidos de datos' : 'sin los pedidos'}`,
          tiene(fichaContacto, '>Agenda<') && tiene(fichaContacto, 'En atención') && tiene(fichaContacto, '/bots/bandeja/conv-demo-5') && tiene(fichaContacto, '+50761234567') === verNumero
          && tiene(fichaContacto, 'Exportar sus datos (JSON)') === descarga && tiene(fichaContacto, 'Borrar los datos</button>') === (descarga && !demo));
        const revision = html(createElement(PantallaRevision, { v: await vistaRevision(repo, c) }));
        const revisa = puede(c.rol, 'editar_borrador') && !demo;
        prueba(`revisión por muestreo: ${revisa ? 'revisa' : 'solo mirar'}`, tiene(revision, '¿Qué proponen para el transporte?') && tiene(revision, 'Correcta y convertir en contenido</button>') === revisa);
      } else {
        prueba('bandeja: el lector no lee conversaciones', !puede(c.rol, 'leer_conversaciones'));
      }
      if (puede(c.rol, 'gestionar_datos_contactos')) {
        const datos = html(createElement(PantallaDatosContactos, { v: await vistaDatosContactos(repo, { ...c, parametros: { buscar: 'Marcos' } }) }));
        prueba(`datos de contactos: buscar, exportar${demo ? '' : ' y borrar'}`, tiene(datos, 'Marcos') && tiene(datos, 'Exportar (JSON)') && tiene(datos, 'Borrar los datos</button>') === !demo);
      }

      // Etapa 8 (8.01): la analítica del bot publicado; el costo, solo quien ve costos.
      const analitica = html(createElement(PantallaAnalitica, { v: await vistaAnalitica(repo, c) }));
      prueba(`analítica: conversaciones, consultas, temas y embudo; ${e.costos ? 'con el costo' : 'sin el costo'}`,
        tiene(analitica, 'Cómo terminaron') && tiene(analitica, 'Qué consultan') && tiene(analitica, '>Propuesta<') && tiene(analitica, 'Embudo por flujo')
        && tiene(analitica, 'Menú principal') && tiene(analitica, 'Costo en vivo') === e.costos && !tiene(analitica, '>Cortesía<'));
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
