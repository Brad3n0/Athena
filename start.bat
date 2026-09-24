@echo off
setlocal
cd /d "%~dp0"
title Athena AI

where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Get it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH" during setup.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo First run: setting up Athena AI ^(needs internet once^)...
  python -m venv .venv || goto :fail
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :fail
) else (
  rem Pick up any new requirements after an update, instant when nothing changed
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt >nul 2>nul
)

where ollama >nul 2>nul
if errorlevel 1 echo [!] Ollama was not found. Install it from https://ollama.com/download

".venv\Scripts\python.exe" -m athena %*
exit /b 0

:fail
echo Setup failed. Check your internet connection and try again.
pause
exit /b 1
