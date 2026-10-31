@echo off
setlocal
rem ---------------------------------------------------------------------
rem  One agent's own Chrome + its bridge worker.
rem
rem    start-agent-chrome.cmd <agentId> <cdpPort> <DisplayName>
rem    e.g.  start-agent-chrome.cmd rebeka 9222 Rebeka
rem
rem  The Chrome uses a DEDICATED profile folder (not your everyday one) because
rem  Chrome 136+ refuses remote debugging on the default profile. Sign in to the
rem  sites that agent needs, once, inside this window — the profile keeps the
rem  cookies. The worker then answers the agent's browse_chrome_session requests
rem  (read-only, only the sites you tick for that task).
rem ---------------------------------------------------------------------
set "AGENT=%~1"
set "PORT=%~2"
set "NAME=%~3"
if "%AGENT%"=="" (echo usage: start-agent-chrome.cmd ^<agentId^> ^<cdpPort^> ^<DisplayName^> & exit /b 2)
if "%PORT%"=="" (echo usage: start-agent-chrome.cmd ^<agentId^> ^<cdpPort^> ^<DisplayName^> & exit /b 2)
if "%NAME%"=="" set "NAME=%AGENT%"

title %NAME% Chrome worker
set "WEBDIR=%~dp0.."
set "PROFILE=%USERPROFILE%\.carbonature-agent-chrome\%AGENT%"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (echo Chrome was not found. & pause & exit /b 1)

rem Already running on this port? Then only (re)start the worker.
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:%PORT%/json/version) | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "" "%CHROME%" --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --window-position=40,40 "data:text/html,<title>%NAME% Chrome</title><body style='font-family:sans-serif;padding:40px'><h2>%NAME% Chrome</h2><p>This is %NAME%'s own browser. Sign in here to the sites %NAME% should be able to read. Do not close it.</p></body>"
  timeout /t 6 /nobreak >nul
)

cd /d "%WEBDIR%" || exit /b 1
node scripts\agent-chrome-worker.mjs %AGENT% %PORT%
