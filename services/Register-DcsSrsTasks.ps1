#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Register the scheduled tasks used by the DCS Web Dashboard to start DCS and SRS
    with a visible GUI, plus the optional boot-time tasks (watchdog, lock at logon).

.DESCRIPTION
    Run this ONCE per server, from an elevated PowerShell, logged on as the
    desktop user that should own the DCS and SRS windows (the auto-logon account).

    Always registered (unless -SkipDcs / -SkipSrs):
      "DCS Server Start"  -> Start-DCS.ps1
      "SRS Server Start"  -> Start-SRS.ps1
    Each runs with LogonType Interactive ("Run only when user is logged on"),
    which is what makes the process appear on the desktop instead of in Session 0,
    RunLevel Highest, MultipleInstances IgnoreNew, a 5 minute execution limit.
    The dashboard triggers them through `schtasks /run`; no trigger is needed.

    Optional:
      -AtLogOn      add an "At log on" trigger to the two start tasks (boot start
                    without a watchdog). Do not combine with -Watchdog.
      -Watchdog     register "DCS SRS Watchdog" -> Watchdog-DCS-SRS.ps1, at log on,
                    no execution limit. It starts both and restarts them when they
                    die, honouring the dashboard's stop flags.
      -LockAtLogOn  register "Lock Workstation At Logon" so an auto-logon desktop is
                    locked 20 s after logon. DCS keeps running behind the lock screen.

    Afterwards set these in the dashboard's NSSM environment and restart it:
        DCS_SCHEDULED_TASK_NAME=DCS Server Start
        SRS_SCHEDULED_TASK_NAME=SRS Server Start

.PARAMETER ScriptDir
    Folder containing the scripts. Defaults to this script's folder.

.PARAMETER DcsTaskName
.PARAMETER SrsTaskName
.PARAMETER WatchdogTaskName
.PARAMETER LockTaskName
    Task names. The first two must match DCS_SCHEDULED_TASK_NAME / SRS_SCHEDULED_TASK_NAME.

.PARAMETER DcsScriptArgs
.PARAMETER SrsScriptArgs
    Extra arguments appended to the start-script command lines, for per-host paths.
    Also forwarded to the watchdog.
    Example: -DcsScriptArgs '-DcsBin "C:\Program Files\Eagle Dynamics\DCS World Server\bin" -LogDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease\Logs"'

.PARAMETER SavedGamesDir
    DCS Saved Games folder for the watchdog (flag files, default log dir). Must equal
    the dashboard's DCS_SAVED_GAMES_DIR. Only used with -Watchdog.

.PARAMETER WatchdogArgs
    Extra arguments for Watchdog-DCS-SRS.ps1 (e.g. '-CheckIntervalSec 60').

.EXAMPLE
    .\Register-DcsSrsTasks.ps1

