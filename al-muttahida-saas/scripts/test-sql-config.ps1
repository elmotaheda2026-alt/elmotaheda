# Auto-Configure SQL Server Script
Write-Host "Checking SQL Server instances..."
$sqlInstances = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL" -ErrorAction SilentlyContinue

if ($sqlInstances) {
    $properties = $sqlInstances.psobject.properties | Where-Object { $_.Name -notmatch "^PS|^_" }
    foreach ($prop in $properties) {
        $instName = $prop.Name
        $instKey = $prop.Value
        Write-Host "Found instance: $instName ($instKey)"
        
        $tcpPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instKey\MSSQLServer\SuperSocketNetLib\Tcp"
        if (Test-Path $tcpPath) {
            Set-ItemProperty -Path $tcpPath -Name "Enabled" -Value 1 -Force
            Write-Host "  -> Enabled TCP/IP on $instName"
            $ipAllPath = "$tcpPath\IPAll"
            if (Test-Path $ipAllPath) {
                Set-ItemProperty -Path $ipAllPath -Name "TcpPort" -Value "1433" -Force
                Set-ItemProperty -Path $ipAllPath -Name "TcpDynamicPorts" -Value "" -Force
                Write-Host "  -> Set TCP Port to 1433 on $instName"
            }
        }
        
        # Mixed Mode Authentication (LoginMode = 2)
        $securityPath = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instKey\MSSQLServer"
        if (Test-Path $securityPath) {
            Set-ItemProperty -Path $securityPath -Name "LoginMode" -Value 2 -Force
            Write-Host "  -> Enabled Mixed Mode Auth on $instName"
        }
    }
}
Write-Host "Configuration completed successfully."

