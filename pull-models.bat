@echo off
setlocal
where ollama >nul 2>nul
if errorlevel 1 (
  echo Install Ollama first: https://ollama.com/download
  pause
  exit /b 1
)
echo.
echo  Athena AI - download recommended models
echo  How much VRAM does your graphics card have?
echo  (Task Manager ^> Performance ^> GPU ^> "Dedicated GPU memory")
echo.
echo   1^) No GPU / under 6 GB    qwen3:4b, qwen2.5-coder:3b
echo   2^) 8 GB                   qwen3:8b, qwen2.5-coder:7b, qwen3:4b
echo   3^) 12 - 16 GB             gpt-oss:20b, qwen3:14b, qwen2.5-coder:14b, qwen3:4b
echo   4^) 24 GB or more          gpt-oss:20b, qwen3-coder:30b, qwen3:14b, qwen3:4b
echo.
set /p tier="Choose 1-4: "
if "%tier%"=="1" set MODELS=qwen3:4b qwen2.5-coder:3b
if "%tier%"=="2" set MODELS=qwen3:8b qwen2.5-coder:7b qwen3:4b
if "%tier%"=="3" set MODELS=gpt-oss:20b qwen3:14b qwen2.5-coder:14b qwen3:4b
if "%tier%"=="4" set MODELS=gpt-oss:20b qwen3-coder:30b qwen3:14b qwen3:4b
if not defined MODELS (
  echo Invalid choice.
  pause
  exit /b 1
)
for %%m in (%MODELS%) do (
  echo.
  echo === Downloading %%m ===
  ollama pull %%m
)
echo.
echo All done. Start Athena with start.bat
pause
