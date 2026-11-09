[System.Reflection.Assembly]::LoadWithPartialName('System.Data') | Out-Null

# 1. Enable TCP and Mixed Mode via Registry for all installed SQL Server instances
$needsRestart = $false
try {
    $instKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    if (Test-Path $instKey) {
        $instances = Get-ItemProperty $instKey
        foreach ($prop in $instances.PSObject.Properties) {
            $name = $prop.Name
            $val = $prop.Value
            if ($name -notmatch '^PS' -and $val) {
                $baseKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$val\MSSQLServer"
                if (Test-Path $baseKey) {
                    $currMode = (Get-ItemProperty -Path $baseKey -Name "LoginMode" -ErrorAction SilentlyContinue).LoginMode
                    if ($currMode -ne 2) {
                        Set-ItemProperty -Path $baseKey -Name "LoginMode" -Value 2 -ErrorAction SilentlyContinue
                        $needsRestart = $true
                    }
                }
                $tcpKey = "$baseKey\SuperSocketNetLib\Tcp"
                if (Test-Path $tcpKey) {
                    $currTcp = (Get-ItemProperty -Path $tcpKey -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
                    if ($currTcp -ne 1) {
                        Set-ItemProperty -Path $tcpKey -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
                        $needsRestart = $true
                    }
                }
                $ipAllKey = "$tcpKey\IPAll"
                if (Test-Path $ipAllKey) {
                    Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "1433" -ErrorAction SilentlyContinue
                    Set-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -Value "" -ErrorAction SilentlyContinue
                }
            }
        }
    }
} catch {
    # Non-fatal if running without full elevation
}

# 2. Check if port 1433 is currently reachable
$tcpListening = $false
try {
    $socket = New-Object System.Net.Sockets.TcpClient
    $async = $socket.BeginConnect('127.0.0.1', 1433, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(600)) {
        $socket.EndConnect($async)
        $tcpListening = $true
    }
    $socket.Close()
} catch {}

# If port 1433 is closed or protocols changed, restart SQL Server service to bind port 1433
if ((-not $tcpListening) -or $needsRestart) {
    try {
        Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
        Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
        Get-Service | Where-Object { ($_.Name -like "MSSQL*" -or $_.Name -like "*SQLEXPRESS*") -and $_.Name -notlike "*Launcher*" -and $_.Name -notlike "*Writer*" } | Restart-Service -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    } catch {}
} else {
    try {
        Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
        Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
        Get-Service | Where-Object { ($_.Name -like "MSSQL*" -or $_.Name -like "*SQLEXPRESS*") -and $_.Name -notlike "*Launcher*" -and $_.Name -notlike "*Writer*" } | Start-Service -ErrorAction SilentlyContinue
    } catch {}
}

# 3. Connect via Windows Integrated Security to provision alm_app and DB
$servers = @('127.0.0.1', 'localhost', '.\SQLEXPRESS', 'localhost\SQLEXPRESS')
$success = $false

foreach ($server in $servers) {
    try {
        $connStr = "Server=$server;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=3;"
        $conn = New-Object System.Data.SqlClient.SqlConnection($connStr)
        $conn.Open()
        
        $sql = @"
-- Enable mixed mode and TCP via internal procedures
EXEC xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'LoginMode', REG_DWORD, 2;
EXEC xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp', N'Enabled', REG_DWORD, 1;
EXEC xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpPort', REG_SZ, N'1433';
EXEC xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpDynamicPorts', REG_SZ, N'';

IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'alm_app')
BEGIN
    CREATE LOGIN [alm_app] WITH PASSWORD = 'Alm@2026#App', DEFAULT_DATABASE = [master], CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
    ALTER SERVER ROLE [sysadmin] ADD MEMBER [alm_app];
END
ELSE
BEGIN
    ALTER LOGIN [alm_app] WITH PASSWORD = 'Alm@2026#App', CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
    ALTER SERVER ROLE [sysadmin] ADD MEMBER [alm_app];
END

IF DB_ID('AlMuttahida_New') IS NULL
BEGIN
    CREATE DATABASE [AlMuttahida_New];
END
"@
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.ExecuteNonQuery() | Out-Null
        $conn.Close()
        Write-Output "SUCCESS:$server"
        $success = $true
        break
    } catch {
        # continue to next candidate server
    }
}

if (-not $success) {
    Write-Output "FAILED"
    exit 1
}
exit 0
