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
