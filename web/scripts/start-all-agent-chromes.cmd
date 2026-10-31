@echo off
rem ---------------------------------------------------------------------
rem  Starts every agent's own Chrome + bridge worker, each in its own minimized
rem  window. Registered to run at logon (see docs/superpowers/plans). To skip an
rem  agent, delete its line. One CDP port per agent, never shared.
rem ---------------------------------------------------------------------
set "HERE=%~dp0"
start "Rebeka Chrome worker"   /min cmd /c ""%HERE%start-agent-chrome.cmd" rebeka   9222 Rebeka"
start "Dave Chrome worker"     /min cmd /c ""%HERE%start-agent-chrome.cmd" dave     9223 Dave"
start "John Chrome worker"     /min cmd /c ""%HERE%start-agent-chrome.cmd" john     9224 John"
start "Ron Chrome worker"      /min cmd /c ""%HERE%start-agent-chrome.cmd" ron      9225 Ron"
start "Jennifer Chrome worker" /min cmd /c ""%HERE%start-agent-chrome.cmd" jennifer 9226 Jennifer"
