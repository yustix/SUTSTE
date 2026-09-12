#!/usr/bin/env bash
# Arranca SUT STE asegurando dependencias y compilación.
# Útil cuando el entorno se reinicia y node_modules/.next ya no existen.
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[sut-ste] Instalando dependencias..."
  npm ci --no-audit --no-fund
fi

if [ ! -d .next ]; then
  echo "[sut-ste] Compilando..."
  npm run build
fi

echo "[sut-ste] Iniciando servidor en http://0.0.0.0:3000"
exec npm run start
