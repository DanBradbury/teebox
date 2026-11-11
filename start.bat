@echo off
title Driving Range
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
start "" http://localhost:3000
node server.js %1
pause
