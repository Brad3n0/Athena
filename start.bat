@echo off
setlocal
cd /d "%~dp0"
title Athena AI

rem Find a real Python 3.10+. Prefer the "py" launcher that python.org installs, since it works even
rem when Python isn't on PATH, and skip the Microsoft Store placeholder that only opens the Store.
set "PY="
for %%V in (3.12 3.13 3.11 3.10 3) do (
  if not defined PY (
    py -%%V -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=python"
)

if not exist ".venv\athena-ready" (
  if not defined PY (
    echo Python 3.10 or newer was not found.
    echo Install Python 3.12 from https://www.python.org/downloads/release/python-31210/
    echo using "Windows installer 64-bit", then run start.bat again.
    pause
    exit /b 1
  )
  echo First run: setting up Athena AI ^(needs internet once, takes a few minutes^)...
  if exist ".venv" rmdir /s /q ".venv"
  %PY% -m venv .venv || goto :venvfail
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :fail
  echo ok> ".venv\athena-ready"
) else (
  rem Pick up any new requirements after an update, instant when nothing changed
  ".venv\Scripts\python.exe" -m pip install -q -r requirements.txt >nul 2>nul
)

where ollama >nul 2>nul
if errorlevel 1 echo [!] Ollama was not found. Install it from https://ollama.com/download

".venv\Scripts\python.exe" -m athena %*
exit /b 0

:venvfail
echo Couldn't set up Athena's Python environment with: %PY%
echo Try reinstalling Python 3.12 and run start.bat again.
pause
exit /b 1

:fail
echo Setup failed while downloading Athena's parts. Check your internet connection and run start.bat again.
pause
exit /b 1
