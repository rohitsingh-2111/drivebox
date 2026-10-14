@echo off
setlocal
title Drivebox - Local Desktop
cd /d "%~dp0"

echo.
echo   Drivebox - Local Desktop
echo   Keep this window open while using the app.
echo.

where.exe node.exe >nul 2>&1
if errorlevel 1 goto missing_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 goto old_node
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node

node -e "try{for(const p of ['express','mongoose','mongodb-memory-server','multer','cors','helmet','express-rate-limit'])require.resolve(p)}catch(e){process.exit(1)}" >nul 2>&1
if errorlevel 1 goto install_dependencies
goto check_build

:install_dependencies
echo First-time setup: downloading application packages. Internet is required.
echo Please wait until setup finishes before opening another Drivebox window.
set "MONGOMS_DISABLE_POSTINSTALL=1"
call npm install --include=dev
if errorlevel 1 goto install_failed

:check_build
if exist "client\dist\index.html" goto start_app
echo Building the interface...
call npm run build
if errorlevel 1 goto build_failed

:start_app
echo Starting local MongoDB and Drivebox...
echo The first run downloads MongoDB and may take a few minutes.
node scripts\desktop.mjs
if errorlevel 1 goto app_failed
echo Drivebox has stopped. Your saved data has been kept.
pause
exit /b 0

:missing_node
echo Node.js and npm are required. Install the Windows LTS installer from:
echo https://nodejs.org/en/download
echo Then close this window and double-click Start-Drivebox.cmd again.
pause
exit /b 1

:old_node
echo This app requires Node.js 22.12 or newer. Install the current LTS version:
echo https://nodejs.org/en/download
pause
exit /b 1

:install_failed
echo.
echo Package installation failed. Check your internet connection and the error above.
echo After correcting it, double-click Start-Drivebox.cmd to try again.
pause
exit /b 1

:build_failed
echo.
echo The interface could not be built. Copy the error above when asking for help.
pause
exit /b 1

:app_failed
echo.
echo Drivebox could not start or stopped with an error. Read the message above.
echo Your local data has not been intentionally removed.
pause
exit /b 1
