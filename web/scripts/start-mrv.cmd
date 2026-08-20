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

rem ---------------------------------------------------------------------
rem  The port is not negotiable, so refuse rather than drift off it.
rem
rem  Next picks the next free port when 3007 is taken, and says so in a line
rem  that scrolls past. Google then rejects the sign-in with
rem  redirect_uri_mismatch, because the OAuth client registers exactly
rem  http://localhost:3007/api/auth/callback/google — leaving a broken login
rem  and no obvious cause. Better to stop here and name the reason.
rem ---------------------------------------------------------------------
netstat -ano -p tcp | findstr /r /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Port %PORT% is already in use.
  echo.
  echo   The MRV module has to run on %PORT%: that is the address registered
  echo   with Google, and sign-in fails on any other. Close the other window
  echo   running the server ^(or whatever is holding the port^), then start
  echo   this again.
  echo.
  echo   To see what is holding it:   netstat -ano ^| findstr :%PORT%
  echo.
  pause
  exit /b 1
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

rem ---------------------------------------------------------------------
rem  Next is invoked directly (node_modules\.bin\next.cmd), not through
rem  "npm run dev". npm.cmd is itself another process hop — cmd.exe spawns
rem  node to run npm-cli.js, which spawns a THIRD process for next dev —
rem  and closing this console window does not reliably kill that deep a
rem  chain on Windows: the actual server can survive as an orphan, still
rem  holding the port, so the next launch always refuses with "port in
rem  use" even though the window is gone. One hop closer to the console
rem  terminates cleanly.
rem
rem  "npm run dev" also runs the predev hook (clean:conflicts, resolving
rem  OneDrive sync-conflict files) before starting — invoking next
rem  directly skips that, so it is run explicitly here instead.
rem ---------------------------------------------------------------------
call npm run clean:conflicts
call "node_modules\.bin\next.cmd" dev -p %PORT%

echo.
echo   Server stopped.
pause
