# DCS & SRS Process Control Setup

This guide explains, step by step, how to make the **Start**, **Stop** and **Restart** buttons of
the DCS Web Dashboard (Mission page and SRS page) start DCS and SRS **with their window visible**
on the server, and how to make the server fully unattended so nobody ever has to log on to it.

No prior knowledge of Windows Task Scheduler is assumed. Every option is explained. The scripts
mentioned here are in the `services` folder of the release ZIP (the folder this file is in).

**What you will do, in short:**

1. Copy the `services` folder to a permanent place on the server.
2. Run one script, once, that creates a few Windows "scheduled tasks".
3. Add two lines to the dashboard's settings and restart it.
4. Optionally make the server log on by itself at boot, so it works with nobody around.

## 1. The problem this solves

The dashboard runs as a Windows **service** (through NSSM). Windows runs services in a hidden
place called **Session 0**: it has no screen, no desktop, no windows. Anything a service starts
directly also lands in Session 0. DCS and SRS then run, but their windows exist nowhere you can
see them, and DCS does not behave well without a real desktop.

A window can only be shown inside a **user session**, the thing Windows creates when a user logs
on (at the keyboard, or through Remote Desktop). So the dashboard must ask Windows to start DCS
*inside* a user session instead of starting it itself.

The tool Windows provides for this is **Task Scheduler**. A scheduled task can be told
"run this program as user X, only when X is logged on". When a task is triggered, Task Scheduler
starts the program inside X's session, with X's desktop, so the window is visible. The dashboard
triggers the task, Task Scheduler does the launching.

Two consequences you must know:

- **A user must be logged on.** Locked screen is fine. A Remote Desktop session you *disconnected*
  is fine (the session stays alive). A session you *signed out* of is gone, and so is DCS.
- To be unattended, the server must log that user on **by itself at boot**. That is called
  auto-logon and is covered in section 6.

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| Session 0 | The hidden session where Windows services run. No desktop. |
| User session | What you get after logging on: a desktop with windows. Each logged-on user has one. Shown by the `quser` command with an ID number. |
| Console session | The session attached to the physical screen and keyboard. |
| RDP session | A session created by Remote Desktop. The same account can be moved from console to RDP and back. |
| Disconnect vs sign out | *Disconnect* closes the Remote Desktop window but keeps the session (and DCS) alive. *Sign out* destroys the session and kills everything in it. Always disconnect. |
| Scheduled task | An entry in Task Scheduler: a program to run, who runs it, when. Can be started on demand. |
| "Run only when user is logged on" | Task option. The program runs inside the user's session, window visible. This is the option the whole procedure relies on. |
| Trigger | What starts a task automatically (at logon, at a time). Our start tasks have no trigger: the dashboard starts them. |
| Auto-logon | Windows logs a chosen account on automatically at boot, without anyone typing a password. |
| NSSM | The tool that runs the dashboard as a service. Its "Environment" tab holds the dashboard's settings. |
| Watchdog | A small script that runs all the time and restarts DCS or SRS if they crash. |
| Elevated PowerShell | A PowerShell window opened with "Run as administrator". |

## 3. The scripts

| Script | What it does | Who runs it |
| --- | --- | --- |
| `Start-DCS.ps1` | Starts `DCS_server.exe` once and exits. | The "DCS Server Start" task, on demand. |
| `Start-SRS.ps1` | Starts `SRS-Server.exe` once and exits. | The "SRS Server Start" task, on demand. |
| `Register-DcsSrsTasks.ps1` | Creates the scheduled tasks for you. Called "the helper" below. | You, once per server. |
| `Watchdog-DCS-SRS.ps1` | Starts both at boot, restarts them if they crash. | The "DCS SRS Watchdog" task, at logon. |

All four must stay together in the same folder, and the folder must not move afterwards
(the tasks store its full path).

### 3.1 Start-DCS.ps1 options

You normally never type these yourself. You pass them once to the helper (section 5), which
stores them inside the task.

