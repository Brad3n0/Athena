@echo off
setlocal
cd /d "%~dp0"
title Athena - custom voice setup

rem The custom voice (Chatterbox) needs big libraries of its own, so it gets its own folder
rem (.venv-voiceclone). That way it can never clash with, or break, the rest of Athena.

set "PY="
for %%V in (3.12 3.11 3.10 3.13) do (
  if not defined PY (
    py -%%V -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.10 or newer was not found. Run start.bat first - it explains how to install Python.
  pause
  exit /b 1
)

echo Setting up Athena's custom voice. This downloads about 3-4 GB and can take a while.
echo.
if not exist ".venv-voiceclone\Scripts\python.exe" (
  %PY% -m venv .venv-voiceclone || goto :fail
)
".venv-voiceclone\Scripts\python.exe" -m pip install --upgrade pip >nul
".venv-voiceclone\Scripts\python.exe" -m pip install chatterbox-tts || goto :fail
echo.
echo Downloading the voice model...
".venv-voiceclone\Scripts\python.exe" -c "from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cpu'); print('Voice model ready.')" || goto :fail
echo.
echo Done! Start Athena, then go to Settings - Voice - Custom voice to add the recording.
pause
exit /b 0

:fail
echo.
echo The custom voice setup didn't finish. Check your internet connection and run this again.
echo If it keeps failing, take a photo of the error above and ask for help.
pause
exit /b 1
