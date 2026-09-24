@echo off
cd /d "%~dp0"
if not exist ".venv\athena-ready" (
  echo Run start.bat once first to set Athena up.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt >nul 2>nul
start "" ".venv\Scripts\pythonw.exe" -m athena --desktop
