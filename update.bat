@echo off
rem Updates Athena to the newest version from GitHub. Your chats, settings and downloads in "data" and ".venv" are kept.
rem It runs a copy of itself from the temp folder, because Windows gets confused if a running .bat file is replaced.
if /i not "%~1"=="--from-temp" (
  copy /y "%~f0" "%TEMP%\athena-update.bat" >nul
  "%TEMP%\athena-update.bat" --from-temp "%~dp0"
)
setlocal
cd /d "%~2"
title Update Athena AI
set "REPO=https://github.com/Dominationdrago/Athena.git"
set "BRANCH=claude/athena-ai-offline-website-j31mcs"

where git >nul 2>nul
if errorlevel 1 (
  echo Athena uses Git to download updates. Installing Git now, one time only...
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
)
where git >nul 2>nul
if errorlevel 1 goto :nogit

if not exist ".git" (
  echo Connecting this folder to GitHub, one time only...
  git init -q || goto :fail
  git remote add origin %REPO%
)
echo.
echo Checking GitHub for updates...
echo If a GitHub sign-in window opens, sign in. Your repo is private, and it only asks once.
git fetch origin %BRANCH% || goto :fail
rem Keep any changes Athena made to her own code ("fix yourself"): set them aside, update, then put them back.
set "SELFCHANGES="
git rev-parse -q --verify HEAD >nul 2>nul && (git diff --quiet HEAD || set "SELFCHANGES=1")
if defined SELFCHANGES git stash push --include-untracked -q -m "Athena's own changes (before update.bat)"
git reset -q --hard FETCH_HEAD || goto :fail
if defined SELFCHANGES (
  git stash apply -q >nul 2>nul && git stash drop -q >nul 2>nul && echo Athena's changes to her own code were kept.
  if errorlevel 1 (
    git reset -q --hard FETCH_HEAD
    echo The update changed the same code Athena had changed herself, so her changes were set aside.
  )
)
echo.
echo Updated! Newest change:
git log -1 --format="   %%s  (%%cr)"
echo.
echo Close Athena's black window if it is open, then double-click start to use the new version.
pause
exit /b 0

:nogit
echo.
echo Couldn't install Git automatically. Get it from https://git-scm.com/download/win
echo (the default options are fine), then double-click update again.
pause
exit /b 1

:fail
echo.
echo The update didn't finish. Check your internet connection and that you signed in to GitHub,
echo then double-click update again. Your chats and settings are safe.
pause
exit /b 1
