@echo off
rem Starts the live poller for today's NFL games. Logs to data\live-YYYY-MM-DD.log. Safe to run twice: the second copy exits if one is already running.
cd /d "%~dp0"
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%a-%%b
tasklist /fi "WINDOWTITLE eq jev-nfl-live" | find /i "node.exe" >nul && (echo already running & exit /b 0)
title jev-nfl-live
node src\live.mjs >> "data\live-%D%.log" 2>&1
