# Plan de trabajo: etapas 7 y 8 hasta Supabase

Qué falta construir sin cuentas antes de conectar Supabase, cómo está pensado y en qué punto quedó. Es la hoja de ruta
para retomar: se lee de arriba abajo y se marca lo hecho. Estado al 29/9/2026.

## En qué quedó

- **Etapa 7 (WhatsApp con 360dialog simulado):** hecha y en `main`, con todas las pruebas en verde. Falta probarla con
  una cuenta real (7.01 y 7.05).
  - Tareas: 7.02, 7.03, 7.04 y 7.07.
  - Pruebas: 261 unitarias, 68 de base, 175 de pantallas, 334 de celular y 76 del recorrido.
- **Base de contactos (7.06):** hecha, con la pantalla Contactos, la ficha de cada contacto y la descarga en CSV.
  - Migración `bots_0009_contactos.sql`.
  - Pruebas: 270 unitarias, 74 de base, 192 de pantallas, 370 de celular y 85 del recorrido.
- **Analítica (8.01):** hecha, con la pantalla Analítica y los números sobre el diagrama.
  - Migración `bots_0010_analitica.sql`.
  - Pruebas: 281 unitarias, 78 de base, 202 de pantallas, 385 de celular y 91 del recorrido.
- **Sentry (8.03):** hecho y apagado hasta que haya cuenta (`SENTRY_DSN`); la prueba de cierre es `/api/probar-sentry`.
- **Respuestas grabadas (1.07):** hechas. `motores/respuestas-openrouter.ts` con los casos de la prueba de motores (los
  mensajes de error, tal cual; los cuerpos, con la forma de OpenRouter) y `motores/openrouter-grabadas.test.ts`. El
  adaptador ahora muestra el motivo de «Provider returned error» (el freno de Mistral estaba en `metadata.raw`).
- **Semilla de demo para Supabase:** hecha. `pnpm db:sql --demo` arma `3-semilla-demo.sql` desde las mismas funciones que
  la demo; `pnpm db:probar` la carga en PGlite y compara con la demo (bots, bandeja, base de contactos, analítica y
  costos). Sin WhatsApp (necesita una clave real). Pesa algo más de 1 MB.
