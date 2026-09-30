# Guía de desarrollo de BotMaker

BotMaker se construye con la forma exacta de un producto de CampaignSuite (su `docs/guia-desarrollo.md`, commit
`ef6a364`), para mudarse al monorepo copiando carpetas. Esta guía resume esas reglas y agrega las propias.

## Capas

| Capa | Dónde | Qué hace | Qué no hace |
|---|---|---|---|
| Dominio | `packages/modules/botmaker/dominio/` | Tipos, matriz de permisos, fichas de motores, reglas y validaciones con zod | No sabe de Next, de la base ni de la red |
| Datos | `datos/` | El contrato `Repositorio` con dos implementaciones: memoria (`demo/`) y Supabase (`supabase/`) | No decide permisos de pantalla |
| Motores | `motores/` | La capa de motores: contratos, instrucciones, marcas, adaptadores (simulado y OpenRouter), principal y respaldo, topes y registro | No sabe de pantallas |
| Vistas | `vistas/` | Una función por pantalla: arma todo ya formateado (textos, montos, qué botones van) | No dibuja |
| Pantallas | `ui/` | Componentes que solo dibujan lo que les da la vista, con las clases de `@campaignsuite/ui` | No calculan ni leen datos |
| Acciones | `acciones/` | Server actions finas (`bots.ts`, `equipo.ts`) y su núcleo sin Next (`ejecutar-*.ts`) | No confían en nada del navegador |
| Rutas | `apps/web/app/[org]/[campana]/bots/` | Resuelven el contexto (`lib/modulo.ts`) y llaman vista + pantalla | Nada más |

## Reglas

1. **Permisos en tres capas.** La vista esconde (`puede`), el núcleo de la acción exige (`exigir` / `puede` con el rol
   que resuelve el servidor) y la base exige (`bots.puede`, `bots.campanas_donde_puede`). La matriz vive en
   `dominio/permisos.ts` y en `bots.matriz_permisos()`; `pnpm db:probar` controla que coincidan. En la demo, el
   repositorio en memoria vuelve a exigir la matriz como la base.
2. **El rol sale de la plataforma:** `rolEnCampana(nucleo, persona, campana, 'botmaker')`, igual que
   `core.rol_en_campana`. BotMaker no guarda roles propios.
3. **Escrituras por funciones de la base.** La persona no tiene insert ni update sobre ninguna tabla de `bots`: cada
   cambio es una función `bots.*` que exige su acción y anota en `core.audit_log` lo que importa.
4. **Migraciones:** nunca se edita una aplicada. Cada cambio es un archivo nuevo `bots_000N_<nombre>.sql`, entero entre
   `begin` y `commit`. Si cambia la matriz o las fichas de motores, cambia también el código (y al revés).
5. **Motores como configuración.** Un motor nuevo es una fila en `bots.engines` (migración) y en
   `dominio/motores.ts`. Cambiar el motor por defecto es cambiar `bots.engine_defaults`. Ninguna pantalla ni flujo sabe
   qué modelo hay detrás.
6. **Claves solo en variables de entorno** del servidor. Nunca en el código, la base, los registros ni el navegador.
   `engine_calls` guarda costos y demoras, nunca textos.
7. **Horas en UTC** en la base y en pantalla, con "UTC" a la vista.
8. **Textos** en español rioplatense para el equipo, sin emojis. Los textos para ciudadanos respetan el trato del bot.
9. **Identificadores** en español; tablas y columnas en inglés `snake_case`; funciones SQL en español.
10. **Formularios que crean algo** llevan clave idempotente (`request_key`).
11. **Interacción por la dirección:** filtros y resultados vuelven como parámetros (`?ok=`, `?error=`); el texto lo arma la
    vista a partir de un código, nunca se muestra texto que venga en la dirección.
12. **Estilos:** los de `@campaignsuite/ui`; lo propio va en `ui/estilos.css` con prefijo `bots-`. Solo modo oscuro.
13. **Las copias de la plataforma** (`packages/platform`, `packages/ui`) no se tocan salvo las dos diferencias
    documentadas: la entrada `botmaker` del catálogo y la demo con BotMaker (`demo.ts`).
14. **Efectos de React con llaves:** `useEffect(() => { … }, [...])`. Un efecto solo puede devolver una función de
    limpieza; con una flecha sin llaves devuelve lo que devuelva la llamada. En Chrome 153 `scrollIntoView` devuelve una
    promesa, React la llamaba como limpieza y el simulador se caía. Lo controla `ui/efectos.test.ts`.
