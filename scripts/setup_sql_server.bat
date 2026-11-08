@echo off
chcp 65001 >nul
title شركة المتحدة ERP - تهيئة محرك البيانات والشبكة
color 0b

echo ===============================================================
echo     شركة المتحدة ERP - أداة إعداد محرك البيانات وجدار الحماية
echo ===============================================================
echo.

:: Check for Administrator Privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] تنبيه: يرجى تشغيل هذا الملف كمسؤول (Run as administrator).
    echo [!] اضغط كليك يمين على الملف واختر "تشغيل كمسؤول".
    echo.
    pause
    exit /b 1
)

echo [1/3] فتح منافذ جدار الحماية (Windows Firewall Rules)...
netsh advfirewall firewall delete rule name="AlMuttahida ERP Ports" >nul 2>&1
netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,4000,5000,5173 >nul
echo [+] تم فتح المنافذ (1433, 4000, 5173) في جدار الحماية بنجاح.
echo.

echo [2/3] فحص خدمة SQL Server على الجهاز...
set SQL_RUNNING=0

sc query "MSSQLSERVER" >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] تم العثور على خدمة SQL Server (MSSQLSERVER).
    sc config "MSSQLSERVER" start= auto >nul 2>&1
    net start "MSSQLSERVER" >nul 2>&1
    set SQL_RUNNING=1
)

sc query "MSSQL$SQLEXPRESS" >nul 2>&1
if %errorLevel% equ 0 (
    echo [+] تم العثور على خدمة SQL Server Express (MSSQL$SQLEXPRESS).
    sc config "MSSQL$SQLEXPRESS" start= auto >nul 2>&1
    net start "MSSQL$SQLEXPRESS" >nul 2>&1
    set SQL_RUNNING=1
)

if %SQL_RUNNING% equ 1 (
    echo [+] تم التأكد من تشغيل خدمة SQL Server وضبطها على التشغيل التلقائي.
) else (
    echo [!] لم يتم العثور على خدمة SQL Server مثبتة على هذا الجهاز.
    echo [!] يمكنك تحميل نسخة SQL Server Express المجانية من مايكروسوفت:
    echo     https://www.microsoft.com/en-us/sql-server/sql-server-downloads
)
echo.

echo [3/3] فحص المنفذ 1433...
netstat -ano | findstr :1433 >nul 2>&1
if %errorLevel% equ 0 (
    echo [V] المنفذ 1433 مفتوح ومستعد لاستقبال اتصالات السيرفر والأجهزة الفرعية!
) else (
    echo [i] ملاحظة: تأكد من تفعيل بروتوكول TCP/IP في SQL Server Configuration Manager.
)
echo.

echo ===============================================================
echo     اكتمل الإعداد! يمكنك الآن تشغيل برنامج المتحدة ERP.
echo ===============================================================
echo.
pause

