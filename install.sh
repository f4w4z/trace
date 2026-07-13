#!/usr/bin/env bash
# One-command installer for trace (Local Context Cloud) on Linux / WSL2.
set -euo pipefail

say()  { printf '\033[36m%s\033[0m\n' "$1"; }
warn() { printf '\033[33mwarning: %s\033[0m\n' "$1"; }

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing prerequisite: $1 — $2" >&2; exit 1; }; }

say "== trace installer =="

need node    "install from https://nodejs.org"
need docker  "install Docker Engine (https://docs.docker.com/engine/install)"
need git     "install git"

say "[1/5] Installing npm dependencies..."
npm install

say "[2/5] Building TypeScript..."
npm run build

say "[3/5] Configuring .env..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then cp .env.example .env && echo "  created .env from .env.example"; fi
else
  echo "  .env already exists, leaving it untouched"
fi

say "[4/5] Starting Supermemory Local (docker compose)..."
if [ -f docker-compose.yml ]; then docker compose up -d; else warn "docker-compose.yml not found; start Supermemory manually"; fi

say "[5/5] Launching trace under watchdog..."
nohup npm run watchdog >/tmp/trace.log 2>&1 &
echo "trace is starting (pid $!). Open http://localhost:6769 for the HUD."
