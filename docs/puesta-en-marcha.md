# Puesta en marcha

Cómo pasar de la demo en memoria al proyecto de Supabase de desarrollo, paso a paso. Todo se hace desde la Terminal de
la Mac, en la carpeta del repositorio, y desde las pantallas de cada servicio.

**Cuentas:** las mismas de CampaignSuite (GitHub, Supabase, OpenRouter, Vercel y Trigger.dev), con proyectos y claves
propios de BotMaker. En Supabase, un proyecto nuevo `botmaker-dev` y no el de AI Positioning: la instalación de
desarrollo trae una copia reducida del núcleo de CampaignSuite que pisaría el real, y las pruebas no tienen que tocar
los datos de AI Positioning. El ingreso con Google se configura de cero con el Gmail de CampaignSuite.

**Regla de las claves:** nunca pasan por el chat, por documentos, por correos ni por archivos que se comparten. Viven en
las variables de entorno de cada servicio y, en la Mac, en `apps/web/.env.local` (permisos 600, valores entre comillas
dobles), que se carga con `scripts/cargar-variable.sh` sin que se vean en pantalla.

## 0. La demo, sin ninguna cuenta

```bash
cd ~/botmaker
pnpm install
pnpm dev
```

Abrí http://localhost:3000, elegí una persona y recorré BotMaker con cada rol. Todo es en memoria y los motores son
simulados: no gasta nada. `Ctrl+C` para cortar.

Si `pnpm install` avisa de otra versión de pnpm: el repositorio fija pnpm 10.28 (como CampaignSuite) y pnpm la baja
sola. Si se queja de "Ignored build scripts: esbuild", corré `pnpm approve-builds esbuild` y de nuevo `pnpm install`.

## 1. GitHub

1. En GitHub, con la cuenta de CampaignSuite: **New repository** → nombre `botmaker` → **Private** → sin README,
   sin .gitignore y sin licencia (el repositorio ya los trae).
2. En la Terminal (cambiá `TU-CUENTA` por la de GitHub):

```bash
cd ~/botmaker
git remote add origin git@github.com:TU-CUENTA/botmaker.git
git push -u origin main
```

3. En GitHub → **Actions**: la corrida "Pruebas" tiene que terminar en verde. No necesita ninguna clave.

## 2. Supabase de desarrollo

1. En supabase.com, con la cuenta de CampaignSuite → **New project** → nombre `botmaker-dev` → región **South America
   (São Paulo)**. El plan gratis permite dos proyectos por usuario: `campaignsuite` y este. La contraseña de
   la base la guarda tu gestor de contraseñas; no se usa en la app.
2. **Project Settings → Data API → Exposed schemas:** sumar `core` y `bots` (además de `public`) y guardar.
3. **Authentication → URL Configuration:** Site URL `http://localhost:3000`; en Redirect URLs sumar
   `http://localhost:3000/auth/callback`.
4. **Authentication → Sign In / Providers → Google:** activarlo. El Client ID y el secreto salen de Google Cloud (paso 3)
   y se pegan directo en esa pantalla de Supabase.

## 3. Google Cloud (el ingreso con Google)

Con el Gmail de CampaignSuite (no la cuenta personal que usó AI Positioning), de cero:

0. En console.cloud.google.com: un proyecto `botmaker`; en **Google Auth Platform → Get started**, App name
   `BotMaker`, correo de soporte el Gmail de CampaignSuite, Audience **External**; en **Audience**, queda en
   **Testing** y en **Test users** se cargan los correos de quienes van a entrar.
1. **Clients → Create client** (o **APIs & Services → Credentials → Create credentials → OAuth client ID**) → tipo **Web application** → nombre
   `BotMaker dev`.
2. **Authorized redirect URIs:** `https://<ref-del-proyecto>.supabase.co/auth/v1/callback` (la dirección exacta la
   muestra Supabase en la pantalla de Google del paso 2.4).
3. Copiá el Client ID y el secreto a Supabase (paso 2.4). No los guardes en ningún archivo.
4. Si la pantalla de consentimiento está en modo de prueba, sumá como usuarios de prueba las cuentas que vayan a entrar.

## 4. La base

```bash
pnpm db:sql --dueno tu-correo@gmail.com
```

Deja dos archivos en `packages/db/salida/` (no se suben). En Supabase → **SQL Editor**:

1. Pegá todo `1-estructura.sql` y corrélo. Tiene que terminar sin errores.
2. `2-semilla.sql` se corre en el paso 6, después de tu primer ingreso.

## 5. Las variables de la app