15. **Datos de prueba sin nombres de clientes:** la organización y la campaña de prueba son «CampaignSuite · Pruebas» y
    «Panamá · Pruebas»; los candidatos y partidos de ejemplo son inventados (`CANDIDATA_DEMO`, `PARTIDO_DEMO`). La única
    excepción decidida es el bot 2, el de prueba del creador, con Ricardo Lombana y su material (3.01).

## Cómo sumar…

- **Una pantalla:** la vista en `vistas/<pantalla>.ts` (recibe el repositorio y el contexto, devuelve datos listos), el
  componente en `ui/<pantalla>.tsx` y la ruta en `apps/web/app/[org]/[campana]/bots/<ruta>/page.tsx`. Sumarla al menú
  (`vistas/marco.ts`), a las pruebas de vistas y a `scripts/correr-pruebas.ts`.
- **Una acción:** el núcleo en `acciones/ejecutar-<tema>.ts` (sin Next, con pruebas en `acciones/acciones.test.ts`), la
  server action fina en `acciones/<tema>.ts` y, si escribe en la base, su función `bots.*` en una migración nueva con su
  prueba en `packages/db/scripts/probar-migraciones.ts`.
- **Una acción de la matriz:** en `dominio/permisos.ts` (con su texto) y en `bots.matriz_permisos()` por migración.
- **Un motor:** una migración que lo inserta en `bots.engines` y la misma ficha en `dominio/motores.ts`.
- **Una tabla:** con `organization_id` y `campaign_id`, el disparador `core.completar_organizacion_campana`, la clave
  foránea compuesta a `bots.campaign_settings`, reglas por fila con `bots.campanas_donde_puede` y la prueba por rol.

## Pruebas (antes de cada entrega)

```bash
pnpm typecheck      # tipos de todo el repositorio
pnpm test           # unitarias (dominio, motores, acciones, vistas)
pnpm db:probar      # base en PGlite: migraciones, matriz, fichas, reglas por fila y repositorio de Supabase
pnpm probar         # cada pantalla con cada persona de la demo
pnpm build
pnpm probar:celular # todas las pantallas a 360 y 390 px (necesita el build)
pnpm probar:recorrido # lo que se prueba a mano en la aceptación, en el navegador contra la demo (necesita el build)
```

Las pruebas en el navegador usan Chromium: en GitHub, el de Playwright (el más nuevo, Chrome 153 con Playwright 1.63);
en otra máquina, el que diga `CHROMIUM`. Si es más viejo, una falla que solo aparece en Chrome nuevo pasa en la
computadora y se ve recién en GitHub (así pasó con el simulador). `probar:celular` anota cada pantalla cuyo menú no
responde con lo que mostró y los errores de la página, en lugar de cortar con un tiempo agotado.

## Copiloto, pruebas y publicación (etapa 4)

- **Copiloto** (`dominio/copiloto.ts`, `acciones/ejecutar-copiloto.ts`): el motor recibe el borrador legible (cada caja
  con su dirección y su id), el catálogo de operaciones que puede proponer y lo que marca el validador. Lo que devuelve
  se revisa operación por operación contra el borrador (`revisarPropuesta`: direcciones a ids, validación, se prueba en
  orden) y la persona marca qué aplicar: un cambio de origen `copiloto` que se deshace entero. Si el borrador cambió
  desde la propuesta, no se aplica. El motor simulado entiende por reglas unos pocos pedidos, para la demo y las pruebas.
- **Corridas** (`acciones/ejecutar-corridas.ts`): el navegador pide tandas de 12 casos (3 en paralelo) hasta terminar;
  si el borrador cambia en el medio, la corrida se cancela. Sin juez en la app: el juez está en `pnpm motores:responder`.
- **Publicación** (`acciones/ejecutar-publicacion.ts`, `bots.pedir_publicacion` y compañía): pedir exige una corrida
  terminada sobre el último cambio, no bajar 2 puntos de acierto contra la publicada y ningún error del validador.
  Aprobar y devolver son del administrador; devolver pide comentario. Con un pedido pendiente, el borrador nuevo parte
  de lo pedido (`bots_0005`).

GitHub las corre en cada push, sin claves.

## Canal web y bandeja (etapas 5 y 6)

- **App pública** (`apps/bots-publico`, otro proyecto de Vercel): la página de cada bot (`/b/<id>`), el script del widget
  (`/widget.js`), las rutas que conversan (`/api/conversar`, `/api/mensajes`) y las tareas de fondo (`/api/tareas`).
  Todo sale de `canal-web/` (núcleo sin Next y manejadores de Request → Response) y de `ui/publico/`. En la demo, la
  app del equipo monta lo mismo en `/publico`: un solo servidor, así lo que conversa el widget llega a la bandeja.