| Option | Default | Meaning |
| --- | --- | --- |
| `-DcsBin` | `C:\Program Files\Eagle Dynamics\DCS World OpenBeta Server\bin` | Folder that contains `DCS_server.exe`. Change it if your DCS is installed elsewhere, for example `C:\Program Files\Eagle Dynamics\DCS World Server\bin`. |
| `-DcsArgs` | `launch` | Arguments given to `DCS_server.exe`. `launch` opens the dedicated-server window. |
| `-LogDir` | `<your profile>\Saved Games\DCS.openbeta_server\Logs` | Folder where the script writes `dcs_start.log`. Any folder you like. |
| `-WaitForExitSec` | `30` | When the dashboard does a Restart, it kills DCS and then runs this task. DCS may need a moment to disappear. The script waits up to this many seconds for the old DCS to be gone before starting a new one. |

What it writes to `dcs_start.log`, one line per run: who ran it, in which session, then either
"DCS launched" with the process id, "already running -> skip", or an error.

### 3.2 Start-SRS.ps1 options

| Option | Default | Meaning |
| --- | --- | --- |
| `-SrsBin` | `C:\Program Files\DCS-SimpleRadio-Standalone\Server` | Folder that contains `SRS-Server.exe`. |
| `-SrsCfg` | `server.cfg` inside `-SrsBin` | The SRS configuration file to load. |
| `-LogDir` | same default as DCS | Folder for `srs_start.log`. |
| `-WaitForExitSec` | `30` | Same meaning as for DCS. |

### 3.3 Register-DcsSrsTasks.ps1 options (the helper)

| Option | Meaning |
| --- | --- |
| *(no option)* | Creates the two start tasks "DCS Server Start" and "SRS Server Start". Running it again is safe: it overwrites the tasks with the same settings, never duplicates them. |
| `-DcsScriptArgs '...'` | Text appended to the DCS task's command line. This is how you pass `-DcsBin`, `-LogDir`, etc. to `Start-DCS.ps1`. The whole text goes inside single quotes, and paths inside it use double quotes. |
| `-SrsScriptArgs '...'` | Same for SRS. |
| `-LockAtLogOn` | Also creates "Lock Workstation At Logon": locks the screen 20 seconds after the user logs on. Use it with auto-logon so the server never sits with an open desktop. |
| `-Watchdog` | Also creates "DCS SRS Watchdog": at logon, waits for the network, starts DCS then SRS, then restarts either one if it crashes. Requires `-SavedGamesDir`. |
| `-SavedGamesDir "..."` | Your DCS Saved Games folder, **the same value as `DCS_SAVED_GAMES_DIR` in NSSM**. The watchdog and the dashboard exchange small "stop" marker files in that folder (see section 7). |
| `-AtLogOn` | Alternative to `-Watchdog`: the two start tasks also fire at logon, with no crash recovery. Do not combine with `-Watchdog`. |
| `-SkipDcs`, `-SkipSrs` | Do not touch the DCS or SRS start task. Useful to add only the lock task later. |
| `-WhatIf` | Shows what would be created without creating anything. |

Every task is created with these settings, which you can also check in the Task Scheduler window
(Start menu, type "Task Scheduler", the tasks are in the top-level "Task Scheduler Library"):

- **General tab**: user = the account you ran the helper as; "Run only when user is logged on"
  selected; "Run with highest privileges" ticked.
- **Settings tab**: "Do not start a new instance" if already running; "Stop the task if it runs
  longer than 5 minutes" (no limit for the watchdog); start even on battery.
- **Triggers tab**: empty for the start tasks; "At log on" for the lock and watchdog tasks.

## 4. Prerequisites

- The dashboard is installed as an NSSM service and works (see the *Configuration (NSSM)* page of
  the documentation). Use the dashboard build that came with this `services` folder, or newer.
- DCS dedicated server and SRS server are installed and you know their folders.
- You know which Windows account will own the DCS window. Below it is called **the DCS account**.
  Use the same account for auto-logon, for running the helper, and for Remote Desktop.
- You can open an **elevated** PowerShell: Start menu, type "PowerShell", right-click
  "Windows PowerShell", "Run as administrator".

## 5. Step by step: the start tasks

Do this on each server.

### Step 5.1 Copy the scripts

Copy the whole `services` folder from the release ZIP next to the dashboard, for example to
`C:\DCS-Web-Dashboard\services`. It must contain `Start-DCS.ps1`, `Start-SRS.ps1`,
`Register-DcsSrsTasks.ps1` and `Watchdog-DCS-SRS.ps1`. Do not put it inside the DCS
installation folder (DCS updates may clean it) and do not move it later.

