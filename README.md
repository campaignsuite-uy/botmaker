# BotMaker

Asistentes conversacionales de la campaña, para responder a los ciudadanos en la web y en WhatsApp. Producto de
CampaignSuite, construido aparte con la forma de su monorepo.

Estado: **etapa 1** del plan técnico (base, ingreso, roles, bots, capa de motores y costos).

```bash
pnpm install
pnpm dev          # http://localhost:3000, demo en memoria: elegí una persona y entrá
```

| Carpeta | Qué es |
|---|---|
| `apps/web` | La app del equipo (Next.js 16). Rutas `/<organización>/<campaña>/bots/…` |
| `packages/modules/botmaker` | El producto: dominio, datos, motores, vistas, pantallas y acciones. Es lo que se muda a CampaignSuite |
| `packages/db` | Núcleo de desarrollo (`core-dev/`), migraciones `bots_*` y la prueba de la base con PGlite |
| `packages/platform`, `packages/ui` | Copias de CampaignSuite (`ef6a364`) con dos diferencias documentadas |
| `docs/` | Guía de desarrollo y puesta en marcha |

Pruebas: `pnpm typecheck`, `pnpm test`, `pnpm db:probar`, `pnpm probar`, `pnpm build`, `pnpm probar:celular`.
Conectar Supabase y OpenRouter: `docs/puesta-en-marcha.md`. Reglas: `CLAUDE.md`.
