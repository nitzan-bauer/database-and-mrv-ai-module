@echo off
setlocal
title CarboNature MRV

rem ---------------------------------------------------------------------
rem  Launcher behind the desktop shortcut.
rem
rem  Starts the MRV module and opens it in the default browser. The window
rem  stays open because it *is* the server — closing it stops the app.
rem
rem  Paths are derived from this script's own location, so the shortcut
rem  keeps working if the repository moves.
rem ---------------------------------------------------------------------

set "WEBDIR=%~dp0.."
set "PORT=3007"
set "URL=http://localhost:%PORT%/projects"

cd /d "%WEBDIR%" || (echo Could not find the web folder next to this script. & pause & exit /b 1)

where npm >nul 2>&1 || (echo npm is not on PATH — install Node.js first. & pause & exit /b 1)

if not exist "node_modules\" (
  echo First run: installing dependencies. This takes a minute.
  call npm install --no-audit --no-fund || (echo Install failed. & pause & exit /b 1)
)

echo.
echo   CarboNature MRV
echo   starting on %URL%
echo.
echo   Leave this window open while you use the app.
echo   Close it, or press Ctrl+C, to stop the server.
echo.

rem Open the browser once the port answers, without blocking the server.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "for ($i=0; $i -lt 60; $i++) { try { Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Process '%URL%'; break } catch { Start-Sleep -Seconds 2 } }"

call npm run dev -- -p %PORT%

echo.
echo   Server stopped.
pause
