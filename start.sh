#!/usr/bin/env bash
# Athena AI launcher for Linux / macOS
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "First run: setting up Athena AI (needs internet once)..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip >/dev/null
  .venv/bin/pip install -r requirements.txt
else
  .venv/bin/pip install -q -r requirements.txt >/dev/null 2>&1 || true
fi
command -v ollama >/dev/null || echo "[!] Ollama not found. Install it from https://ollama.com/download"
exec .venv/bin/python -m athena "$@"
