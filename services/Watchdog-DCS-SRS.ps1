<#
.SYNOPSIS
    Boot-time starter and watchdog for DCS and SRS, cooperating with the DCS Web Dashboard.

.DESCRIPTION
    Replacement for the loop in Start-DCS-SRS.ps1. Meant to run as a scheduled task
    "At log on" of the auto-logon desktop user (LogonType Interactive), so the
    DCS and SRS windows are on that desktop.

    Sequence:
      1. wait for the network (default route + DNS), up to -StartupNetworkTimeoutSec;
      2. start DCS through Start-DCS.ps1, wait -DelayBeforeSrsSec, start SRS through Start-SRS.ps1;
      3. loop forever: every -CheckIntervalSec, restart whichever of the two is not running.

    Cooperation with the dashboard: the dashboard's Stop button creates a flag file
    (dashboard_stop_dcs.flag / dashboard_stop_srs.flag in -SavedGamesDir) and its
    Start button removes it. While a flag exists the watchdog leaves that process
    alone, so a deliberate stop from the dashboard is not undone.

.PARAMETER ScriptDir
    Folder containing Start-DCS.ps1 and Start-SRS.ps1. Defaults to this script's folder.

.PARAMETER SavedGamesDir
    DCS Saved Games folder. Must equal the dashboard's DCS_SAVED_GAMES_DIR, because
    the flag files live there. Also used for the default -LogDir.

.PARAMETER DcsScriptArgs
.PARAMETER SrsScriptArgs
    Extra arguments passed verbatim to Start-DCS.ps1 / Start-SRS.ps1 (per-host paths).

.PARAMETER LogDir
    Folder for dcs_srs_watchdog.log. Defaults to <SavedGamesDir>\Logs.

.PARAMETER Once
    Do a single pass (network wait, start both, one check) and exit. For testing.

.NOTES
    Exit codes: 0 normal (only with -Once), 1 a start script is missing.
#>
[CmdletBinding()]
param(
    [string]$ScriptDir = "",
    [string]$SavedGamesDir = (Join-Path $env:USERPROFILE "Saved Games\DCS.openbeta_server"),
    [string]$DcsScriptArgs = "",
    [string]$SrsScriptArgs = "",
    [string]$LogDir = "",
    [ValidateRange(0, 3600)] [int]$StartupNetworkTimeoutSec = 180,
    [ValidateRange(0, 3600)] [int]$DelayBeforeSrsSec = 30,
    [ValidateRange(5, 3600)] [int]$CheckIntervalSec = 30,
    [ValidateRange(0, 3600)] [int]$RestartCooldownSec = 60,
    [switch]$Once
)

# $PSScriptRoot is empty inside param() defaults under `powershell.exe -File`; resolve it here.
if ([string]::IsNullOrWhiteSpace($ScriptDir)) {
    $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
}
if ([string]::IsNullOrWhiteSpace($LogDir)) { $LogDir = Join-Path $SavedGamesDir "Logs" }
$Log = Join-Path $LogDir "dcs_srs_watchdog.log"
$StartDcsScript = Join-Path $ScriptDir "Start-DCS.ps1"
$StartSrsScript = Join-Path $ScriptDir "Start-SRS.ps1"
$DcsFlag = Join-Path $SavedGamesDir "dashboard_stop_dcs.flag"
$SrsFlag = Join-Path $SavedGamesDir "dashboard_stop_srs.flag"

function LogLine([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    try { $line | Out-File -FilePath $Log -Append -Encoding UTF8 } catch { }
    # Write-Host, not Write-Output: LogLine is called inside functions whose
    # return value is tested, and Write-Output would pollute that value.
    Write-Host $line
}

function IsProcessRunning([string]$Name) {
    return [bool](Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Invoke-StartScript([string]$Label, [string]$ScriptPath, [string]$ExtraArgs) {
    $argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
    if (-not [string]::IsNullOrWhiteSpace($ExtraArgs)) { $argument += " $ExtraArgs" }
    LogLine "$Label -> powershell.exe $argument"
    try {
        $p = Start-Process -FilePath "powershell.exe" -ArgumentList $argument -WindowStyle Hidden -Wait -PassThru
        LogLine "$Label start script exit code $($p.ExitCode)"
    } catch {
        LogLine "$Label start script failed to run: $($_.Exception.Message)"
    }
}

function Ensure-Running([string]$Label, [string]$ProcessName, [string]$FlagPath, [string]$ScriptPath, [string]$ExtraArgs) {
    if (IsProcessRunning $ProcessName) { return $false }
    if (Test-Path -LiteralPath $FlagPath) {
        LogLine "$Label not running but stopped from the dashboard ($([System.IO.Path]::GetFileName($FlagPath)) present) -> leave it"
        return $false
    }
    LogLine "$Label not running -> start"
    Invoke-StartScript -Label $Label -ScriptPath $ScriptPath -ExtraArgs $ExtraArgs
    return $true
}

function WaitForNetwork([int]$TimeoutSec) {
    if ($TimeoutSec -le 0) { return $true }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Select-Object -First 1
            if ($route) {
                Resolve-DnsName -Name "api.digitalcombatsimulator.com" -ErrorAction Stop | Out-Null
                LogLine "Network ready (default route + DNS OK)"
                return $true
            }
        } catch { }
        Start-Sleep -Seconds 5
    }
    LogLine "WARNING: network not confirmed after ${TimeoutSec}s (continuing anyway)"
    return $false
}

# --- prep ---
if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$sessionId = (Get-Process -Id $PID).SessionId
LogLine "Watchdog: begin (user=$env:USERNAME, session=$sessionId, pid=$PID, interval=${CheckIntervalSec}s, flags in $SavedGamesDir)"

foreach ($s in @($StartDcsScript, $StartSrsScript)) {
    if (-not (Test-Path -LiteralPath $s)) {
        LogLine "ERROR: start script not found: $s"
        exit 1
    }
}

# --- initial startup ---
WaitForNetwork -TimeoutSec $StartupNetworkTimeoutSec | Out-Null

$started = Ensure-Running -Label "DCS" -ProcessName "DCS_server" -FlagPath $DcsFlag -ScriptPath $StartDcsScript -ExtraArgs $DcsScriptArgs
if ($started -and $DelayBeforeSrsSec -gt 0) { Start-Sleep -Seconds $DelayBeforeSrsSec }
Ensure-Running -Label "SRS" -ProcessName "SRS-Server" -FlagPath $SrsFlag -ScriptPath $StartSrsScript -ExtraArgs $SrsScriptArgs | Out-Null

if ($Once) {
    LogLine "Watchdog: -Once given, exiting after one pass"
    exit 0
}

# --- watchdog loop ---
LogLine "Watchdog: entering loop"
while ($true) {
    Start-Sleep -Seconds $CheckIntervalSec
    try {
        $restarted = $false
        if (Ensure-Running -Label "DCS" -ProcessName "DCS_server" -FlagPath $DcsFlag -ScriptPath $StartDcsScript -ExtraArgs $DcsScriptArgs) { $restarted = $true }
        if (Ensure-Running -Label "SRS" -ProcessName "SRS-Server" -FlagPath $SrsFlag -ScriptPath $StartSrsScript -ExtraArgs $SrsScriptArgs) { $restarted = $true }
        if ($restarted -and $RestartCooldownSec -gt 0) { Start-Sleep -Seconds $RestartCooldownSec }
    } catch {
        LogLine "WATCHDOG ERROR: $($_.Exception.Message)"
    }
}
