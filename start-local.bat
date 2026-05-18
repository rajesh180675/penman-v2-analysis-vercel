@echo off
echo.
echo   Penman V2 Analysis - Local Mode
echo   ================================
echo.
echo   Starting local server + Vite dev server...
echo   Data stored in: %USERPROFILE%\.penman-data\
echo.
echo   Once ready, open: http://localhost:5173
echo.
cd /d "%~dp0"
npm run dev:local
