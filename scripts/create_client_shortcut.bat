@echo off
chcp 65001 >nul
title شركة المتحدة ERP - إنشاء اختصار الجهاز الفرعي
color 0a

echo ===============================================================
echo     شركة المتحدة ERP - أداة ربط الجهاز الفرعي (Client Shortcut)
echo ===============================================================
echo.
echo هذه الأداة تتيح لأي جهاز كمبيوتر أو كاشير آخر في المحل
echo العمل فورياً كـ "جهاز فرعي" بدون الحاجة لتثبيت أي برامج أو قواعد بيانات!
echo.

set /p SERVER_IP="أدخل عنوان IP السيرفر الرئيسي (مثال: 192.168.1.9): "

if "%SERVER_IP%"=="" (
    echo [!] لم يتم إدخال عنوان IP. تم الإلغاء.
    pause
    exit /b 1
)

:: Locate Browser (Edge or Chrome)
set BROWSER_PATH=""

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set BROWSER_PATH="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set BROWSER_PATH="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set BROWSER_PATH="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set BROWSER_PATH="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)

if %BROWSER_PATH%=="" (
    echo [!] لم يتم العثور على متصفح Edge أو Chrome. سيتم إنشاء اختصار ويب قياسي.
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\المتحدة ERP.url'); $s.TargetPath = 'http://%SERVER_IP%:5173'; $s.Save()"
) else (
    echo [+] تم تحديد المتصفح: %BROWSER_PATH%
    powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\المتحدة ERP.lnk'); $s.TargetPath = %BROWSER_PATH%; $s.Arguments = '--app=http://%SERVER_IP%:5173 --window-size=1366,768'; $s.Description = 'المتحدة ERP'; $s.Save()"
)

echo.
echo [+] تم إنشاء أيقونة واختصار "المتحدة ERP" على سطح المكتب بنجاح!
echo [+] يمكنك الآن فتح البرنامج مباشرة من سطح المكتب.
echo.
set /p OPEN_NOW="هل تريد فتح البرنامج الآن؟ (y/n): "
if /i "%OPEN_NOW%"=="y" (
    start "" "http://%SERVER_IP%:5173"
)

echo.
pause

