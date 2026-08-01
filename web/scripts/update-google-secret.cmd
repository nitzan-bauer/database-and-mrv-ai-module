@echo off
setlocal
title Update Google client secret

rem ---------------------------------------------------------------------
rem  Double-click wrapper around scripts/set-oauth-secret.mjs.
rem
rem  The secret has been pasted into the wrong place twice: once into a
rem  chat, once as a loose line at the bottom of .env.local, where nothing
rem  reads it because the file only parses KEY=value. Both times the symptom
rem  was a sign-in that failed for no visible reason.
rem
rem  So this exists to remove every step where that can happen: no terminal
rem  to open, no file to find, no line to edit. Paste at the prompt and the
rem  script writes it to the right key.
rem ---------------------------------------------------------------------

cd /d "%~dp0.." || (echo Could not find the web folder next to this script. & pause & exit /b 1)

where node >nul 2>&1 || (echo Node.js is not on PATH — install it first. & pause & exit /b 1)

echo.
echo   CarboNature MRV — update the Google client secret
echo.
echo   Create the new secret first:
echo     Google Cloud Console  -^>  APIs ^& Services  -^>  Credentials
echo     -^>  CarboNature MRV  -^>  + ADD SECRET,  then delete the old one.
echo.
echo   Then paste it below. Nothing appears as you paste — that is
echo   deliberate, so the secret never lands in this window's history.
echo.

node scripts\set-oauth-secret.mjs
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo   Nothing was changed.
) else (
  echo   Now close the CarboNature MRV window and open it again,
  echo   so the server picks up the new secret.
)
echo.
pause
