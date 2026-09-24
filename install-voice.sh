#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Run ./start.sh once first."; exit 1; }
.venv/bin/pip install -r requirements-voice.txt
.venv/bin/python -m athena --preload-whisper base.en
echo "Done! Restart Athena and click the voice button."