- **Un mensaje** (`canal-web/nucleo.ts → atenderMensaje`): bot publicado con el canal prendido; conteos por IP,
  contacto y bot (pasarse deja solo menús; el corte duro por IP y hora contesta 429); la conversación del contacto
  (HMAC del id del navegador); condiciones (aviso o «Acepto»); si está derivada o el bot en pausa, se guarda y el bot no
  contesta; si no, el motor de conversación con la versión publicada y se guarda el turno entero en una transacción
  (`bots.publico_guardar_turno`, con el seq de la conversación para que dos turnos no se pisen).
- **Datos:** `RepositorioPublico` y `RepositorioTareas` (`datos/repositorio.ts`): en la demo, el mismo repositorio en
  memoria; con Supabase, `datos/supabase/publico-supabase.ts`, con la clave de servicio y solo `bots.publico_*` y
  `bots.tarea_*`. La bandeja usa el repositorio del equipo: leer exige `leer_conversaciones`; atender,
  `responder_conversaciones`; revisar la muestra, `editar_borrador`; los datos de un contacto, `gestionar_datos_contactos`.
- **Sin textos de personas** fuera de `bots.messages.text` y de los datos del contacto: los eventos (`bots.events`)
  pasan por `eventosDeTurno` (lista de datos permitidos por evento) y la actividad (`core.audit_log`) nunca lleva el
  dato. El texto se vacía con `bots.tarea_borrar_vencidos` a los días de guardado del bot.

## WhatsApp (etapa 7)

- **Dónde está:** `dominio/whatsapp.ts` (formato de mensajes, ventana de 24 horas, plantillas, consumo, aviso de
  política) y `canal-whatsapp/` (el núcleo sin Next, el cliente de 360dialog real y el simulado, y los manejadores de
  Request → Response). Rutas: `/api/whatsapp/[bot]` en la app pública (y `/publico/api/whatsapp/[bot]` en la demo) y,
  solo en la demo, el teléfono de prueba (`/publico/telefono` y su `/api/telefono`).
- **Un aviso de 360dialog** (`recibirWebhook`): la dirección es una por bot; el secreto viaja en el encabezado
  `x-botmaker-secreto` y se compara en tiempo constante con su SHA-256. Lo recibido va a la cola del canal
  (`bots.channel_inbox`, cuya clave descarta los reintentos) y se contesta enseguida; el proceso va con `after()`. Si se
  corta, la tarea programada lo retoma (a los 2 minutos, hasta 5 intentos).
- **Un mensaje** (`atenderWhatsapp`): el mismo recorrido que el canal web (motor de conversación, condiciones, pausa,
  derivadas), sin IP ni Turnstile. Lo que dice el bot se traduce con `aWhatsapp` (botones hasta 3, lista hasta 10, texto
  largo en partes) y se encola en `bots.outbound` en la misma transacción que el turno (`publico_guardar_turno` con
  `envios`). Cada mensaje de la persona abre la ventana de 24 horas.
- **El envío** (`enviarPendientes`): lee la clave de Vault (`servicio_clave_whatsapp`), manda y guarda el id de
  WhatsApp. 429, 5xx o sin respuesta: reintenta a los 30 s, 2 min, 10 min y 1 h (el orden de una conversación no se
  rompe). 401: canal desconectado y alerta. Los estados de Meta (enviado, entregado, leído, fallido) solo avanzan y dejan
  el evento `estado_mensaje`.
- **La bandeja:** `responder_conversacion` exige la ventana abierta en la base; con la ventana cerrada, solo
  `responder_con_plantilla` con una plantilla aprobada. Después de responder, la acción manda enseguida con `after()`.
- **Plantillas:** el espejo `bots.templates` se actualiza con `GET /message_templates` (la tarea programada y el botón
  «Actualizar los estados»): 360dialog no avisa cuando Meta decide.
- **Contactos:** el número y el nombre de perfil de WhatsApp quedan en `bots.contacts` (decisión del 29/9: son la base de
  contactos de la campaña; se borran a pedido, no por vencimiento). El número solo lo devuelve `json_contacto` a quien
  atiende (`responder_conversaciones`) y no se lee directo de la tabla.
- **Pruebas:** `canal-whatsapp/nucleo.test.ts` (con el simulado), la sección WhatsApp de `pnpm db:probar` (Vault
  simulado en PGlite), `pnpm probar` (pantallas) y la etapa 7 de `pnpm probar:recorrido` (el teléfono de prueba en el
  navegador).

## Base de contactos (7.06)

- **Qué es:** la pantalla Contactos (menú Conversaciones) lista quién le escribió a cada bot de la campaña, con los datos
  que dio y lo que consultó; cada contacto tiene su ficha con sus conversaciones. Cada bot tiene su base: un contacto es
  de un bot y no se mezcla con los de otro.
