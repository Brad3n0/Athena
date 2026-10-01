@echo off
cd /d "%~dp0"
title Making Athena.exe
if not exist ".venv\athena-ready" (
  echo Run start.bat once first to set Athena up.
  pause
  exit /b 1
)
echo Making Athena.exe (about a minute)...
".venv\Scripts\python.exe" -c "from athena import desktop; r = desktop.build_exe(); print(r.get('note') or r.get('error'))"
pause
