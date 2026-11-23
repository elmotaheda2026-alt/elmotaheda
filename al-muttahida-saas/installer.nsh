!macro customInit
  ${If} ${Silent}
    System::Call 'kernel32::GetCurrentProcessId()i.r9'
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $9"'
    Pop $0
    Sleep 1200
  ${EndIf}
!macroend

!macro customCheckAppRunning
  System::Call 'kernel32::GetCurrentProcessId()i.r9'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $9"'
  Pop $0
  Sleep 1200
!macroend

!macro customUnInstall
  DetailPrint "Stopping running application and backend processes before uninstall..."
  System::Call 'kernel32::GetCurrentProcessId()i.r9'
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "PID ne $9"'
  Pop $0
  Sleep 1200
!macroend

!macro customInstall
  DetailPrint "Configuring Windows Firewall rules for AlMuttahida ERP..."
  nsExec::Exec 'cmd /c netsh advfirewall firewall show rule name="AlMuttahida ERP Ports" >nul 2>&1 || netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,5000,4000,5173'
  Pop $0

  DetailPrint "Ensuring SQL Server database service is set to automatic start..."
  nsExec::Exec 'sc config MSSQLSERVER start= auto'
  Pop $0
  nsExec::Exec 'sc start MSSQLSERVER'
  Pop $0
  nsExec::Exec 'sc config "MSSQL$$SQLEXPRESS" start= auto'
  Pop $0
  nsExec::Exec 'sc start "MSSQL$$SQLEXPRESS"'
  Pop $0
!macroend
