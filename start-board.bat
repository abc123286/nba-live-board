@echo off
title NBA Live Board helper - keep this window open while watching games
cd /d "%~dp0"
where python >nul 2>nul && (set PY=python) || (set PY=py)
%PY% --version >nul 2>nul || (
  echo Python is not installed. Get it free from https://www.python.org/downloads/
  echo During install, tick "Add python.exe to PATH". Then double-click this file again.
  pause
  exit /b
)
start "" "https://abc123286.github.io/nba-live-board/"
echo Helper is running. Leave this window open. Close it when you are done.
%PY% relay.py
pause
