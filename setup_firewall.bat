@echo off
echo ============================================
echo   Al-Muttahida - Firewall Setup Script
echo ============================================
echo.
echo Adding firewall rules for AlMuttahida ERP (ports 1433, 5000, 4000, 5173)...
echo.

netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,5000
netsh advfirewall firewall add rule name="Al-Muttahida Backend API" dir=in action=allow protocol=TCP localport=4000
netsh advfirewall firewall add rule name="Al-Muttahida Frontend Web" dir=in action=allow protocol=TCP localport=5173

echo.
echo ============================================
echo   Done! Firewall rules added successfully.
echo ============================================
echo.
pause
