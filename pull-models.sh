#!/usr/bin/env bash
set -e
command -v ollama >/dev/null || { echo "Install Ollama first: https://ollama.com/download"; exit 1; }
cat <<'MENU'

 Athena AI - download recommended models
 How much VRAM does your graphics card have? (Apple Silicon: use your unified memory)

  1) No GPU / under 6 GB    qwen3:4b, qwen2.5-coder:3b
  2) 8 GB                   qwen3:8b (chat + study), qwen2.5-coder:7b, qwen3:4b
  3) 12 - 16 GB             gpt-oss:20b, qwen3:14b (best for study), qwen2.5-coder:14b, qwen3:4b
  4) 24 GB or more          gpt-oss:20b, qwen3-coder:30b, qwen3:14b (best for study), qwen3:4b

MENU
read -rp "Choose 1-4: " tier
case "$tier" in
  1) models="qwen3:4b qwen2.5-coder:3b" ;;
  2) models="qwen3:8b qwen2.5-coder:7b qwen3:4b" ;;
  3) models="gpt-oss:20b qwen3:14b qwen2.5-coder:14b qwen3:4b" ;;
  4) models="gpt-oss:20b qwen3-coder:30b qwen3:14b qwen3:4b" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac
for m in $models; do echo; echo "=== Downloading $m ==="; ollama pull "$m"; done
read -rp "Also download qwen2.5vl:7b so Athena can read photos of worksheets and notes (6 GB)? (y/n): " vis
case "$vis" in y|Y) ollama pull qwen2.5vl:7b ;; esac
echo; echo "All done. Start Athena with ./start.sh"
