@echo off
setlocal enabledelayedexpansion

:: Print colorful status messages
call :print_status "Checking Node.js and npm installation..."

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [31m==^>[0m [1mNode.js is not installed. Please install Node.js first.[0m
    exit /b 1
)

:: Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [31m==^>[0m [1mnpm is not installed. Please install npm first.[0m
    exit /b 1
)

:: Print Node.js and npm versions
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo [34m==^>[0m [1mUsing Node.js !NODE_VERSION! and npm !NPM_VERSION![0m

:: Install root dependencies
echo [34m==^>[0m [1mInstalling root dependencies...[0m
call npm install
if %ERRORLEVEL% neq 0 (
    echo [31m==^>[0m [1mFailed to install root dependencies[0m
    exit /b 1
)

:: Install server dependencies
echo [34m==^>[0m [1mInstalling server dependencies...[0m
cd server
call npm install
if %ERRORLEVEL% neq 0 (
    echo [31m==^>[0m [1mFailed to install server dependencies[0m
    exit /b 1
)
cd ..

:: Install client dependencies
echo [34m==^>[0m [1mInstalling client dependencies...[0m
cd packages\client
call npm install
if %ERRORLEVEL% neq 0 (
    echo [31m==^>[0m [1mFailed to install client dependencies[0m
    exit /b 1
)
cd ..\..

echo [32m==^>[0m [1mAll dependencies have been installed successfully![0m
echo [34m==^>[0m [1mYou can now start the applications:[0m
echo 1. Start the server: cd server ^&^& npm run start:server1
echo 2. Start the client: cd packages\client ^&^& npm run dev

exit /b 0

:print_status
echo [34m==^>[0m [1m%~1[0m
goto :eof 