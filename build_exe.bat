@echo off
echo ============================================
echo   Al-Muttahida ERP - Build .exe Installer
echo ============================================
echo.

REM Step 1: Enable Developer Mode (allows symlinks without admin)
echo [1/3] Enabling Developer Mode for symlink support...
reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1 >nul 2>&1

REM Step 2: Clean old winCodeSign cache
echo [2/3] Cleaning electron-builder cache...
rmdir /S /Q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" >nul 2>&1

REM Step 3: Build the exe
echo [3/3] Building .exe installer...
cd /d "C:\Users\Eng\projects\elmotaheda\al-muttahida-saas"
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
