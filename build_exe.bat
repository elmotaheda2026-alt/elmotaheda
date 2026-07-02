@echo off
echo ============================================
echo   Al-Muttahida ERP - Build .exe Installer
echo ============================================
echo.

set CACHE_DIR=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign
set TARGET_DIR=%CACHE_DIR%\winCodeSign-2.6.0

REM Step 1: Check if winCodeSign-2.6.0 already exists and is valid
if exist "%TARGET_DIR%\windows-10" (
    echo [1/3] winCodeSign cache already exists. Skipping download.
    goto :build
)

REM Step 2: Download and extract winCodeSign manually
echo [1/3] Setting up winCodeSign cache...
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"

REM Download the archive
echo Downloading winCodeSign-2.6.0...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z' -OutFile '%CACHE_DIR%\winCodeSign-2.6.0.7z'"

if not exist "%CACHE_DIR%\winCodeSign-2.6.0.7z" (
    echo ERROR: Failed to download winCodeSign archive.
    pause
    exit /b 1
)

REM Find 7za.exe - check common locations
set SEVENZIP=
if exist "C:\Program Files\7-Zip\7z.exe" set SEVENZIP="C:\Program Files\7-Zip\7z.exe"
if exist "C:\Program Files (x86)\7-Zip\7z.exe" set SEVENZIP="C:\Program Files (x86)\7-Zip\7z.exe"

REM Also check the pnpm/npm cache for 7zip-bin
for /f "delims=" %%i in ('where 7za.exe 2^>nul') do set SEVENZIP="%%i"

REM Check in node_modules
if "%SEVENZIP%"=="" (
    for /f "delims=" %%i in ('dir /s /b "C:\tmp\al-muttahida-saas\.pnpm\7zip-bin*\win\x64\7za.exe" 2^>nul') do set SEVENZIP="%%i"
)

if "%SEVENZIP%"=="" (
    REM Use PowerShell as fallback to extract
    echo Extracting with PowerShell...
    powershell -Command "& { $7zPath = Get-ChildItem -Path 'C:\tmp' -Recurse -Filter '7za.exe' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($7zPath) { & $7zPath.FullName x -bd -y '%CACHE_DIR%\winCodeSign-2.6.0.7z' -o'%TARGET_DIR%' } else { echo 'ERROR: 7za.exe not found' } }"
) else (
    echo Extracting with 7-Zip...
    %SEVENZIP% x -bd -y "%CACHE_DIR%\winCodeSign-2.6.0.7z" -o"%TARGET_DIR%"
)

REM Step 3: Create dummy files for macOS symlinks (not needed on Windows)
echo [2/3] Fixing macOS symlink files...
set DARWIN_LIB=%TARGET_DIR%\darwin\10.12\lib
if not exist "%DARWIN_LIB%" mkdir "%DARWIN_LIB%"
if not exist "%DARWIN_LIB%\libcrypto.dylib" echo. > "%DARWIN_LIB%\libcrypto.dylib"
if not exist "%DARWIN_LIB%\libssl.dylib" echo. > "%DARWIN_LIB%\libssl.dylib"
echo Symlink files fixed.

:build
echo [3/3] Building .exe installer...
cd /d "C:\Users\Eng\projects\elmotaheda\al-muttahida-saas"
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win --x64

echo.
if %ERRORLEVEL% EQU 0 (
    echo ============================================
    echo   BUILD SUCCESSFUL!
    echo   The installer is in: al-muttahida-saas\release\
    echo ============================================
) else (
    echo ============================================
    echo   Build failed. Check the errors above.
    echo ============================================
)
echo.
pause