### Step 5.2 Log on as the DCS account

Log on to the server (console or Remote Desktop) **as the DCS account**. The helper creates the
tasks for the account that runs it. If you run it as another administrator, the tasks will wait
for *that* account to log on and will never run.

### Step 5.3 Run the helper

Open PowerShell as administrator, go to the folder, run the helper. Adapt the paths to your server:

```powershell
cd C:\DCS-Web-Dashboard\services
.\Register-DcsSrsTasks.ps1 `
    -DcsScriptArgs '-DcsBin "C:\Program Files\Eagle Dynamics\DCS World Server\bin" -LogDir "C:\DCS_Server_Data\Logs"' `
    -SrsScriptArgs '-LogDir "C:\DCS_Server_Data\Logs"'
```

The backtick at the end of a line just continues the command on the next line; you can also type
everything on one line. If your paths match the defaults of sections 3.1 and 3.2, the bare
`.\Register-DcsSrsTasks.ps1` is enough. If PowerShell answers that "running scripts is
disabled on this system", run it as
`powershell -ExecutionPolicy Bypass -File .\Register-DcsSrsTasks.ps1 ...` instead.

The helper prints each task it created and the exact command line stored in it.

### Step 5.4 Test the task without the dashboard

Still in the same session:

```powershell
Start-ScheduledTask -TaskName 'DCS Server Start'
```

The DCS window must open on your desktop within a few seconds. Then:

```powershell
Get-Process DCS_server | Select-Object Id, SessionId
quser
Get-Content "C:\DCS_Server_Data\Logs\dcs_start.log" -Tail 3
```

`SessionId` of DCS must be the same number as your session ID in the `quser` output, and the
last log line must say "DCS launched". If `SessionId` is 0, the task is not set to
"Run only when user is logged on" (see troubleshooting). Do the same with `'SRS Server Start'`.

### Step 5.5 Tell the dashboard to use the tasks

In NSSM (`nssm edit "DCS Web Dashboard"` in an elevated PowerShell, then the Environment tab)
add these two lines:

```
DCS_SCHEDULED_TASK_NAME=DCS Server Start
SRS_SCHEDULED_TASK_NAME=SRS Server Start
```

Keep `SRS_CFG_PATH` (the SRS settings page needs it). `DCS_START_CMD` and `SRS_START_CMD` are no
longer used when the task names are set; you can remove them. Click "Edit service", then restart
the service:

```powershell
Restart-Service "DCS Web Dashboard"
```

### Step 5.6 Test from the dashboard

From another computer, open the Mission page. Press **Stop** on the DCS box, wait for STOPPED,
press **Start**, wait for RUNNING, then **Restart**. The window on the server must disappear and
come back each time. Repeat on the SRS box. If something fails, the reason is shown in red under
the box. Rerun the commands of step 5.4 to confirm the session id.

## 6. Step by step: unattended server (auto-logon)

Without this, after a reboot nobody is logged on, and the start tasks cannot show a window until
someone connects. With it, Windows logs the DCS account on at boot, locks the screen, and the
dashboard can start and stop DCS at any time.

### Risks to weigh before you enable auto-logon

Auto-logon trades some security for convenience. Read this before step 6.1.

