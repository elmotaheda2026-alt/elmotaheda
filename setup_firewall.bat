@echo off
echo ============================================
echo   Al-Muttahida - Firewall Setup Script
echo ============================================
echo.
echo Adding firewall rules for Backend (port 4000) and Frontend (port 5173)...
echo.

netsh advfirewall firewall add rule name="Al-Muttahida Backend API" dir=in action=allow protocol=TCP localport=4000
netsh advfirewall firewall add rule name="Al-Muttahida Frontend Web" dir=in action=allow protocol=TCP localport=5173

echo.
echo ============================================
echo   Done! Firewall rules added successfully.
echo ============================================
echo.
pause
