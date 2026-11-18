# ==============================================================================
# Al-Muttahida ERP - SQL Server Provisioning & Auto-Configuration Script
# Compatible with Windows PowerShell 5.1+
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$programData = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$appDir = Join-Path $programData "Al-Muttahida ERP"
$logDir = Join-Path $appDir "logs"
$logFile = Join-Path $logDir "sql-setup.log"
$configFile = Join-Path $appDir "config.json"

$appDataBase = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
$appDataDir = Join-Path $appDataBase "Al-Muttahida ERP"
$appDataConfigFile = Join-Path $appDataDir "config.json"

try {
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
} catch {}

function Write-Log {
    param([string]$message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$timestamp] $message"
    [Console]::WriteLine($message)
    try {
        Add-Content -Path $logFile -Value $logLine -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

function Is-Administrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

Write-Log "========================================================"
Write-Log "Starting Al-Muttahida SQL Server Setup & Provisioning..."

# 1. Best-effort Registry configuration (works directly if elevated; SQL xp_instance_regwrite also handles it inside SQL)
Write-Log "[Step 1] Checking and enabling Mixed Mode (LoginMode = 2) and TCP/IP port 1433..."
$needsRestart = $false

function Enable-SqlRegistryKeys {
    $changed = $false
    try {
        $instKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
        if (Test-Path $instKey) {
            $instances = Get-ItemProperty $instKey -ErrorAction SilentlyContinue
            if ($instances) {
                $instanceProps = @($instances.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Value })
                $hasDefaultInstance = ($instanceProps | Where-Object { $_.Name -eq 'MSSQLSERVER' }).Count -gt 0

                foreach ($prop in $instanceProps) {
                    $name = $prop.Name
                    $val = $prop.Value
                    $canUse1433 = ($name -eq 'MSSQLSERVER') -or (-not $hasDefaultInstance -and $instanceProps.Count -eq 1)

                    Write-Log "Found SQL Server instance '$name' (Registry node: $val, canUse1433: $canUse1433)"
                    $baseKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$val\MSSQLServer"
                    if (Test-Path $baseKey) {
                        $currMode = (Get-ItemProperty -Path $baseKey -Name "LoginMode" -ErrorAction SilentlyContinue).LoginMode
                        if ($currMode -ne 2) {
                            Set-ItemProperty -Path $baseKey -Name "LoginMode" -Value 2 -ErrorAction Stop
                            Write-Log "Set LoginMode = 2 (Mixed Mode) on instance $val"
                            $changed = $true
                        } else {
                            Write-Log "LoginMode is already 2 (Mixed Mode) on $val"
                        }
                    }

                    $tcpKey = "$baseKey\SuperSocketNetLib\Tcp"
                    if (Test-Path $tcpKey) {
                        $currTcp = (Get-ItemProperty -Path $tcpKey -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
                        if ($currTcp -ne 1) {
                            Set-ItemProperty -Path $tcpKey -Name "Enabled" -Value 1 -ErrorAction Stop
                            Write-Log "Enabled TCP/IP protocol on instance $val"
                            $changed = $true
                        }
                        $currListen = (Get-ItemProperty -Path $tcpKey -Name "ListenOnAllIPs" -ErrorAction SilentlyContinue).ListenOnAllIPs
                        if ($currListen -ne 1) {
                            Set-ItemProperty -Path $tcpKey -Name "ListenOnAllIPs" -Value 1 -ErrorAction SilentlyContinue
                            $changed = $true
                        }
                    }

                    $ipAllKey = "$tcpKey\IPAll"
                    if (Test-Path $ipAllKey) {
                        $currPort = (Get-ItemProperty -Path $ipAllKey -Name "TcpPort" -ErrorAction SilentlyContinue).TcpPort
                        $currDyn = (Get-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -ErrorAction SilentlyContinue).TcpDynamicPorts
                        if ($canUse1433) {
                            if ($currPort -ne "1433" -or $currDyn) {
                                Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "1433" -ErrorAction Stop
                                Set-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -Value "" -ErrorAction Stop
                                Write-Log "Configured IPAll TcpPort = 1433 (static) on instance $val"
                                $changed = $true
                            }
                        } elseif ($currPort -eq "1433") {
                            # Avoid port 1433 binding conflict (Windows error 10048) with primary instance
                            Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "51433" -ErrorAction Stop
                            Set-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -Value "" -ErrorAction Stop
                            Write-Log "Moved secondary instance $val from conflicting port 1433 to 51433"
                            $changed = $true
                        }
                    }
                }
            }
        }
    } catch {
        Write-Log "Registry write notice (will also attempt via SQL Server xp_instance_regwrite): $_"
    }
    return $changed
}

if (Enable-SqlRegistryKeys) {
    $needsRestart = $true
}

# 2. Ensure SQL Server Browser & Database services are running
Write-Log "[Step 2] Ensuring SQL Server Browser & Database services are running..."

try {
    Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
} catch {}

$sqlServices = @()
try {
    $sqlServices = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*' }
} catch {}

foreach ($svc in $sqlServices) {
    try {
        Set-Service -Name $svc.Name -StartupType Automatic -ErrorAction SilentlyContinue
        if ($needsRestart -or $svc.Status -ne 'Running') {
            Write-Log "Restarting service: $($svc.Name)..."
            Restart-Service -Name $svc.Name -Force -ErrorAction Stop
        } else {
            Write-Log "Service $($svc.Name) is already running."
        }
    } catch {
        Write-Log "Notice managing service $($svc.Name) without elevation: $_"
    }
}
Start-Sleep -Seconds 2

# 3. Load System.Data assembly
try {
    Add-Type -AssemblyName System.Data -ErrorAction SilentlyContinue
} catch {}

function New-SqlConn {
    param([string]$connString)
    try {
        return New-Object System.Data.SqlClient.SqlConnection($connString)
    } catch {
        try {
            return New-Object Microsoft.Data.SqlClient.SqlConnection($connString)
        } catch {
            return $null
        }
    }
}

# 4. Provision via Windows Authentication on all reachable local instances
Write-Log "[Step 3] Connecting to local SQL Server instances via Windows Authentication..."

$regSql = @"
DECLARE @loginMode INT;
EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'LoginMode', @loginMode OUTPUT;
IF ISNULL(@loginMode, 1) <> 2
BEGIN
    EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer', N'LoginMode', N'REG_DWORD', 2;
    SELECT 1 AS RestartRequired;
END
ELSE
BEGIN
    SELECT 0 AS RestartRequired;
END;

DECLARE @tcpEnabled INT;
EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp', N'Enabled', @tcpEnabled OUTPUT;
IF ISNULL(@tcpEnabled, 0) <> 1
BEGIN
    EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp', N'Enabled', N'REG_DWORD', 1;
END;

DECLARE @listenAll INT;
EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp', N'ListenOnAllIPs', @listenAll OUTPUT;
IF ISNULL(@listenAll, 0) <> 1
BEGIN
    EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp', N'ListenOnAllIPs', N'REG_DWORD', 1;
END;

DECLARE @tcpPort NVARCHAR(64);
EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpPort', @tcpPort OUTPUT;
DECLARE @dynPort NVARCHAR(64);
EXEC master.dbo.xp_instance_regread N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpDynamicPorts', @dynPort OUTPUT;

IF SERVERPROPERTY('InstanceName') IS NULL
BEGIN
    IF ISNULL(@tcpPort, N'') <> N'1433'
    BEGIN
        EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpPort', N'REG_SZ', N'1433';
    END;
    IF ISNULL(@dynPort, N'') <> N''
    BEGIN
        EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpDynamicPorts', N'REG_SZ', N'';
    END;
END
ELSE
BEGIN
    -- Named instance (e.g. SQLEXPRESS): keep its own port or dynamic ports; never hijack port 1433 if unconfigured
    IF ISNULL(@tcpPort, N'') = N'' AND ISNULL(@dynPort, N'') = N''
    BEGIN
        EXEC master.dbo.xp_instance_regwrite N'HKEY_LOCAL_MACHINE', N'Software\Microsoft\MSSQLServer\MSSQLServer\SuperSocketNetLib\Tcp\IPAll', N'TcpDynamicPorts', N'REG_SZ', N'0';
    END;
END;
"@

$provisionSql = @"
USE [master];

IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'alm_app')
BEGIN
    CREATE LOGIN [alm_app] WITH PASSWORD = N'Alm@2026#App', DEFAULT_DATABASE = [master], CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [alm_app] WITH PASSWORD = N'Alm@2026#App', CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
END;
ALTER LOGIN [alm_app] ENABLE;

IF DB_ID(N'AlMuttahida_New') IS NULL
BEGIN
    CREATE DATABASE [AlMuttahida_New];
END;
"@

$grantDbSql = @"
USE [AlMuttahida_New];
IF EXISTS (SELECT * FROM sys.database_principals WHERE name = N'alm_app')
BEGIN
    ALTER USER [alm_app] WITH LOGIN = [alm_app];
END
ELSE
BEGIN
    BEGIN TRY
        CREATE USER [alm_app] FOR LOGIN [alm_app];
    END TRY
    BEGIN CATCH
    END CATCH;
END;
ALTER ROLE [db_owner] ADD MEMBER [alm_app];
BEGIN TRY
    ALTER AUTHORIZATION ON DATABASE::[AlMuttahida_New] TO [alm_app];
END TRY
BEGIN CATCH
END CATCH;
"@

# Prefer default instance (localhost / 127.0.0.1) if available, otherwise named SQLEXPRESS
$candidateServers = @('localhost', '127.0.0.1', '.\SQLEXPRESS', 'localhost\SQLEXPRESS')
$connectedServer = $null
$reachableServers = @()

foreach ($server in $candidateServers) {
    # Skip duplicate attempt on 127.0.0.1 if localhost already succeeded, or .\SQLEXPRESS if localhost\SQLEXPRESS needed
    if ($server -eq '127.0.0.1' -and ($reachableServers -contains 'localhost')) {
        continue
    }
    if ($server -eq 'localhost\SQLEXPRESS' -and ($reachableServers -contains '.\SQLEXPRESS')) {
        continue
    }

    Write-Log "Testing Windows Authentication on '$server'..."
    $instanceProvisioned = $false
    try {
        $connStr = "Server=$server;Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=4;"
        $conn = New-SqlConn -connString $connStr
        if ($conn) {
            $conn.Open()
            if ($conn.State -eq [System.Data.ConnectionState]::Open) {
                Write-Log "Connected to '$server'! Configuring registry via SQL & provisioning 'alm_app' + 'AlMuttahida_New'..."

                try {
                    $cmdReg = $conn.CreateCommand()
                    $cmdReg.CommandText = $regSql
                    $regOut = $cmdReg.ExecuteScalar()
                    if ([int]$regOut -eq 1) {
                        Write-Log "Mixed Mode (LoginMode=2) updated via xp_instance_regwrite on '$server'; SQL service restart needed."
                        $needsRestart = $true
                    }
                } catch {
                    Write-Log "Notice during xp_instance_regwrite on '$server': $_"
                }

                $cmd = $conn.CreateCommand()
                $cmd.CommandText = $provisionSql
                $cmd.ExecuteNonQuery() | Out-Null

                $cmdGrant = $conn.CreateCommand()
                $cmdGrant.CommandText = $grantDbSql
                $cmdGrant.ExecuteNonQuery() | Out-Null

                $conn.Close()
                $instanceProvisioned = $true
                $reachableServers += $server
                if (-not $connectedServer) {
                    $connectedServer = $server
                }
                Write-Log "Successfully provisioned database & alm_app permissions on '$server'!"
            }
        }
    } catch {
        Write-Log "Connection attempt to '$server' failed: $_"
    }

    # Fallback to sqlcmd using a temporary .sql file (preserves newlines & comments)
    if (-not $instanceProvisioned) {
        try {
            $sqlcmdCheck = Get-Command "sqlcmd" -ErrorAction SilentlyContinue
            if ($sqlcmdCheck) {
                Write-Log "Trying sqlcmd utility on '$server'..."
                $tempSqlPath = Join-Path ([System.IO.Path]::GetTempPath()) ("alm-init-" + [Guid]::NewGuid().ToString("N") + ".sql")
                $combinedSql = $regSql + "`r`nGO`r`n" + $provisionSql + "`r`nGO`r`n" + $grantDbSql
                [System.IO.File]::WriteAllText($tempSqlPath, $combinedSql, (New-Object System.Text.UTF8Encoding($false)))
                $cmdOut = & sqlcmd -S $server -E -i $tempSqlPath 2>&1
                Remove-Item $tempSqlPath -Force -ErrorAction SilentlyContinue
                if ($LASTEXITCODE -eq 0) {
                    $reachableServers += $server
                    if (-not $connectedServer) {
                        $connectedServer = $server
                    }
                    Write-Log "Successfully provisioned via sqlcmd on '$server'!"
                }
            }
        } catch {}
    }
}

# 5. Test SQL Authentication (alm_app) over TCP 127.0.0.1,1433 and restart service (elevating if needed)
function Test-AlmAppSqlLogin {
    param([string]$targetServer)
    $targets = @("127.0.0.1,1433", "localhost,1433")
    if ($targetServer -and ($targets -notcontains $targetServer)) {
        $targets += $targetServer
    }
    foreach ($t in $targets) {
        try {
            $cs = "Server=$t;Database=AlMuttahida_New;User Id=alm_app;Password=Alm@2026#App;TrustServerCertificate=True;Connect Timeout=4;"
            $c = New-SqlConn -connString $cs
            if ($c) {
                $c.Open()
                if ($c.State -eq [System.Data.ConnectionState]::Open) {
                    $c.Close()
                    Write-Log "Verified SQL Authentication login 'alm_app' on '$t'!"
                    return $t
                }
            }
        } catch {}
    }
    return $null
}

$verifiedTcpTarget = Test-AlmAppSqlLogin -targetServer $connectedServer

if ($needsRestart -or -not $verifiedTcpTarget) {
    Write-Log "[Step 4] Restarting SQL Server services to apply Mixed Mode / TCP 1433 changes..."
    $restartedLocally = $false
    foreach ($svc in $sqlServices) {
        try {
            Restart-Service -Name $svc.Name -Force -ErrorAction Stop
            $restartedLocally = $true
        } catch {}
    }

    if (-not $restartedLocally -and -not (Is-Administrator)) {
        Write-Log "Requesting elevated privileges to update SQL Registry / Firewall / Restart SQL Server..."
        try {
            $elevatedScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("alm-elevate-" + [Guid]::NewGuid().ToString("N") + ".ps1")
            $elevatedScript = @'
$instKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
if (Test-Path $instKey) {
    $instances = Get-ItemProperty $instKey -ErrorAction SilentlyContinue
    $instanceProps = @($instances.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' -and $_.Value })
    $hasDefaultInstance = ($instanceProps | Where-Object { $_.Name -eq 'MSSQLSERVER' }).Count -gt 0
    foreach ($prop in $instanceProps) {
        $canUse1433 = ($prop.Name -eq 'MSSQLSERVER') -or (-not $hasDefaultInstance -and $instanceProps.Count -eq 1)
        $baseKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$($prop.Value)\MSSQLServer"
        if (Test-Path $baseKey) { Set-ItemProperty -Path $baseKey -Name "LoginMode" -Value 2 -ErrorAction SilentlyContinue }
        $tcpKey = "$baseKey\SuperSocketNetLib\Tcp"
        if (Test-Path $tcpKey) {
            Set-ItemProperty -Path $tcpKey -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $tcpKey -Name "ListenOnAllIPs" -Value 1 -ErrorAction SilentlyContinue
        }
        $ipAllKey = "$tcpKey\IPAll"
        if (Test-Path $ipAllKey) {
            $currPort = (Get-ItemProperty -Path $ipAllKey -Name "TcpPort" -ErrorAction SilentlyContinue).TcpPort
            if ($canUse1433) {
                Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "1433" -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -Value "" -ErrorAction SilentlyContinue
            } elseif ($currPort -eq "1433") {
                Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "51433" -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $ipAllKey -Name "TcpDynamicPorts" -Value "" -ErrorAction SilentlyContinue
            }
        }
    }
}
netsh advfirewall firewall add rule name="AlMuttahida ERP Ports TCP" dir=in action=allow protocol=TCP localport=1433,4000,5000,5173,51433 | Out-Null
netsh advfirewall firewall add rule name="SQL Server Browser UDP" dir=in action=allow protocol=UDP localport=1434,4001 | Out-Null
try { Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue } catch {}
Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'MSSQLSERVER' -or $_.Name -like 'MSSQL$*' } | ForEach-Object {
    try {
        Set-Service -Name $_.Name -StartupType Automatic -ErrorAction SilentlyContinue
        Restart-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
    } catch {}
}
'@
            [System.IO.File]::WriteAllText($elevatedScriptPath, $elevatedScript, (New-Object System.Text.UTF8Encoding($false)))
            $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$elevatedScriptPath`"" -Verb RunAs -WindowStyle Hidden -Wait -PassThru
            Remove-Item $elevatedScriptPath -Force -ErrorAction SilentlyContinue
            Write-Log "Elevated SQL configuration finished with exit code: $($proc.ExitCode)"
        } catch {
            Write-Log "Elevation prompt cancelled or failed: $_"
        }
    }

    Start-Sleep -Seconds 3
    $verifiedTcpTarget = Test-AlmAppSqlLogin -targetServer $connectedServer
}

if ($connectedServer -or $verifiedTcpTarget) {
    $preferredServer = if ($verifiedTcpTarget -eq "127.0.0.1,1433" -or $verifiedTcpTarget -eq "localhost,1433") {
        "localhost"
    } elseif ($connectedServer) {
        $connectedServer
    } else {
        "localhost"
    }

    # Save working config cleanly without -AsHashtable (Windows PowerShell 5.1 compatible)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    foreach ($targetCfgPath in @($configFile, $appDataConfigFile)) {
        try {
            $cfgDir = Split-Path $targetCfgPath -Parent
            if (-not (Test-Path $cfgDir)) {
                New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
            }

            $existingConfig = @{}
            if (Test-Path $targetCfgPath) {
                $raw = Get-Content -Path $targetCfgPath -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
                if ($raw -and $raw.Trim()) {
                    $parsedObj = $raw | ConvertFrom-Json -ErrorAction SilentlyContinue
                    if ($parsedObj) {
                        foreach ($p in $parsedObj.PSObject.Properties) {
                            $existingConfig[$p.Name] = $p.Value
                        }
                    }
                }
            }

            $existingConfig["lastSuccessfulServer"] = $preferredServer
            $existingConfig["dbUser"] = "alm_app"
            $existingConfig["dbPassword"] = "Alm@2026#App"
            $existingConfig["database"] = "AlMuttahida_New"

            if ($preferredServer -like "*\*") {
                $parts = $preferredServer -split '\\'
                $existingConfig["host"] = if ($parts[0] -eq '.') { 'localhost' } else { $parts[0] }
                $existingConfig["instanceName"] = $parts[1]
                $existingConfig["dbPort"] = $null
            } else {
                $existingConfig["host"] = $preferredServer
                $existingConfig["instanceName"] = $null
                $existingConfig["dbPort"] = 1433
            }

            $json = $existingConfig | ConvertTo-Json -Depth 5
            [System.IO.File]::WriteAllText($targetCfgPath, $json, $utf8NoBom)
            Write-Log "Saved config file at '$targetCfgPath' with working server '$preferredServer'"
        } catch {
            Write-Log "Warning: Could not save $targetCfgPath : $_"
        }
    }

    Write-Log "SUCCESS:$preferredServer"
    exit 0
} else {
    Write-Log "FAILED: Unable to connect to SQL Server on any candidate instance."
    exit 1
}