| Risk | Why | What to do |
| --- | --- | --- |
| The password is stored on the disk | Windows must know it to log on by itself. The Autologon tool stores it as an encrypted "LSA secret", but any administrator of that machine, or anyone who takes the disk out, can recover it. The registry method (`DefaultPassword`) stores it in clear text, do not use it. | Use a **dedicated account** for DCS with a password used nowhere else. Never a domain administrator or your personal account. Enable BitLocker on the system disk if the machine is not physically secure. |
| The desktop is unlocked right after boot | Between logon and the lock task there are about 20 seconds with an open desktop. | Keep the lock task (`-LockAtLogOn`). Only matters for people with physical access to the machine. |
| The account is always logged on | Whatever runs in that session (DCS, SRS, mission scripts) runs with that account's rights, all the time. | Give the account only what it needs. It has to be a local administrator for "Run with highest privileges" to mean anything; if you do not need that, keep it a standard user and the tasks will run with normal rights. |
| Remote Desktop exposure | You connect with the same account, so its password also opens Remote Desktop. | Do not expose Remote Desktop to the internet. Use a VPN or restrict it by firewall to your IP addresses, keep Network Level Authentication on, use a long password. |
| The scripts run at every logon with high rights | Anyone who can write to the `services` folder can change what runs at boot. | Keep the folder where only administrators can write (a folder directly under `C:\` has that by default). Do not put it on a share. |
| The dashboard can now kill and start server processes | Anyone with dashboard admin access can stop DCS and SRS. This was already true before this guide. | Protect the dashboard login (strong `ADMIN_PASSWORD` or Discord roles, HTTPS in front of it). |

If none of this is acceptable in your environment, skip section 6: everything else still works,
but somebody has to connect by Remote Desktop with the DCS account after each reboot, then
disconnect, before the dashboard can start DCS.

### Step 6.1 Configure auto-logon

Use Microsoft's **Autologon** tool (Sysinternals): it stores the password encrypted, unlike the
registry method. Download it from
<https://learn.microsoft.com/sysinternals/downloads/autologon>, extract it, then in an elevated
PowerShell, from the extracted folder:

```powershell
.\Autologon64.exe <DCS account name> $env:COMPUTERNAME <password>
```

For a Microsoft account (Windows 11), use the sign-in email address as the account name. The
tool prints "Autologon successfully configured". To remove it later: `.\Autologon64.exe /delete`.

### Step 6.2 Add the lock task

So the auto-logged-on desktop is never left open. Logged on as the DCS account, elevated:

```powershell
cd C:\DCS-Web-Dashboard\services
.\Register-DcsSrsTasks.ps1 -SkipDcs -SkipSrs -LockAtLogOn
```

(Or rerun your full step 5.3 command with `-LockAtLogOn` added; both give the same result.)

### Step 6.3 Reboot and check

Reboot the server. It must reach the lock screen by itself. Connect by Remote Desktop **with the
DCS account** and run `quser`: the DCS account must be listed, and you must be inside that same
session (the `>` marker). Then press Start in the dashboard: the window appears.

### Step 6.4 Operating rules

- Connect with Remote Desktop using the DCS account only.
- When you are done, **disconnect** (close the Remote Desktop window, or Start menu, account
  picture, Disconnect). **Never Sign out.** Signing out kills DCS and SRS and the dashboard
  cannot start them again until the next reboot or logon.

## 7. Step by step: crash recovery (watchdog)

The watchdog task starts at logon, waits until the network is up, starts DCS, waits 30 seconds,
starts SRS, then checks every 30 seconds and restarts whichever of the two is missing.

To make sure it does not fight the dashboard, the two agree on **marker files** in the Saved
Games folder:

- when you press **Stop** on the DCS box, the dashboard creates `dashboard_stop_dcs.flag`;
  the watchdog sees it and leaves DCS alone;
- when you press **Start** or **Restart**, the dashboard deletes the file and the watchdog
  resumes guarding DCS;
- `dashboard_stop_srs.flag` does the same for SRS.

Register it, logged on as the DCS account, elevated, using the same `-DcsScriptArgs` and
`-SrsScriptArgs` as in step 5.3 and your Saved Games folder:

```powershell
cd C:\DCS-Web-Dashboard\services
.\Register-DcsSrsTasks.ps1 -Watchdog -LockAtLogOn `
    -SavedGamesDir "C:\Users\<DCS account>\Saved Games\DCS.dcs_serverrelease" `
    -DcsScriptArgs '-DcsBin "C:\Program Files\Eagle Dynamics\DCS World Server\bin" -LogDir "C:\DCS_Server_Data\Logs"' `
    -SrsScriptArgs '-LogDir "C:\DCS_Server_Data\Logs"'
```

If you had another task or script that started DCS at boot before, disable it (do not delete it,
so you can go back). For the old all-in-one `Start-DCS-SRS.ps1` script:

```powershell
Get-ScheduledTask | Where-Object { $_.Actions.Arguments -match 'Start-DCS-SRS' } | Disable-ScheduledTask
```

Start the watchdog now without rebooting: `Start-ScheduledTask -TaskName 'DCS SRS Watchdog'`.
Its log is `dcs_srs_watchdog.log` in `<Saved Games>\Logs`.

Test: press Stop in the dashboard, wait two minutes, DCS must stay stopped. Press Start, then
close DCS by hand from its window: within about a minute the watchdog brings it back.

### What happens at a server reboot

With auto-logon (section 6) and the watchdog registered, a reboot runs by itself:

| Moment | What runs | Result |
| --- | --- | --- |
| Windows starts | auto-logon | The DCS account is logged on, a desktop session exists. |
| 20 s after logon | "Lock Workstation At Logon" | The screen is locked. Nothing else changes. |
| 30 s after logon | "DCS SRS Watchdog" | Waits for the network (up to 3 minutes), starts DCS, waits 30 s, starts SRS, then keeps watching. |
| any time later | "DCS Server Start" / "SRS Server Start" | **Not** started by the reboot. They have no trigger and only run when the dashboard (or you) starts them. |

So the watchdog is what starts DCS and SRS at boot; the two start tasks exist for the dashboard
buttons. If you prefer no watchdog, register with `-AtLogOn` instead of `-Watchdog`: the start
tasks then fire once at logon and nothing restarts DCS if it crashes.

Two things break this chain: removing auto-logon (nothing runs until someone connects with the
DCS account), and signing out instead of disconnecting (see step 6.4).

## 8. Checking and troubleshooting

Useful commands (any PowerShell on the server):

```powershell
# state of the tasks and result of their last run (0 = fine)
Get-ScheduledTask 'DCS Server Start','SRS Server Start' | Get-ScheduledTaskInfo | Select-Object TaskName, LastRunTime, LastTaskResult
# where the processes live (SessionId 0 = hidden Session 0, wrong)
Get-Process DCS_server, SRS-Server -ErrorAction SilentlyContinue | Select-Object Name, Id, SessionId
# who is logged on
quser
# what the dashboard did
Select-String -Path 'C:\DCS-Web-Dashboard\logs\dashboard*.log' -Pattern 'schtasks|Stopping DCS|Stopping SRS|stop flag' | Select-Object -Last 10
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| Dashboard says RUNNING, no window, `SessionId` is 0 | The task runs "whether user is logged on or not", or the dashboard still uses `DCS_START_CMD`. | Rerun the helper as the DCS account; check the NSSM variables of step 5.5; restart the service. |
| Dashboard shows "its user is not logged on to the server" | No session for the DCS account. | Log on (or set up auto-logon, section 6). Never sign out. |
| Window opens, but on the physical screen, not in your Remote Desktop | You connected with a different account than the DCS account. | Connect with the DCS account. |
| Dashboard shows "exit code 1", `LastTaskResult` is `1` | `Start-DCS.ps1` did not find `DCS_server.exe` (or SRS its config). | Fix `-DcsBin` / `-SrsCfg` in the helper command and rerun it. See the log in `-LogDir`. |
| Dashboard shows "exit code 2", `LastTaskResult` is `2` | Windows refused to launch the executable. | See the log in `-LogDir`; check the file is not blocked or missing permissions. |
| Dashboard shows "no DCS process appeared within 15s" | The task ran but DCS did not start, or took too long. | Look at `dcs_start.log` and the DCS log itself. |
| After Restart the dashboard stays STOPPED | The old DCS took longer than 30 seconds to die. | Raise `-WaitForExitSec` in `-DcsScriptArgs` and rerun the helper. |
| DCS comes back one minute after every Stop | An old boot script or task is still running (section 7), or the dashboard is older than this `services` folder. | Disable that task; update the dashboard. |
| "Task is not in the allowed whitelist" on the Tasks page | `DCS_TASK_WHITELIST` is set in NSSM. | Add the task names to it, or leave the variable empty. |
| Helper refuses to run: "requires ... Administrator" | PowerShell is not elevated. | Right-click PowerShell, Run as administrator. |
| Helper refuses to run: "running scripts is disabled" | Execution policy. | Run `powershell -ExecutionPolicy Bypass -File .\Register-DcsSrsTasks.ps1 ...`. |

To undo everything: open Task Scheduler and delete the four tasks (or
`Unregister-ScheduledTask -TaskName 'DCS Server Start'` for each), remove the two variables from
NSSM, run `Autologon64.exe /delete`.
