<#
.SYNOPSIS
    Start the SimpleRadio Standalone server (SRS-Server.exe) once, with its GUI, and exit.

.DESCRIPTION
    One-shot launcher meant to be run by a Windows scheduled task configured
    "Run only when user is logged on" (LogonType Interactive), so that the
    SRS window appears on that user's desktop even when the caller
    (the DCS Web Dashboard NSSM service) lives in Session 0.

    The script never loops. It exits as soon as the launch is issued, so the
    scheduled task returns to Ready and can be run again by the dashboard.

    If SRS-Server.exe is still alive when the script starts (the dashboard
    kills it just before a restart), the script waits up to -WaitForExitSec
    for it to disappear before deciding that SRS is "already running".

.PARAMETER SrsBin
    Folder containing SRS-Server.exe.

.PARAMETER SrsCfg
    Path to server.cfg. Defaults to server.cfg inside -SrsBin.

.PARAMETER LogDir
    Folder for srs_start.log. Created when missing.

.PARAMETER WaitForExitSec
    Seconds to wait for a dying SRS-Server.exe to exit before giving up.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-SRS.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-SRS.ps1 `
        -LogDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease\Logs"

.NOTES
    Exit codes: 0 launched or already running, 1 executable or config missing,
    2 launch failed.
#>
[CmdletBinding()]
param(
    [string]$SrsBin = "C:\Program Files\DCS-SimpleRadio-Standalone\Server",
    [string]$SrsCfg = "",
    [string]$LogDir = (Join-Path $env:USERPROFILE "Saved Games\DCS.openbeta_server\Logs"),
    [ValidateRange(0, 600)]
    [int]$WaitForExitSec = 30
)

$ProcessName = "SRS-Server"
$SrsExe = Join-Path $SrsBin "SRS-Server.exe"
if ([string]::IsNullOrWhiteSpace($SrsCfg)) {
    $SrsCfg = Join-Path $SrsBin "server.cfg"
}
$Log = Join-Path $LogDir "srs_start.log"

function LogLine([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    try { $line | Out-File -FilePath $Log -Append -Encoding UTF8 } catch { }
    Write-Output $line
}

function Get-RunningProcess {
    return Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
}

# --- prep ---
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$sessionId = (Get-Process -Id $PID).SessionId
LogLine "Start-SRS: begin (user=$env:USERNAME, session=$sessionId, pid=$PID)"

if (-not (Test-Path -LiteralPath $SrsExe)) {
    LogLine "ERROR: SRS-Server.exe not found at: $SrsExe"
    exit 1
}
if (-not (Test-Path -LiteralPath $SrsCfg)) {
    LogLine "ERROR: SRS config not found at: $SrsCfg"
    exit 1
}

# --- restart race guard ---
$existing = Get-RunningProcess
if ($existing -and $WaitForExitSec -gt 0) {
    LogLine "SRS-Server.exe already present (pid=$($existing.Id), session=$($existing.SessionId)); waiting up to ${WaitForExitSec}s for it to exit"
    $deadline = (Get-Date).AddSeconds($WaitForExitSec)
    while ((Get-Date) -lt $deadline -and (Get-RunningProcess)) {
        Start-Sleep -Seconds 1
    }
    $existing = Get-RunningProcess
}
if ($existing) {
    LogLine "SRS already running (pid=$($existing.Id), session=$($existing.SessionId)) -> skip start"
    exit 0
}

# --- launch ---
$srsArgs = "-cfg=`"$SrsCfg`""
LogLine "Starting SRS: `"$SrsExe`" $srsArgs"
try {
    $proc = Start-Process -FilePath $SrsExe -ArgumentList $srsArgs -WorkingDirectory $SrsBin -PassThru
    LogLine "SRS launched (pid=$($proc.Id), session=$($proc.SessionId))"
    exit 0
} catch {
    LogLine "ERROR: launch failed: $($_.Exception.Message)"
    exit 2
}