.EXAMPLE
    .\Register-DcsSrsTasks.ps1 -Watchdog -LockAtLogOn `
        -SavedGamesDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease" `
        -DcsScriptArgs '-DcsBin "C:\Program Files\Eagle Dynamics\DCS World Server\bin" -LogDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease\Logs"' `
        -SrsScriptArgs '-LogDir "C:\Users\tbell\Saved Games\DCS.dcs_serverrelease\Logs"'
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ScriptDir = "",
    [string]$DcsTaskName = "DCS Server Start",
    [string]$SrsTaskName = "SRS Server Start",
    [string]$WatchdogTaskName = "DCS SRS Watchdog",
    [string]$LockTaskName = "Lock Workstation At Logon",
    [string]$DcsScriptArgs = "",
    [string]$SrsScriptArgs = "",
    [string]$SavedGamesDir = "",
    [string]$WatchdogArgs = "",
    [switch]$AtLogOn,
    [switch]$Watchdog,
    [switch]$LockAtLogOn,
    [switch]$SkipDcs,
    [switch]$SkipSrs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# $PSScriptRoot is empty inside param() defaults under `powershell.exe -File`; resolve it here.
if ([string]::IsNullOrWhiteSpace($ScriptDir)) {
    $ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
}

if ($AtLogOn -and $Watchdog) {
    throw "Use either -AtLogOn (start tasks fire at logon) or -Watchdog (the watchdog starts them), not both."
}

$userId = "$env:USERDOMAIN\$env:USERNAME"

function Quote-Arg([string]$Value) {
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Register-Task {
    param(
        [string]$TaskName,
        [string]$Execute,
        [string]$Argument,
        [string]$RunLevel,
        [bool]$LogonTrigger,
        [string]$LogonDelay = "",
        [System.Nullable[System.TimeSpan]]$ExecutionTimeLimit = (New-TimeSpan -Minutes 5)
    )

    $action = New-ScheduledTaskAction -Execute $Execute -Argument $Argument
    # Interactive = "Run only when user is logged on": the task runs inside the
    # user's desktop session (console or RDP), which is what shows the GUI.
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel $RunLevel

    $settingsParams = @{
        MultipleInstances          = "IgnoreNew"
        AllowStartIfOnBatteries    = $true
        DontStopIfGoingOnBatteries = $true
        StartWhenAvailable         = $true
    }
    if ($null -ne $ExecutionTimeLimit) {
        $settingsParams.ExecutionTimeLimit = $ExecutionTimeLimit
    } else {
        # Zero = "Stop the task if it runs longer than" unchecked (no limit).
        $settingsParams.ExecutionTimeLimit = [TimeSpan]::Zero
    }
    $settings = New-ScheduledTaskSettingsSet @settingsParams

    $registerParams = @{
        TaskName  = $TaskName
        Action    = $action
        Principal = $principal
        Settings  = $settings
        Force     = $true
    }
    if ($LogonTrigger) {
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
        if ($LogonDelay) { $trigger.Delay = $LogonDelay }
        $registerParams.Trigger = $trigger
    }

    if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task")) {
        Register-ScheduledTask @registerParams | Out-Null
        Write-Host "Registered task '$TaskName'"
        Write-Host "    runs as : $userId (interactive, $RunLevel)"
        Write-Host "    action  : $Execute $Argument"
        if ($LogonTrigger) { Write-Host "    trigger : at log on$(if ($LogonDelay) { " (delay $LogonDelay)" })" }
        if ($null -eq $ExecutionTimeLimit) { Write-Host "    limit   : none (verify 'Stop the task if it runs longer than' is unchecked)" }
    }
}

function Register-ScriptTask {
    param(
        [string]$TaskName,
        [string]$ScriptName,
        [string]$ExtraArgs,
        [bool]$LogonTrigger,
        [System.Nullable[System.TimeSpan]]$ExecutionTimeLimit = (New-TimeSpan -Minutes 5)
    )
    $scriptPath = Join-Path $ScriptDir $ScriptName
    if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Script not found: $scriptPath" }

    $argument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
    if (-not [string]::IsNullOrWhiteSpace($ExtraArgs)) { $argument += " $ExtraArgs" }

    Register-Task -TaskName $TaskName -Execute "powershell.exe" -Argument $argument -RunLevel "Highest" `
        -LogonTrigger $LogonTrigger -LogonDelay "PT30S" -ExecutionTimeLimit $ExecutionTimeLimit
}

if (-not $SkipDcs) {
    Register-ScriptTask -TaskName $DcsTaskName -ScriptName "Start-DCS.ps1" -ExtraArgs $DcsScriptArgs -LogonTrigger ([bool]$AtLogOn)
}
if (-not $SkipSrs) {
    Register-ScriptTask -TaskName $SrsTaskName -ScriptName "Start-SRS.ps1" -ExtraArgs $SrsScriptArgs -LogonTrigger ([bool]$AtLogOn)
}

if ($Watchdog) {
    $wdArgs = ""
    if ($SavedGamesDir) { $wdArgs += " -SavedGamesDir $(Quote-Arg $SavedGamesDir)" }
    if ($DcsScriptArgs) { $wdArgs += " -DcsScriptArgs $(Quote-Arg $DcsScriptArgs)" }
    if ($SrsScriptArgs) { $wdArgs += " -SrsScriptArgs $(Quote-Arg $SrsScriptArgs)" }
    if ($WatchdogArgs)  { $wdArgs += " $WatchdogArgs" }
    Register-ScriptTask -TaskName $WatchdogTaskName -ScriptName "Watchdog-DCS-SRS.ps1" -ExtraArgs $wdArgs.Trim() `
        -LogonTrigger $true -ExecutionTimeLimit $null
}

if ($LockAtLogOn) {
    Register-Task -TaskName $LockTaskName -Execute "rundll32.exe" -Argument "user32.dll,LockWorkStation" `
        -RunLevel "Limited" -LogonTrigger $true -LogonDelay "PT20S" -ExecutionTimeLimit (New-TimeSpan -Minutes 1)
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Test from your desktop session:  Start-ScheduledTask -TaskName '$DcsTaskName'"
Write-Host "     The DCS window must appear. Check the log written by Start-DCS.ps1 (session id must not be 0)."
Write-Host "  2. Add to the dashboard NSSM environment, then restart the service:"
Write-Host "       DCS_SCHEDULED_TASK_NAME=$DcsTaskName"
Write-Host "       SRS_SCHEDULED_TASK_NAME=$SrsTaskName"
Write-Host "  3. If DCS_TASK_WHITELIST is set, add the task names to it so they show on the Tasks page."
if ($Watchdog) {
    Write-Host "  4. Disable (do not delete) any old task that still runs Start-DCS-SRS.ps1:"
    Write-Host "       Get-ScheduledTask | Where-Object { `$_.Actions.Arguments -match 'Start-DCS-SRS' } | Disable-ScheduledTask"
    Write-Host "     Start the watchdog now without rebooting:  Start-ScheduledTask -TaskName '$WatchdogTaskName'"
}
