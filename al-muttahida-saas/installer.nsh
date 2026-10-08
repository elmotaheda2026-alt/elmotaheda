!macro customInstall
  DetailPrint "Configuring Windows Firewall rules for AlMuttahida ERP..."
  nsExec::Exec 'netsh advfirewall firewall add rule name="AlMuttahida ERP Ports" dir=in action=allow protocol=TCP localport=1433,5000,4000,5173'
  Pop $0
!macroend
