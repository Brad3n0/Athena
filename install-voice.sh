#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "Run ./start.sh once first."; exit 1; }
.venv/bin/pip install -r requirements-voice.txt
.venv/bin/python -m athena --preload-whisper base.en
.venv/bin/python -m athena --preload-whisper tiny.en
.venv/bin/python -m athena --preload-whisper base || true  # other languages
.venv/bin/python -m athena --download-voice
echo "Done! Restart Athena and click the voice button."
