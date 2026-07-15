@echo off
chcp 65001 >nul
echo ============================================
echo   Al-Muttahida - Network Host Startup
echo ============================================
echo.

:: Get the local IP address
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set IP=%%a
)
set IP=%IP: =%

echo [INFO] Machine IP: %IP%
echo.

:: Add firewall rules (silently skip if already exist)
echo [1/4] Setting up firewall rules...
netsh advfirewall firewall show rule name="Al-Muttahida Backend API" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="Al-Muttahida Backend API" dir=in action=allow protocol=TCP localport=4000 >nul
    echo       Added rule for Backend (port 4000)
) else (
    echo       Backend rule already exists (port 4000)
)

netsh advfirewall firewall show rule name="Al-Muttahida Frontend Web" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="Al-Muttahida Frontend Web" dir=in action=allow protocol=TCP localport=5173 >nul
    echo       Added rule for Frontend (port 5173)
) else (
    echo       Frontend rule already exists (port 5173)
)

netsh advfirewall firewall show rule name="Al-Muttahida SQL Server" >nul 2>&1
if %errorlevel% neq 0 (
    netsh advfirewall firewall add rule name="Al-Muttahida SQL Server" dir=in action=allow protocol=TCP localport=1433 >nul
    echo       Added rule for SQL Server (port 1433)
) else (
    echo       SQL Server rule already exists (port 1433)
)
echo.

:: Start Backend
echo [2/4] Starting Backend on 0.0.0.0:4000 ...
cd /d "%~dp0al-muttahida-backend"
start "Al-Muttahida Backend" cmd /k "npx tsx watch src/server.ts"
echo       Backend started!
echo.

:: Wait a moment for backend to initialize
echo [3/4] Waiting for backend to initialize...
timeout /t 5 /nobreak >nul
echo       Done!
echo.

:: Start Frontend
echo [4/4] Starting Frontend on 0.0.0.0:5173 ...
cd /d "%~dp0al-muttahida-saas"
start "Al-Muttahida Frontend" cmd /k "npx vite --host 0.0.0.0"
echo       Frontend started!
echo.

echo ============================================
echo   All services are running!
echo ============================================
echo.
echo   Backend API:  http://%IP%:4000
echo   Frontend UI:  http://%IP%:5173
echo   Database:     SQL Server on %IP%:1433
echo.
echo   Other devices on the network can access:
echo   http://%IP%:5173
echo.
echo ============================================
pause
