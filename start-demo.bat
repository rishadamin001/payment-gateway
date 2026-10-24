@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24, then run start-demo.bat again.
  pause
  exit /b 1
)
node scripts\windows-start.mjs
if errorlevel 1 (
  echo.
  echo Demo did not start. Read the message above. No database was deleted.
  pause
  exit /b 1
)
endlocal
