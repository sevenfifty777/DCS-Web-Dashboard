<#
.SYNOPSIS
    Start the DCS dedicated server (DCS_server.exe) once, with its GUI, and exit.

.DESCRIPTION
    One-shot launcher meant to be run by a Windows scheduled task configured
    "Run only when user is logged on" (LogonType Interactive), so that the
    DCS window appears on that user's desktop even when the caller
    (the DCS Web Dashboard NSSM service) lives in Session 0.

    The script never loops. It exits as soon as the launch is issued, so the
    scheduled task returns to Ready and can be run again by the dashboard.

    If DCS_server.exe is still alive when the script starts (the dashboard
    kills it just before a restart), the script waits up to -WaitForExitSec
    for it to disappear before deciding that DCS is "already running".

.PARAMETER DcsBin
    Folder containing DCS_server.exe.

.PARAMETER DcsArgs
    Command-line arguments passed to DCS_server.exe. "launch" opens the
    dedicated-server GUI. Pass "" for no arguments.

.PARAMETER LogDir
    Folder for dcs_start.log. Created when missing.

.PARAMETER WaitForExitSec
    Seconds to wait for a dying DCS_server.exe to exit before giving up.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-DCS.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-DCS.ps1 `
        -DcsBin "C:\Program Files\Eagle Dynamics\DCS World Server\bin" `
        -LogDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease\Logs"

.NOTES
    Exit codes: 0 launched or already running, 1 executable missing,
    2 launch failed.
#>
[CmdletBinding()]
param(
    [string]$DcsBin = "C:\Program Files\Eagle Dynamics\DCS World OpenBeta Server\bin",
    [string]$DcsArgs = "launch",
    [string]$LogDir = (Join-Path $env:USERPROFILE "Saved Games\DCS.openbeta_server\Logs"),
    [ValidateRange(0, 600)]
    [int]$WaitForExitSec = 30
)

$ProcessName = "DCS_server"
$DcsExe = Join-Path $DcsBin "DCS_server.exe"
$Log = Join-Path $LogDir "dcs_start.log"

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
LogLine "Start-DCS: begin (user=$env:USERNAME, session=$sessionId, pid=$PID)"

if (-not (Test-Path -LiteralPath $DcsExe)) {
    LogLine "ERROR: DCS_server.exe not found at: $DcsExe"
    exit 1
}

# --- restart race guard ---
$existing = Get-RunningProcess
if ($existing -and $WaitForExitSec -gt 0) {
    LogLine "DCS_server.exe already present (pid=$($existing.Id), session=$($existing.SessionId)); waiting up to ${WaitForExitSec}s for it to exit"
    $deadline = (Get-Date).AddSeconds($WaitForExitSec)
    while ((Get-Date) -lt $deadline -and (Get-RunningProcess)) {
        Start-Sleep -Seconds 1
    }
    $existing = Get-RunningProcess
}
if ($existing) {
    LogLine "DCS already running (pid=$($existing.Id), session=$($existing.SessionId)) -> skip start"
    exit 0
}

# --- launch ---
$startParams = @{
    FilePath         = $DcsExe
    WorkingDirectory = $DcsBin
    PassThru         = $true
}
if (-not [string]::IsNullOrWhiteSpace($DcsArgs)) {
    $startParams.ArgumentList = $DcsArgs
}

LogLine "Starting DCS: `"$DcsExe`" $DcsArgs"
try {
    $proc = Start-Process @startParams
    LogLine "DCS launched (pid=$($proc.Id), session=$($proc.SessionId))"
    exit 0
} catch {
    LogLine "ERROR: launch failed: $($_.Exception.Message)"
    exit 2
}
