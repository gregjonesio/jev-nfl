@echo off
rem Starts the live poller for today's NFL games. Logs to data\live-YYYY-MM-DD.log. Safe to run twice: the second copy exits if one is already running.
cd /d "%~dp0"
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%a-%%b
tasklist /fi "WINDOWTITLE eq jev-nfl-live" | find /i "node.exe" >nul && (echo already running & exit /b 0)
title jev-nfl-live
:loop
node src\live.mjs >> "data\live-%D%.log" 2>&1
set RC=%ERRORLEVEL%
rem 0 = stop time reached (or replay done); 1 = config error (missing INGEST_TOKEN), do not spin on it; anything else = crash, relaunch
if "%RC%"=="0" exit /b 0
if "%RC%"=="1" exit /b 1
echo %time% poller exited with code %RC%, restarting in 30s >> "data\live-%D%.log"
timeout /t 30 /nobreak >nul
goto loop