- **Lo que consultó** sale de `bots.events`, que no tienen textos y no vencen: la intención y el tema del evento
  `interpretado` y la caja y la letra de `opcion_elegida`. Sin cortesía, lo que no se entiende, lo ajeno a la campaña,
  los intentos de manipular ni el tema «ninguno». El cálculo es `consultasDeEventos` (`dominio/contactos.ts`) en la
  demo y `bots.consultas_contacto` en la base; `pnpm db:probar` controla que den lo mismo sobre los mismos eventos. Si
  se cambia uno, se cambia el otro.
- **Quién ve qué:** la base y la ficha, quienes leen conversaciones. El número, solo quienes atienden (lo esconde la
  vista y la base ni lo devuelve), y solo ellos buscan por número. Un contacto borrado a pedido sale de la base y su
  ficha no muestra lo que consultó.
- **Descarga:** CSV (UTF-8 con BOM, una columna por dato) con el filtro de la pantalla; solo el administrador
  (`gestionar_datos_contactos`). Queda en `bots.contact_exports` (quién, cuándo, el filtro sin el texto buscado y
  cuántos) y en la actividad. Las celdas que empiezan con `=`, `+`, `-` o `@` llevan un apóstrofo (inyección de
  fórmulas en planillas), salvo un número de teléfono con `+`.
- **Base:** `bots_0009_contactos.sql` (`base_contactos`, `ficha_contacto`, `exportar_base_contactos`,
  `exportaciones_base` y el índice de eventos por conversación).
- **Pruebas:** `dominio/contactos.test.ts`, la sección «Base de contactos» de `pnpm db:probar`, las pantallas de
  `pnpm probar` y el tramo «base de contactos» de `pnpm probar:recorrido`.

## Analítica (8.01)

- **Qué es:** la pantalla Analítica (menú Conversaciones; la ven todos los que entran a BotMaker, el costo solo quien ve
  costos): conversaciones por día, cómo terminaron, qué consultan, temas, recorridos, embudo por flujo, lo que no
  entendió y el costo en vivo por función y motor. En el editor, «Números (30 días)» pone sobre cada caja sus visitas, el
  abandono y el porcentaje de cada opción.
- **De dónde sale:** de `bots.events`, sin textos. Dos cálculos, iguales en la demo y en la base
  (`dominio/analitica.ts` ↔ `bots_0010_analitica.sql`), y `pnpm db:probar` compara los dos sobre todos los eventos:
  - `metricasDeEvento` ↔ `bots.metricas_evento`: a qué suma cada evento; `bots.stats_hourly` guarda las sumas por bot,
    canal, versión y hora.
  - `cierreDeConversacion` ↔ `bots.cierre_conversacion`: resuelta, derivada o sin resolver, la última caja y el
    recorrido de las primeras 4 cajas; `bots.session_outcomes`, a los 30 minutos sin movimiento (se recalcula si la
    conversación sigue).
  Si se cambia uno, se cambia el otro.
- **La tarea:** `bots.tarea_agregar_analitica` suma de a tramos (hasta el primer evento del último minuto, así un turno
  que tardó en confirmarse no queda afuera) y la corren pg_cron cada 10 minutos y `/api/tareas`. La demo calcula al
  momento, con las mismas funciones.
- **La demo** trae unas 300 conversaciones inventadas del bot publicado desde que se publicó
  (`datos/demo/semilla-analitica.ts`): solo eventos y llamadas a motores, sin mensajes ni contactos.
- **Pruebas:** `dominio/analitica.test.ts`, la sección «Analítica» de `pnpm db:probar`, las vistas y pantallas y la
  etapa 8 de `pnpm probar:recorrido`.


## Errores a Sentry (8.03)

- `observabilidad/sentry.ts`: cliente mínimo (DSN → endpoint de sobres, evento, sobre, límite de 30 por minuto). Lo
  llama `onRequestError` de `instrumentation.ts` en las dos apps; anda en Node y en Edge.
- Nada de la persona: `limpiarTexto` tapa correos, números, claves, parámetros de direcciones y valores de la base
  (`(campo)=(valor)`); la ruta va como la escribe Next (`/[org]/[campana]/…`), sin valores.
- `/api/probar-sentry` (con la clave de las tareas) tira un error a propósito; sin DSN contesta 409.
- Pruebas: `observabilidad/sentry.test.ts` y el tramo «errores a Sentry» de `pnpm probar:recorrido`, que levanta un
  Sentry de mentira, le apunta la app y falla si en el recorrido hubo algún error del servidor.