```bash
scripts/cargar-variable.sh CAMPAIGNSUITE_DATOS          # escribí: supabase
scripts/cargar-variable.sh CAMPAIGNSUITE_URL            # escribí: http://localhost:3000
scripts/cargar-variable.sh NEXT_PUBLIC_SUPABASE_URL      # Project Settings → Data API → Project URL
scripts/cargar-variable.sh NEXT_PUBLIC_SUPABASE_ANON_KEY # Project Settings → API Keys → publishable (o anon)
scripts/cargar-variable.sh SUPABASE_SERVICE_ROLE_KEY     # Project Settings → API Keys → secret (o service_role)
scripts/cargar-variable.sh BOTS_OPENROUTER_API_KEY_VIVO
scripts/cargar-variable.sh BOTS_OPENROUTER_API_KEY_COPILOTO
scripts/cargar-variable.sh BOTS_OPENROUTER_API_KEY_FONDO
```

Cada uno pide el valor sin mostrarlo. Para OpenRouter, creá en la misma cuenta una clave nueva para BotMaker, con un
tope de gasto (Settings → API Keys → Create key → Credit limit); en desarrollo va la misma en las tres. Los
nombres están en `apps/web/.env.ejemplo`.

## 6. Primer ingreso y semilla

1. `pnpm dev` y entrá a http://localhost:3000 con Google. Vas a ver "Tu cuenta no tiene acceso": es lo esperado (todavía
   no hay organización).
2. En el SQL Editor, pegá y corré `2-semilla.sql`. Al final muestra tu rol: tiene que decir `administrador`.
3. Recargá la app: entrás a **Movimiento Otro Camino › Generales 2029 › BotMaker**.

Para probar los otros roles: ingresá una vez con otra cuenta de Google, volvé a correr `pnpm db:sql` con `--editor`,
`--agente` o `--lector` y corré de nuevo `2-semilla.sql` (no duplica nada).

## 7. La prueba que cierra la etapa 1

- Creá un bot desde **Nuevo bot**.
- En sus ajustes, **Motores y gasto → Probar un motor** con gpt-oss-120b. Tiene que responder, con demora y costo.
- En **Costos** aparece esa llamada, como uso "Pruebas", con su costo.
- Con una cuenta de cada rol, cada una ve solo lo que su rol permite.

## 8. La app pública (etapa 5): widget y página de cada bot

Es otra app (`apps/bots-publico`), en otro proyecto de Vercel de la misma cuenta, con su propia dirección `.vercel.app`.
No comparte sesión con la app del equipo: usa la clave de servicio y solo las funciones `bots.publico_*`.

En la computadora, sin cuentas: `pnpm dev:publico` y abrí http://localhost:3100/prueba (un sitio de prueba con el widget
pegado, conversando con el bot publicado de la demo). En la demo de la app del equipo también está montada en
`/publico` (por ejemplo, http://localhost:3000/publico/prueba): así lo que conversa el widget aparece en la bandeja.

Variables (los nombres están en `apps/bots-publico/.env.ejemplo`). `scripts/cargar-variable.sh` acepta el archivo como
segundo argumento:

```bash
# La clave del HMAC se genera en la computadora y va directo al archivo, sin mostrarse:
openssl rand -hex 32 | scripts/cargar-variable.sh BOTS_HASH_SECRET apps/bots-publico/.env.local
scripts/cargar-variable.sh SUPABASE_SERVICE_ROLE_KEY apps/bots-publico/.env.local
scripts/cargar-variable.sh TURNSTILE_SECRET_KEY apps/bots-publico/.env.local
```

- `BOTS_HASH_SECRET`: obligatoria con Supabase. Si se cambia, los contactos que ya escribieron empiezan de cero.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`: en Cloudflare → Turnstile → Add site, con el dominio de la
  app pública (modo "Managed"). Sin ellas no se verifica que no sea un robot y Canales lo recuerda.
- `CRON_SECRET`: el cron de Vercel (`apps/bots-publico/vercel.json`, una vez por día en el plan Hobby) llama a
  `/api/tareas` con esa clave para las alertas y el borrado por vencimiento.
- En la app del equipo, `BOTS_URL_PUBLICA` con la dirección de la app pública, para que Canales muestre el código del
  widget y la página de cada bot.

Alertas cada 10 minutos sin Trigger.dev ni Vercel Pro: pg_cron de Supabase (Database → Extensions → pg_cron) y en el
SQL Editor:

```sql
select cron.schedule('bots-alertas', '*/10 * * * *', $$select bots.tarea_revisar_alertas(now())$$);
select cron.schedule('bots-borrado', '20 6 * * *', $$select bots.tarea_borrar_vencidos(now())$$);
```
