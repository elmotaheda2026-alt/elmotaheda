# ==============================================================================
# Al-Muttahida ERP - SQL Server Provisioning & Auto-Configuration Script
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Define ProgramData Directory and Setup Log Path
$programData = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
$appDir = Join-Path $programData "Al-Muttahida ERP"
$logDir = Join-Path $appDir "logs"
$logFile = Join-Path $logDir "sql-setup.log"
$configFile = Join-Path $appDir "config.json"

try {
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
} catch {}

function Write-Log {
    param([string]$message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $logLine = "[$timestamp] $message"
    Write-Output $message
    try {
        Add-Content -Path $logFile -Value $logLine -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

Write-Log "========================================================"
Write-Log "Starting Al-Muttahida SQL Server Setup & Provisioning..."

# 1. Enable Mixed Mode (LoginMode = 2) in Registry for all SQL instances
Write-Log "[Step 1] Checking and enabling Mixed Mode (SQL & Windows Auth) in Registry..."
$needsRestart = $false

try {
    $instKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    if (Test-Path $instKey) {
        $instances = Get-ItemProperty $instKey -ErrorAction SilentlyContinue
        if ($instances) {
            foreach ($prop in $instances.PSObject.Properties) {
                $name = $prop.Name
                $val = $prop.Value
                if ($name -notmatch '^PS' -and $val) {
                    Write-Log "Found SQL Server instance '$name' (Registry node: $val)"
                    $baseKey = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$val\MSSQLServer"
                    if (Test-Path $baseKey) {
                        $currMode = (Get-ItemProperty -Path $baseKey -Name "LoginMode" -ErrorAction SilentlyContinue).LoginMode
                        if ($currMode -ne 2) {
                            Set-ItemProperty -Path $baseKey -Name "LoginMode" -Value 2 -ErrorAction SilentlyContinue
                            Write-Log "Set LoginMode = 2 (Mixed Mode) on instance $val"
                            $needsRestart = $true
                        } else {
                            Write-Log "LoginMode is already 2 (Mixed Mode) on $val"
                        }
                    }

                    # Ensure TCP/IP protocol is enabled
                    $tcpKey = "$baseKey\SuperSocketNetLib\Tcp"
                    if (Test-Path $tcpKey) {
                        $currTcp = (Get-ItemProperty -Path $tcpKey -Name "Enabled" -ErrorAction SilentlyContinue).Enabled
                        if ($currTcp -ne 1) {
                            Set-ItemProperty -Path $tcpKey -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
                            Write-Log "Enabled TCP/IP protocol on instance $val"
                            $needsRestart = $true
                        }
                    }

                    # Set port 1433 in IPAll
                    $ipAllKey = "$tcpKey\IPAll"
                    if (Test-Path $ipAllKey) {
                        Set-ItemProperty -Path $ipAllKey -Name "TcpPort" -Value "1433" -ErrorAction SilentlyContinue
                    }
                }
            }
        }
    }
} catch {
    Write-Log "Notice: Registry configuration notice: $_"
}

# 2. Silently restart MSSQL$SQLEXPRESS and MSSQLSERVER services (and SQLBrowser)
Write-Log "[Step 2] Ensuring SQL Server Browser & Database services are running..."

try {
    Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
    Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
} catch {}

$servicesToManage = @("MSSQL`$SQLEXPRESS", "MSSQLSERVER")
foreach ($svcName in $servicesToManage) {
    try {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if ($svc) {
            Set-Service -Name $svcName -StartupType Automatic -ErrorAction SilentlyContinue
            if ($needsRestart -or $svc.Status -ne 'Running') {
                Write-Log "Restarting service: $svcName silently..."
                Restart-Service -Name $svcName -Force -ErrorAction SilentlyContinue
            } else {
                Write-Log "Service $svcName is already running."
            }
        }
    } catch {
        Write-Log "Notice: Managing service $($svcName) - $_"
    }
}
Start-Sleep -Seconds 2

# 3. Load System.Data assembly
try {
    Add-Type -AssemblyName System.Data -ErrorAction SilentlyContinue
} catch {}
try {
    [System.Reflection.Assembly]::LoadWithPartialName('System.Data') | Out-Null
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

# 4. Connect to master using Windows Authentication (Integrated Security=True)
Write-Log "[Step 3] Connecting to master database via Windows Authentication..."

$candidateServers = @('.\SQLEXPRESS', 'localhost\SQLEXPRESS', 'localhost', '127.0.0.1')
$connectedServer = $null

$provisionSql = @"
USE [master];

-- 1. Create or update login alm_app with sysadmin role
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'alm_app')
BEGIN
    CREATE LOGIN [alm_app] WITH PASSWORD = 'Alm@2026#App', DEFAULT_DATABASE = [master], CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [alm_app] WITH PASSWORD = 'Alm@2026#App', CHECK_EXPIRATION = OFF, CHECK_POLICY = OFF;
END;

ALTER SERVER ROLE [sysadmin] ADD MEMBER [alm_app];

-- 2. Create database AlMuttahida_New if it does not exist
IF DB_ID('AlMuttahida_New') IS NULL
BEGIN
    CREATE DATABASE [AlMuttahida_New];
END;
"@

foreach ($server in $candidateServers) {
    Write-Log "Testing Windows Authentication on '$server'..."
    try {
        $connStr = "Server=$server;Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=4;"
        $conn = New-SqlConn -connString $connStr
        if ($conn) {
            $conn.Open()
            if ($conn.State -eq [System.Data.ConnectionState]::Open) {
                Write-Log "Connected to '$server'! Provisioning login 'alm_app' and database 'AlMuttahida_New'..."
                $cmd = $conn.CreateCommand()
                $cmd.CommandText = $provisionSql
                $cmd.ExecuteNonQuery() | Out-Null

                # Ensure db_owner inside AlMuttahida_New
                try {
                    $grantDbSql = @"
USE [AlMuttahida_New];
IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'alm_app')
BEGIN
    CREATE USER [alm_app] FOR LOGIN [alm_app];
END;
ALTER ROLE [db_owner] ADD MEMBER [alm_app];
"@
                    $cmdGrant = $conn.CreateCommand()
                    $cmdGrant.CommandText = $grantDbSql
                    $cmdGrant.ExecuteNonQuery() | Out-Null
                } catch {
                    Write-Log "Notice: Secondary db_owner grant: $_"
                }

                $conn.Close()
                $connectedServer = $server
                Write-Log "Successfully provisioned database on '$server'!"
                break
            }
        }
    } catch {
        Write-Log "Connection attempt to '$server' failed: $_"
    }

    # Fallback to sqlcmd if .NET connection failed
    if (-not $connectedServer) {
        try {
            $sqlcmdCheck = Get-Command "sqlcmd" -ErrorAction SilentlyContinue
            if ($sqlcmdCheck) {
                Write-Log "Trying sqlcmd utility on '$server'..."
                $escapedSql = $provisionSql.Replace("`r`n", " ")
                $cmdOut = & sqlcmd -S $server -E -Q "$escapedSql" 2>&1
                if ($LASTEXITCODE -eq 0) {
                    $connectedServer = $server
                    Write-Log "Successfully provisioned via sqlcmd on '$server'!"
                    break
                }
            }
        } catch {}
    }
}

if ($connectedServer) {
    # Save working config to %PROGRAMDATA%\Al-Muttahida ERP\config.json
    try {
        $existingConfig = @{}
        if (Test-Path $configFile) {
            $raw = Get-Content -Path $configFile -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
            if ($raw) {
                $existingConfig = $raw | ConvertFrom-Json -AsHashtable -ErrorAction SilentlyContinue
                if (-not $existingConfig) { $existingConfig = @{} }
            }
        }
        $existingConfig["lastSuccessfulServer"] = $connectedServer
        $existingConfig["dbUser"] = "alm_app"
        $existingConfig["database"] = "AlMuttahida_New"

        if ($connectedServer -like "*\*") {
            $parts = $connectedServer -split '\\'
            $existingConfig["host"] = $parts[0]
            $existingConfig["instanceName"] = $parts[1]
        } else {
            $existingConfig["host"] = $connectedServer
            $existingConfig["instanceName"] = $null
        }

        $json = $existingConfig | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($configFile, $json, [System.Text.Encoding]::UTF8)
        Write-Log "Updated config file at '$configFile' with working server '$connectedServer'"
    } catch {
        Write-Log "Warning: Could not save config.json: $_"
    }

    Write-Log "SUCCESS:$connectedServer"
    Write-Output "SUCCESS:$connectedServer"
    exit 0
} else {
    Write-Log "FAILED: Unable to connect to SQL Server on any candidate instance."
    Write-Output "FAILED"
    exit 1
}
