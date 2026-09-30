#!/usr/bin/env bash
# Guarda una variable de entorno en apps/web/.env.local sin mostrarla en pantalla ni dejarla en el historial.
# El archivo queda con permisos 600 y el valor entre comillas dobles. Si la variable ya estaba, la reemplaza.
#
# Uso (desde la carpeta del repositorio):
#   scripts/cargar-variable.sh SUPABASE_SERVICE_ROLE_KEY
#   scripts/cargar-variable.sh BOTS_OPENROUTER_API_KEY_VIVO
#   pbpaste | scripts/cargar-variable.sh BOTS_TAREAS_SECRET        (lo que está en el portapapeles)
#   openssl rand -hex 32 | tee >(pbcopy) | scripts/cargar-variable.sh BOTS_TAREAS_SECRET
#                                        (inventa una clave: queda en el archivo y en el portapapeles, sin verse)
#
# El .env.local nunca se sube ni se manda: está en .gitignore.
set -euo pipefail
umask 077

NOMBRE="${1:-}"
ARCHIVO="${2:-apps/web/.env.local}"
if [[ ! "$NOMBRE" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "Uso: scripts/cargar-variable.sh NOMBRE_DE_LA_VARIABLE"
  exit 1
fi

VALOR=""
if [[ -t 0 ]]; then
  read -r -s -p "Pegá el valor de $NOMBRE y apretá Enter (no se ve al pegar): " VALOR || true
  echo
else
  # Por tubería (pbpaste, openssl): lo copiado de una página suele venir sin salto de línea al final, y read lo
  # tomaba como error (con set -e, el script terminaba sin decir nada). Se lee igual.
  IFS= read -r VALOR || true
fi
# Sin espacios ni saltos de línea al principio ni al final (se cuelan al copiar de una página).
VALOR="${VALOR#"${VALOR%%[![:space:]]*}"}"
VALOR="${VALOR%"${VALOR##*[![:space:]]}"}"
if [[ -z "$VALOR" ]]; then
  echo "No pegaste nada: no se guardó."
  exit 1
fi
if [[ "$VALOR" == *'"'* ]]; then
  echo "El valor tiene comillas dobles: revisalo, no se guardó."
  exit 1
fi

touch "$ARCHIVO"
chmod 600 "$ARCHIVO"
grep -v "^${NOMBRE}=" "$ARCHIVO" > "$ARCHIVO.tmp" || true
printf '%s="%s"\n' "$NOMBRE" "$VALOR" >> "$ARCHIVO.tmp"
mv "$ARCHIVO.tmp" "$ARCHIVO"
chmod 600 "$ARCHIVO"
unset VALOR
echo "Listo: $NOMBRE quedó en $ARCHIVO (permisos 600)."