- **Manual (8.06):** borrador en Claude Docs (https://claude.ai/code/artifact/22ed80b7-30a4-4800-8239-bb44794a2fea).
  Se prueba dándoselo a alguien que no conoce el producto.
- **Controles en `main`:** 297 unitarias, 79 de base, 202 de pantallas, 385 de celular y 94 del recorrido.
- **Lo que sigue: Supabase y Vercel.** Todo lo que se hace sin cuentas está hecho. El próximo paso es el proyecto de
  Supabase de desarrollo (1.10 a 1.13), las dos apps en Vercel (5.01) y cargar la estructura, la semilla y, si se
  quiere, los bots de ejemplo. Los pasos, en orden y con casillas, están en la lista guiada
  (https://claude.ai/code/artifact/baf3585d-8ffd-4a10-834f-c24ac9e2e473); la referencia sigue en
  `docs/puesta-en-marcha.md`.
- **Cuentas, al 2/10:** hechos los pasos 1 a 11 de la lista guiada (1.09 a 1.13, 5.01, las tareas de pg_cron con la
  llamada de cada minuto a la app pública contestando 200, Turnstile 5.02 y Sentry 8.02/8.03, probado en las dos apps).
  Hay dos administradores más invitados (invitaciones en `core.invitations`). BotMaker anda en
  https://botmaker-gamma.vercel.app con Supabase (`botmaker-dev`, São Paulo), con los bots de ejemplo; la app pública,
  en https://botmaker-publico.vercel.app. Falta 360dialog (7.01), que espera la cuenta de prueba.
- **Pruebas de aceptación: con la app publicada.** Decidido con Joaquín el 29/9: se hacen en Vercel con Supabase, después
  del paso 8 de la lista guiada, y no en la demo. Desde el 3/10, la guía de pruebas tiene «Cómo probar en Vercel»: una
  cuenta por persona (los dos invitados cambian de rol en Equipo), motor real, Turnstile, y las pruebas del teléfono de
  la etapa 7 en la demo local hasta que esté 360dialog. Se avanza sin 360dialog.
- **3.06, hecha el 3/10:** sin borrador, Contenidos, Material, Intenciones y Variables muestran para leer la versión de
  la que partiría uno nuevo (la pedida, si no la publicada, si no la última); YAML sigue mandando a Flujos.
- **Antes del piloto:** 8.05 (la clave de Anthropic propia) y la decisión de la 8.04.

## Etapa 7: WhatsApp con 360dialog simulado

### Cómo funciona

1. **Alta del canal** (Canales, administrador):
   - Pega la clave de 360dialog en un campo de contraseña y el número tal como lo ve la gente.
   - El servidor valida la clave (`GET /v1/configs/webhook`) y genera un secreto al azar.
   - Configura el aviso con `POST /v1/configs/webhook`, con la dirección `<app pública>/api/whatsapp/<id público del bot>`
     y el encabezado `x-botmaker-secreto`.
   - Guarda la clave en Vault. La base guarda solo la referencia y el SHA-256 del secreto.
   - La clave no vuelve nunca al navegador.
2. **Aviso (webhook)**:
   - Verifica el secreto en tiempo constante.
   - Guarda lo recibido en `bots.channel_inbox`, cuya clave primaria descarta los reintentos de 360dialog (hasta 7 días).
   - Contesta 200 enseguida (meta: 0,5 s; 360dialog exige menos de 5 s).
   - Procesa aparte con `after()` de Next.
   - Si el proceso se corta, lo retoma la tarea de fondo: no se pierden mensajes.
3. **Proceso**:
   - Es el mismo motor que la web (`atenderWhatsapp`, espejo de `canal-web/nucleo.ts`).
   - El contacto es el HMAC del número. El número y el nombre de perfil van en `bots.contacts` (`phone` y
     `profile_name`); el número solo lo ve quien atiende.
   - Límites por contacto y por bot. Sin IP ni Turnstile: WhatsApp ya verifica el número.
   - Condiciones: el aviso lleva la dirección en texto; el modo «acepto», un botón.
   - Con el bot en pausa, o si la conversación la atiende el equipo, se guarda el mensaje y el bot no contesta.
   - Cada mensaje de la persona abre la ventana: `window_expires_at` pasa a su hora más 24 horas.
4. **Envío**:
   - Cada mensaje del bot se traduce a WhatsApp (`aWhatsapp`) y se encola en `bots.outbound` en la misma transacción
     que el turno.
   - `enviarPendientes` los toma, lee la clave de Vault y los manda.
   - Reintenta con espera creciente ante 429, 5xx o sin respuesta (hasta 5 veces).
   - Una clave que dejó de valer (401) deja el canal desconectado, abre la alerta `canal_desconectado` y marca el
     envío como «No se envió».
5. **Estados**: los avisos de Meta (enviado, entregado, leído, fallido) actualizan el envío, que solo avanza, y dejan el
   evento `estado_mensaje`.
6. **Bandeja**:
   - La conversación muestra la ventana («abierta hasta…» o «cerrada») y el estado de cada mensaje que salió.
   - Con la ventana cerrada, en lugar de responder se elige una plantilla aprobada de la cuenta y se completan sus
     variables.
   - La base exige la ventana: `responder_conversacion` falla con la ventana cerrada.
   - Devolver al bot con la ventana cerrada guarda lo que diría el bot, marcado como «No se envió».
7. **Salud del canal**:
   - Último mensaje recibido.
   - Recibidos, repetidos descartados, enviados, entregados, leídos y fallidos de los últimos 7 días.
   - Demora del aviso: la máxima y la media.
   - Pendientes.
   - Consumo estimado del mes: 1.000 respuestas gratis y después USD 0,0113 cada una, desde el 1/10/2026.
8. **Aviso de política**: en Canales, al conectar, y en la ficha de un bot electoral o político. Informa, no bloquea.
9. **Demo**:
   - `canal-whatsapp/simulado.ts` es un 360dialog en memoria:
     - acepta claves de prueba de 20 caracteres o más;
     - guarda la configuración del aviso;
     - tiene plantillas de ejemplo;
     - reenvía los estados;
     - puede revocar una clave para probar la desconexión.
   - La página `/publico/telefono` (solo en la demo) es un teléfono de prueba:
     - escribe o toca botones como una persona;
     - el simulado arma el aviso de Meta y lo entrega a la misma ruta del webhook, con el mismo código que en producción.

### Base: `bots_0008_whatsapp.sql`

- **`bots.channels`**:
  - Columnas nuevas: `vault_secret_id`, `webhook_secret_hash`, `display_number`, `webhook_url`, `connected_at`,
    `last_inbound_at`, `last_error`, `last_error_at`.
- **`bots.sessions`**: `window_expires_at`.
- **Tablas nuevas**:
  - El número no tuvo tabla aparte: quedó en `bots.contacts` (ver «Cómo cambia el diseño», más abajo).
  - `bots.channel_inbox`: `(channel_id, key)` como clave primaria. `payload` se vacía al procesar. Se limpia a los 8 días.
  - `bots.outbound`: `(session_id, n, part)`, con `status`, `provider_id` único, `attempts`, `next_attempt_at` y
    `last_error`.
  - `bots.channel_stats`: contadores por canal y día.
- **Funciones del equipo**:
  - `canal_whatsapp`
  - `conectar_whatsapp`: usa `vault.create_secret` o `vault.update_secret`.
  - `prender_whatsapp`
  - `responder_con_plantilla`
- **Funciones que se reemplazan**:
  - `responder_conversacion`: ventana y cola.
  - `devolver_conversacion`: cola, o «No se envió» con la ventana cerrada.
  - `json_conversacion`: `ventanaHasta`.
  - `json_mensaje`: `envio`.
  - `publico_guardar_turno`: `envios` y `ventanaHasta`.
  - `borrar_contacto` y `exportar_contacto`: el número.
  - `tarea_revisar_alertas`: cierra `canal_desconectado` al reconectar.
  - `tarea_borrar_vencidos`: los números vencidos y la limpieza de `channel_inbox`.
- **Funciones públicas** (solo `service_role`):
  - `publico_canal_whatsapp`
  - `publico_recibir`
  - `publico_entradas_pendientes`
  - `publico_entrada_procesada`
  - `publico_guardar_telefono`
  - `publico_tomar_envios`: `for update skip locked`.
  - `publico_resultado_envio`
  - `publico_aplicar_estado`
  - `publico_canal_error`
  - `publico_canales_con_pendientes`
  - `servicio_clave_whatsapp`: lee `vault.decrypted_secrets`.
- **Pruebas de base**: PGlite no tiene Vault. `packages/db/scripts/supabase-simulado.ts` suma un esquema `vault`
  simulado (`secrets`, `create_secret`, `update_secret` y la vista `decrypted_secrets`), como el `auth` simulado.

### Pasos

- [x] Dominio (`dominio/whatsapp.ts`) y cliente real (`canal-whatsapp/d360.ts`)
- [x] Contrato de datos (`datos/repositorio.ts`)
- [x] Pruebas del dominio (`dominio/whatsapp.test.ts`): botones, lista, texto largo, ids, lectura de cada tipo,
      ventana, plantillas y consumo
- [x] Núcleo `canal-whatsapp/`:
  - `webhook.ts`: lectura del aviso con zod y secreto
  - `nucleo.ts`: `recibirWebhook`, `procesarCanal`, `atenderWhatsapp` y `enviarPendientes`
  - `simulado.ts`
  - `http.ts`: manejadores de Request a Response
  - `nucleo.test.ts`
- [x] Demo en memoria: `RepositorioWhatsapp` y los métodos del equipo en `repositorio-demo.ts`, y un canal de ejemplo
      conectado en `semilla-canal.ts`
- [x] Migración `bots_0008_whatsapp.sql`, Vault simulado y sus pruebas en `probar-migraciones.ts`
- [x] Supabase: los métodos nuevos en `repositorio-supabase.ts` y `publico-supabase.ts`, y los errores nuevos en
      `errores.ts` (`ventana_cerrada`, `canal_no_whatsapp`)
- [x] Rutas:
  - `/api/whatsapp/[bot]` en las dos apps
  - `/publico/telefono` y `/publico/api/telefono`, solo en la demo
  - `/api/tareas` procesa lo atascado y reintenta envíos
- [x] Gestor de plantillas (7.07): crear, mandar a aprobar, seguir el estado y borrar; el simulado aprueba o rechaza
- [x] Pantallas:
  - Canales, sección WhatsApp: conectar, prender o apagar, salud, consumo y aviso
  - Bandeja: ventana, estados, plantillas
  - Ficha del bot: aviso de política
  - Mensajes nuevos en `vistas/mensajes.ts`
- [x] Pruebas de pantallas (`correr-pruebas.ts`), celular y recorrido (`probar-recorrido.mjs`):
  - conectar con una clave de prueba
  - el teléfono de prueba conversa
  - un reintento no se duplica
  - la ventana cerrada solo deja plantillas
  - una clave revocada desconecta y abre la alerta
- [x] Docs:
  - `guia-desarrollo.md`
  - `puesta-en-marcha.md`, sección 9: 360dialog con la cuenta de la campaña
  - `.env.ejemplo`: `BOTS_WHATSAPP_SIMULADO`

### 7.06 Base de contactos (hecha)

- **Pantalla Contactos** (menú Conversaciones): quién le escribió a cada bot, con el nombre, el nombre de perfil, el
  número (solo para quien atiende), el canal, las conversaciones (la primera y la última), los datos que dio y lo que
  consultó. Filtros: bot, canal, lo que consultó y texto (nombre, dato o, para quien atiende, número). De a 50.
- **Lo que consultó**: sale de los eventos, que no tienen textos y no vencen. Temas y consultas (intenciones) que
  interpretó el motor y opciones de menú que eligió; sin saludos, lo que no se entiende, lo ajeno ni el tema «ninguno».
  Cada cosa lleva a los demás que consultaron lo mismo.
- **Ficha de cada contacto**: sus datos, lo que consultó (con cuántas veces y la última), sus conversaciones con
  enlace a la bandeja y, para el administrador, exportar sus datos o borrarlos si lo pide.
- **Descargar la base**: CSV con el filtro de la pantalla, solo el administrador. Queda registrado (quién, cuándo, el
  filtro sin el texto buscado y cuántos) y aparece en la misma pantalla.
- **Base:** `bots_0009_contactos.sql`, con 6 pruebas nuevas en `pnpm db:probar`, entre ellas que el SQL y el código
  calculan lo mismo.
- **La bandeja** enlaza a la ficha desde cada conversación.

## Etapa 8, lo que se hace sin cuentas

### 8.01 Analítica (hecha)

Como se diseñó, con estos detalles de cómo quedó:

- La pantalla arranca con el bot publicado si hay uno solo; con varios, con todos. Recorridos y embudo, solo con un bot
  elegido (las cajas de dos bots de la misma plantilla se llaman igual).
- Períodos: hoy, 7, 30 o 90 días, o fechas elegidas (días en UTC, el último incluido).
- Resuelta: respuesta con base completa sin derivar, atendida por alguien del equipo o un «gracias» después de haber
  consultado algo (la regla de cortesía después de una interpretación, una opción o una respuesta).
- La tarea suma de a tramos y deja para la próxima vuelta los eventos del último minuto.
- Números sobre el diagrama: botón «Números (30 días)» en el editor; se abre ya prendido desde Analítica.

Lo diseñado:

- **Eventos**: ya se guardan en `bots.events`, sin textos. Falta agregarlos y mostrarlos.
- **Agregados**:
  - Tabla `bots.stats_hourly`: bot, canal, versión, hora, nombre, caja, clave y cantidad.
  - La llena la tarea `bots.tarea_agregar_analitica` (`bots_0010_analitica.sql`: la 0009 es la base de contactos).
  - Suma también lo que sale de cada conversación terminada, con 30 minutos sin mensajes:
    - el abandono en la última caja que mostró el bot;
    - el recorrido de las primeras cajas;
    - resuelta o derivada.
- **Un solo cálculo**:
  - `dominio/analitica.ts` arma los agregados desde los eventos. La demo lo usa directo.
  - La prueba de base compara el SQL con el TypeScript sobre los mismos eventos.
- **Pantalla Analítica** (menú Conversaciones):
  - Conversaciones, resueltas y derivadas.
  - Ranking de temas.
  - Recorridos más frecuentes.
  - Embudo por flujo.
  - No entendidas.
  - Costo por función y por motor, que sale de las llamadas.
  - Filtros: bot, canal, versión y fechas.
- **Sobre el diagrama**: visitas por caja, porcentaje de cada opción y abandono.

### 8.03 Sentry, apagado hasta que haya cuenta (hecho)

Como se diseñó. Además, `pnpm probar:recorrido` levanta un Sentry de mentira: controla que el error forzado llegue sin
datos de nadie y que en todo el recorrido no haya habido errores del servidor.


- Sin el SDK: un cliente mínimo que manda el error al endpoint de Sentry con el DSN.
- Lo engancha `onRequestError` de `instrumentation.ts` en las dos apps.
- No manda cuerpos de pedidos ni textos de personas. Lo prueba una función de limpieza.
- Sin `SENTRY_DSN` no hace nada.
- `/api/probar-sentry`, con la clave de tareas, tira un error a propósito para la prueba de cierre.

### 1.07 Respuestas grabadas de OpenRouter

- Casos de `motores/openrouter.test.ts` con respuestas reales de la prueba de motores, sin textos de personas: éxito,
  429, 402, JSON roto y vacía.

### Semilla de demo para Supabase

- `pnpm db:sql --demo` arma `3-semilla-demo.sql` con los tres bots de ejemplo, su material, las conversaciones y las
  condiciones, sobre la organización y la campaña de `2-semilla.sql`.
- Se prueba en PGlite leyendo con el repositorio de Supabase: la lista de bots y la bandeja tienen que dar lo mismo que
  la demo.

### 8.06 Manual

- Documento de Claude Docs para el equipo de cada campaña:
  - armar un bot desde la plantilla
  - probar, pedir y aprobar
  - canales (web y WhatsApp)
  - atender la bandeja
  - leer la analítica

## Decisiones (29/9/2026)

Con Joaquín:

- **Nombre de perfil de WhatsApp y número:** se guardan y los ve el equipo que atiende (administrador y agente).
- **Base de contactos (7.06):** se guardan el nombre, el número, los datos que dio y lo que consultó.
  - Sin caja de permiso: alcanza con aceptar las condiciones del bot.
  - Las condiciones por defecto dicen qué queda en la base.
  - Lo legal lo averigua Joaquín aparte.
  - Lo que consultó queda para siempre como temas e intenciones. El texto se borra a los días de guardado del bot
    (90 por defecto).
  - Quién descarga la base: solo el administrador. Lo confirmó Joaquín el 29/9.
- **Gestor de plantillas (7.07):** entra a la v1, aunque la definición lo dejaba afuera.
  - BotMaker crea las plantillas (nombre, categoría, idioma, texto con espacios y ejemplos).
  - Las manda a aprobar a Meta con `POST /message_templates` de 360dialog.
  - Sigue su estado con `GET /message_templates` en la tarea programada y con un botón. 360dialog no avisa por webhook.
  - Las borra con `DELETE /message_templates?name=…`.
  - La bandeja ofrece solo las aprobadas y completa sus espacios, numerados (`positional`) o con nombre (`named`).
  - En la demo, el simulado aprueba o rechaza.
- **Resuelta:** una respuesta con base completa sin derivar, una conversación que atendió una persona o un cierre de
  cortesía. Más adelante, una marca «final» por caja.
- **Una dirección de aviso por bot:** cada bot con su canal, sin mezclar la información de uno con otro.
- **Pruebas de aceptación:** con la app publicada en Vercel y la base en Supabase, no en la demo.
- **Organización de pruebas (30/9):** la organización y la campaña de desarrollo y de la demo son de pruebas de
  CampaignSuite: «CampaignSuite · Pruebas» (`pruebas`, tipo agencia) y «Panamá · Pruebas» (`pa-pruebas`). Antes se
  llamaban como el primer cliente («Movimiento Otro Camino», «Generales 2029»). Los bots 1 y 3 llevan un partido
  inventado («Partido Ejemplo»), como la candidata; el bot 2 sigue con Ricardo Lombana y su material, como bot de
  prueba del creador (3.01). En `botmaker-dev` se renombró con `core-dev/renombrar-organizacion-de-pruebas.sql`.
  Para la mudanza: los clientes reales se crean en CampaignSuite con su flujo; una organización de pruebas interna
  también sirve allá (común, no «demo», que es solo para mirar); si la demo de CampaignSuite usa el nombre de un
  cliente, conviene cambiarlo allá también.

Técnicas: las toma Claude y quedan en la sección «Decisiones técnicas» de la guía de pruebas, para verlas juntos.

- **Aviso de WhatsApp:** una dirección por bot (`/api/whatsapp/<id público>`), con el secreto en el encabezado.
- **Mensajes que llegan:** se guardan primero y se procesan aparte; lo repetido se descarta.
- **Reintentos de envío:** a los 30 segundos, 2 minutos, 10 minutos y 1 hora. Después de 5, «No se envió».
  - Los dispara cada aviso que entra.
  - También una tarea programada cada minuto, aunque no haya actividad. Con Supabase, pg_cron y pg_net.
  - Joaquín está de acuerdo.
- **Clave de 360dialog:** en Vault.
- **Sentry:** cliente mínimo propio. Se pasa al SDK si hacen falta los errores del navegador.
- **Analítica:** agregados por hora con una tarea, con el mismo cálculo en la demo y en la base.

### Cómo cambia el diseño

- **El número:** no va en `bots.contact_addresses`. Va en `bots.contacts`, en columnas nuevas:
  - `phone`, que ven quienes atienden;
  - `profile_name`, el nombre de perfil de WhatsApp.
- **`json_contacto`:** los devuelve.
- **`borrar_contacto`:** los vacía.
- **`tarea_borrar_vencidos`:** no los toca. La base dura hasta que la persona pida que la borren.
- **Plantillas:**
  - Tabla `bots.templates`: canal, nombre, idioma, categoría, formato, componentes, ejemplos, estado, motivo de
    rechazo, id en 360dialog, creada y revisada.
  - Funciones del equipo: `plantillas`, `crear_plantilla` (`configurar_canales`) y `borrar_plantilla`.
  - Función `publico_estado_plantillas` para la tarea.
  - El cliente de 360dialog suma `crearPlantilla` y `borrarPlantilla`.
- **Condiciones por defecto:** suman que el nombre, el número y lo que consulta quedan en la base de contactos de la
  campaña.
