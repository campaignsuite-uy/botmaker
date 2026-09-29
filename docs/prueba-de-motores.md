# Prueba de motores

La prueba del 28/9/2026 ahora vive en el repositorio y usa la capa de motores del producto: las mismas instrucciones,
la doble lectura, las reglas antes del motor, el material en secciones y el validador de datos.

## Qué necesita

La clave de tareas de fondo en `apps/web/.env.local` (con permisos 600, nunca en el chat):

```bash
scripts/cargar-variable.sh BOTS_OPENROUTER_API_KEY_FONDO
```

## Cómo se corre

```bash
pnpm motores:interpretar                 # los 218 mensajes con los motores por defecto: el par en doble lectura y cada uno solo
pnpm motores:responder                   # las 72 preguntas con el material de prueba, con juez
pnpm motores:interpretar --limite 20     # una prueba corta
pnpm motores:responder --sin-juez        # sin el juez (más barato)
pnpm motores:interpretar --simular       # sin llamar a nadie: sirve para ver que todo anda
```

Combinaciones en `--motores`, separadas por comas: `a` solo, `a>b` con respaldo en serie, `a+b` en doble lectura
(solo interpretar). Por ejemplo `--motores gemini-3.1-flash-lite+gpt-oss-120b,claude-haiku-4.5`. Un motor apagado se
prueba con `--incluir-apagados`. `--paralelo 3` es la cantidad de llamadas a la vez (Anthropic limita las cuentas nuevas
a 20 por minuto).

## Qué deja

`resultados/<fecha>-<prueba>/resultados.xlsx` (Resumen, una fila por mensaje o pregunta, y cada llamada con su costo)
y `llamadas.jsonl`. La carpeta `resultados/` no se sube al repositorio.

- Interpretar: acierto, acierto cuando las dos lecturas coinciden, cuántos mensajes terminarían en la pregunta de
  aclaración (solo cuando las dos intenciones llevan a lugares distintos), acierto de tema, demora y costo por 1000.
  La meta de la plantilla (tarea 2.14): 99 % de acierto cuando coinciden y aclaración en no más del 12 %.
- Responder: exactitud del juez (0 a 2), exactas, inventa, cortadas por el validador, si reconoce lo que falta, demora
  y costo. Las preguntas que un motor no contesta (error o sin respuesta a tiempo) se cuentan aparte, no como
  exactitud 0. El juez ve el material completo.
