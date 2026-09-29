# BotMaker: reglas para trabajar en este repositorio

BotMaker es un producto de CampaignSuite (CAMPAIGN SUITE SAS) para armar bots conversacionales electorales y
políticos. Se construye aparte con la forma del monorepo de CampaignSuite y después se muda adentro.

- Definición de producto v1: https://claude.ai/code/artifact/28afd1f9-74eb-4d05-9a9a-fb69b38c865c
- Plan técnico por etapas: https://claude.ai/code/artifact/9c123447-2d67-4d1a-a326-c041133168b3
- Tablero de tareas por etapa: https://claude.ai/artifact/Gtpq4nERweRQssNV6WiC1X
- Resultado de la prueba de motores: https://claude.ai/code/artifact/12653699-1f3d-4a3c-8985-6ea5b9aa281d
- Pruebas de aceptación de las etapas 2 a 8: https://claude.ai/code/artifact/eb2284e1-de5d-41af-be0b-1c99d8c072f2
- Guía de desarrollo: `docs/guia-desarrollo.md`. Puesta en marcha: `docs/puesta-en-marcha.md`.
- Hoja de ruta de las etapas 7 y 8 hasta Supabase (dónde quedó y qué sigue): `docs/plan-etapas-7-y-8.md`.

## No se negocia

- **Las claves nunca se comparten:** ni en chats, ni en documentos, ni en correos, ni en archivos que se arman o se
  mandan. Viven solo en las variables de entorno de cada servicio; en la computadora, en `apps/web/.env.local` con
  permisos 600 y los valores entre comillas dobles (`scripts/cargar-variable.sh`). El `.env.local` nunca se manda.
- **Permisos en tres capas:** pantalla, servidor y base.
- **Horas en UTC.** Textos en español rioplatense, sin emojis.
- **Avisar, no bloquear:** las condiciones de los proveedores y de cada mercado se informan donde se decide.
- **El motor es configuración:** ninguna pantalla ni flujo conoce el modelo; todo pasa por `motores/`.
- **Migraciones:** nunca se edita una aplicada; cada cambio, un archivo nuevo entre `begin` y `commit`.
- **Antes de entregar:** `pnpm typecheck && pnpm test && pnpm db:probar && pnpm probar && pnpm build && pnpm probar:celular && pnpm probar:recorrido`.

## Qué se muda a CampaignSuite y qué no

Se muda: `packages/modules/botmaker`, `packages/db/migraciones/bots_*` (renumeradas),
`apps/web/app/[org]/[campana]/bots/` (con `lib/modulo.ts`) y `apps/bots-publico` (entra como otra app). No se muda:
`packages/platform`, `packages/ui`, `packages/db/core-dev`, `apps/web/app/publico` (la app pública montada en la demo)
ni las pantallas mínimas de organización y campaña: CampaignSuite ya las tiene.
