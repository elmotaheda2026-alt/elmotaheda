!macro customCheckAppRunning
  nsExec::Exec 'cmd /c "taskkill /im \"${APP_EXECUTABLE_FILENAME}\" /f & exit 0"'
  Pop $0
  nsExec::Exec 'cmd /c "taskkill /im \"AlMuttahida*\" /f & exit 0"'
  Pop $0
  Sleep 1000
!macroend

!macro customInstall
  DetailPrint "Ensuring existing processes are terminated..."
  nsExec::Exec 'cmd /c "taskkill /im \"${APP_EXECUTABLE_FILENAME}\" /f & exit 0"'
  Pop $0

  DetailPrint "Configuring Windows Firewall rules for AlMuttahida ERP..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,5000,4000,5173'
  Pop $0

  DetailPrint "Ensuring SQL Server database service is set to automatic start..."
  nsExec::Exec 'sc config MSSQLSERVER start= auto'
  Pop $0
  nsExec::Exec 'net start MSSQLSERVER'
  Pop $0
  nsExec::Exec 'sc config "MSSQL$$SQLEXPRESS" start= auto'
  Pop $0
  nsExec::Exec 'net start "MSSQL$$SQLEXPRESS"'
  Pop $0
!macroend
