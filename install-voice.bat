@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run start.bat once first.
  pause
  exit /b 1
)
echo Installing offline speech recognition (Whisper) and natural voice (Kokoro)...
".venv\Scripts\python.exe" -m pip install -r requirements-voice.txt || goto :fail
echo Downloading the Whisper speech model so voice works offline...
".venv\Scripts\python.exe" -m athena --preload-whisper base.en || goto :fail
echo Downloading Athena's natural voice (Kokoro, about 350 MB)...
".venv\Scripts\python.exe" -m athena --download-voice || goto :fail
echo.
echo Done! Restart Athena and click the voice button.
echo Tip: pick a different Whisper model in Settings - Voice, then run
echo    .venv\Scripts\python.exe -m athena --preload-whisper small.en
pause
exit /b 0
:fail
echo Voice install failed.
pause
exit /b 1
