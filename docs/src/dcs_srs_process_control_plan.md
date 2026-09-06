# DCS / SRS Process Control Plan

Status: proposed 2026-09-06, branch `authentication`. Decision D1 = Task Scheduler (A).
Phase 1 implemented 2026-09-06: `Features/Services/Start-DCS.ps1`, `Start-SRS.ps1`, the Phase 2
helper `Register-DcsSrsTasks.ps1` (switches `-AtLogOn`, `-Watchdog`, `-LockAtLogOn`) and the W2
watchdog `Watchdog-DCS-SRS.ps1` exist and were dry-run locally. Phases 2 and 3 done on the
`tbell` host the same day: the "DCS Server Start" task opens DCS in the user's RDP session
(verified by session id) and the NSSM variables are set. Phase 2b done on Windows 11 the same day
(auto-logon, lock task and watchdog task registered; watchdog to stay disabled until the Phase 4
build is installed). Phase 6 pulled forward: end-user guide `docs/src/process_control_setup.md`
(in `SUMMARY.md`) and the task-name variables documented in `configuration.md`.
Phases 4 and 5 implemented 2026-09-06 (uncommitted): `routes/system.rs` DCS/SRS handlers merged
into one `ProcessTarget` path with `Wait-Process` on stop, stop-flag create/remove, `schtasks`
exit check plus `Get-ScheduledTaskInfo` polling (`0x800704DD` = user not logged on, exit codes 1/2
= script errors), fallback launch without `-WindowStyle Hidden`; Mission page shows the `error`
string under each box and Restart is enabled unless checking; SRS page shows the backend error.
Not yet done: live test of the new build, release packaging of the scripts (see "Open issue").

## Packaging (resolved 2026-09-06)

`.gitignore` line 102 ignores the whole `Features/` tree, so the scripts written there were
untracked. They now live in a tracked `services/` folder at the repo root together with
`services/README.md`, the beginner guide; `docs/src/process_control_setup.md` includes that README
so there is one source. `build_release.ps1` copies `services\` into the release folder and ZIP
and fails if any of the five files is missing. The `Features/Services` copies are left in place
(ignored, not deleted).

## Goal

Make the **Start** and **Restart** buttons on the Mission page (DCS + SRS boxes) and the SRS page
bring up DCS and SRS **with their GUI visible** on the dedicated-server desktop, on both hosts
(Windows Server 2019 and Windows 11). The start path must reuse two one-shot PowerShell scripts split
out of `Features/Services/Start-DCS-SRS.ps1`, one for DCS and one for SRS.

## Current state (what the code does today)

| Layer | DCS | SRS |
| --- | --- | --- |
| Frontend | `web-dashboard/src/app/mission/page.tsx` `manageProcess()` → `POST /api/server/dcs-process {action}`; status from `GET` every 5 s. Errors are swallowed (`.catch(console.error)`), so a failed start just shows `STOPPED` again after the next poll. | Mission page `manageSrsProcess()` and SRS page `manageSrsProcess()` → `POST /api/server/srs-process`. The SRS page surfaces a generic error; the mission page does not. Restart is disabled unless running on the mission page but always enabled on the SRS page. |
| Backend stop | `rust-web-dashboard/src/routes/system.rs` `dcs_process_post`: `Stop-Process -Name 'DCS','DCS_server' -Force`. | `srs_process_post`: `Stop-Process -Name 'SRS-Server' -Force`. |
| Backend restart | stop, fixed `sleep 2 s`, then start. | same. |
| Backend start, in priority order | 1. `DCS_SCHEDULED_TASK_NAME` set → `schtasks /run /tn <name>` (spawned, exit code ignored). 2. `DCS_START_CMD` set → `win_session::launch_in_user_session()` (Win32 `CreateProcessAsUser` in the *console* session) and, if that fails, PowerShell `Start-Process … -WindowStyle Hidden` from the service's own session. 3. Neither → HTTP 500. | identical logic with `SRS_SCHEDULED_TASK_NAME` / `SRS_START_CMD`. |
| Config | `config.rs`: `dcs_start_cmd`, `dcs_scheduled_task`, `srs_start_cmd`, `srs_scheduled_task`, `srs_cfg_path` (derived from `-cfg=` in `SRS_START_CMD` when unset). | |
| Docs | `docs/src/configuration.md` documents `DCS_START_CMD` / `SRS_START_CMD` only. **`DCS_SCHEDULED_TASK_NAME` and `SRS_SCHEDULED_TASK_NAME` are not documented** although they are the preferred path in the code. | |
| Your script | `Features/Services/Start-DCS-SRS.ps1` (identical copy in `archive/rust-web-dashboard/`): waits for network, starts `DCS_server.exe launch`, waits 30 s, starts `SRS-Server.exe -cfg=…`, then **loops forever** as a watchdog (every 30 s, restarts whichever process is missing). `archive/rust-web-dashboard/Start-DCS.ps1` and `Start-SRS.ps1` are older one-shot versions for the other host (`tbell`, `DCS World Server`, `DCS.dcs_serverrelease`). | |

Assumption: the combined script is currently launched at logon (or by hand) inside an interactive
desktop session, which is why it shows the GUI while the dashboard does not.

## Why the GUI is missing when the dashboard starts DCS

The dashboard runs as an NSSM service in **Session 0**, which has no desktop. Everything it spawns
directly inherits Session 0. The code tries to escape that with `CreateProcessAsUser`, but that path
fails or misbehaves in exactly the situations you have:

1. **RDP on Server 2019.** `WTSGetActiveConsoleSessionId()` returns the *physical console* session.
   An RDP session is a different session. If nobody is logged on at the console, `WTSQueryUserToken`
   fails and the code falls back to `Start-Process -WindowStyle Hidden` from Session 0: process
   running, window nowhere. If someone *is* logged on at the console, DCS opens there, invisible to
   the RDP user.
2. **Service account.** `WTSQueryUserToken` needs `SE_TCB_NAME` (LocalSystem). If the NSSM service
   runs as a normal user, the Win32 path always fails and the hidden fallback is used.
3. **The fallback is hidden by design.** `-WindowStyle Hidden` plus Session 0 means the window can
   never be seen even on the Win11 box.
4. **Argument mismatch.** The documented `DCS_START_CMD` example uses `--server --norender`, which
   shows no window on purpose. Your script uses `DCS_server.exe launch`, which opens the server GUI.

How to confirm on each host before changing anything (read-only):

```powershell
# 0 = Session 0 (service session, no desktop); your own session id is shown by `quser`
Get-Process DCS_server, SRS-Server -ErrorAction SilentlyContinue | Select-Object Name, Id, SessionId
quser
# NSSM stderr log: look for "Win32 interactive session launch failed" or
# "Successfully launched DCS in interactive user session"
Select-String -Path '<dashboard-folder>\logs\dashboard*.log' -Pattern 'interactive session|schtasks|Spawning DCS'
```

## Design decision: Task Scheduler runs the two scripts

Register one scheduled task per script, configured **"Run only when user is logged on"**
(`LogonType Interactive`). Task Scheduler then launches the action inside that user's interactive
session, console *or* RDP, with a real desktop. This is the standard, supported way for a service
to start a GUI application, and the backend already supports it through
`DCS_SCHEDULED_TASK_NAME` / `SRS_SCHEDULED_TASK_NAME`. The Rust changes below are hardening only.

Alternatives considered:

- **B. Fix `win_session.rs`** to enumerate sessions (`WTSEnumerateSessionsW`, pick the `WTSActive`
  one) and run `powershell -File Start-DCS.ps1` through `CreateProcessAsUser`. More unsafe Win32
  code, still requires LocalSystem, and ambiguous when a console user and an RDP user are both
  logged on. Worth doing later only as a fallback when no task is configured. Not needed for the goal.
- **C. Run DCS itself as an NSSM service.** Session 0, no GUI ever. Rejected.

Prerequisite on both hosts: a user must be logged on (auto-logon plus lock screen is fine; a
*disconnected* RDP session still counts as logged on, a *signed-out* one does not).

## Phase 1: split the script into two one-shot scripts

New files, next to the existing one (the original is left untouched until decision D3):

- `Features/Services/Start-DCS.ps1`
- `Features/Services/Start-SRS.ps1`

Shared contract:

- `param()` block with per-host overrides, so one script serves both servers and the differences
  live in the task arguments, not in the file:
  - DCS: `-DcsBin` (default `C:\Program Files\Eagle Dynamics\DCS World OpenBeta Server\bin`),
    `-DcsArgs` (default `launch`), `-LogDir` (default `$env:USERPROFILE\Saved Games\DCS.openbeta_server\Logs`),
    `-WaitForExitSec` (default 30).
  - SRS: `-SrsBin`, `-SrsCfg`, `-LogDir`, `-WaitForExitSec`.
- **One-shot**: launch and exit. No watchdog loop, otherwise the task stays `Running` and
  `schtasks /run` refuses the next click.
- **Restart race guard**: if the process is still alive (the backend kills it only a moment
  before), wait up to `-WaitForExitSec` for it to disappear before deciding "already running".
  Today's `IsProcessRunning → skip` logic would silently do nothing during a restart.
- `Start-Process` **without** `-WindowStyle Hidden`, working directory set, as today.
- Log file per script (`dcs_start.log`, `srs_start.log`) and log the session id of the script
  itself (`(Get-Process -Id $PID).SessionId`) so a log line proves it ran on the desktop.
- Exit codes: `0` launched or already running, `1` executable/config missing, `2` launch failed.
  The task's *Last Run Result* then becomes meaningful.
- Keep the network wait out of these scripts (it belongs to boot time, see watchdog section).

## Phase 2: register the scheduled tasks on each host

Done once per server, as the desktop user (admin on Server 2019). Either by hand or via a small
helper `Features/Services/Register-DcsSrsTasks.ps1` that takes the script folder and paths as
parameters and runs, for each of DCS and SRS:

```powershell
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\<path>\Start-DCS.ps1"'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
             -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'DCS Server Start' -Action $action -Principal $principal -Settings $settings
```

Notes:

- `-WindowStyle Hidden` here hides only the PowerShell host; the DCS child window is still shown.
- `LogonType Interactive` is the whole point. Do **not** tick "Run whether user is logged on or
  not" (that is a Session 0 launch again).
- No trigger is required for dashboard use. Optionally add an `AtLogOn` trigger to the DCS task
  so it also replaces the boot-time start of the old combined script (decision D5).
- If `DCS_TASK_WHITELIST` is set, add both task names so they also appear on the Tasks page as a
  manual fallback.
- Test from an RDP session before touching the dashboard:
  `Start-ScheduledTask -TaskName 'DCS Server Start'` must open the DCS window in *your* session.

## Phase 2b: unattended boot (no manual logon, ever)

Goal restated by the user on 2026-09-06: everything is driven from the dashboard, nobody logs on
to the servers. A visible window still needs a desktop, and a desktop only exists in a logged-on
session, so the session has to be created by Windows itself at boot:

1. **Auto-logon** of the DCS account on both hosts. Server 2019 already has it (the old combined
   script shows the GUI after the 4 AM reboot). Windows 11 does not yet: use Sysinternals
   `Autologon.exe` (password stored encrypted in LSA), or `netplwiz` after turning off
   "require Windows Hello sign-in" in Settings > Accounts > Sign-in options.
2. **Lock 20 s after logon** so the auto-logged-on desktop is never left open:
   `Register-DcsSrsTasks.ps1 -LockAtLogOn` registers "Lock Workstation At Logon"
   (`rundll32 user32.dll,LockWorkStation`). DCS keeps running behind the lock screen.
3. **Start at boot** either with `-AtLogOn` on the two start tasks, or with the watchdog task
   (below), not both.
4. **Operating rule:** RDP with the same account, always *disconnect*, never *sign out*.
   Sign-out destroys the session and kills DCS; the next dashboard Start then fails with the
   `schtasks` "not logged on" error, which Phase 4 surfaces in the UI.

## Watchdog: decision W2 taken 2026-09-06

`Features/Services/Watchdog-DCS-SRS.ps1` replaces the loop of the old combined script: network
wait, start DCS, delay, start SRS, then a loop that restarts whichever process is missing. It
**skips** a process while a flag file exists in the Saved Games folder:

| Flag | Created by | Removed by |
| --- | --- | --- |
| `<DCS_SAVED_GAMES_DIR>\dashboard_stop_dcs.flag` | dashboard **Stop** (DCS) | dashboard **Start** / **Restart** (DCS) |
| `<DCS_SAVED_GAMES_DIR>\dashboard_stop_srs.flag` | dashboard **Stop** (SRS) | dashboard **Start** / **Restart** (SRS) |

Registered by `Register-DcsSrsTasks.ps1 -Watchdog -SavedGamesDir <same as DCS_SAVED_GAMES_DIR>`
as "DCS SRS Watchdog", at log on, no execution limit. The flag handling on the dashboard side is
part of Phase 4. **Until Phase 4 is deployed, the watchdog (old or new) undoes every dashboard
Stop within a minute**, so on Server 2019 the old task that runs `Start-DCS-SRS.ps1` is disabled
(not deleted) at the same time as the Phase 4 build is installed, and the new watchdog task is
started right after.

## Phase 3: point the dashboard at the tasks (NSSM environment, per host)

- Add `DCS_SCHEDULED_TASK_NAME=DCS Server Start` and `SRS_SCHEDULED_TASK_NAME=SRS Server Start`.
- Keep `SRS_CFG_PATH` (the settings editor needs it; it is no longer derivable from `SRS_START_CMD`).
- `DCS_START_CMD` / `SRS_START_CMD` become unused because the task path has priority in the code.
  They can stay as a fallback or be removed.
- Restart the dashboard service.

At this point Start / Restart from the dashboard should already show the GUI **with no code
change**. Validate this on both hosts before starting Phase 4.

## Phase 4: backend hardening (`routes/system.rs`)

1. **Restart race.** Replace the fixed 2 s sleep with a wait for the process to actually exit:
   `Stop-Process …; Wait-Process -Name 'DCS','DCS_server' -Timeout 30 -ErrorAction SilentlyContinue`
   (same for SRS). Together with the script-side guard this makes restart deterministic.
2. **Check `schtasks`.** Use `.output().await` instead of `.spawn()`, check the exit status and
   return HTTP 500 with the `schtasks` stderr text (task not found, access denied). Today a failed
   start returns `{"success": true}`. Caveat: when the task's user is not logged on,
   `schtasks /run` still exits 0 ("Attempted to run"); the failure only shows in the task's
   `LastTaskResult` (`0x800704DD`, user has not logged on). So after a successful `/run`, poll
   `Get-ScheduledTaskInfo` for a few seconds and report `LastTaskResult` when it is non-zero and
   `LastRunTime` is newer than the request, or fall back to checking that the process appeared.
3. **Stop flags for the watchdog (W2).** On Stop, create `<DCS_SAVED_GAMES_DIR>\dashboard_stop_dcs.flag`
   (resp. `_srs`); on Start and Restart, delete it before running the task. Best effort, logged,
   never fails the request.
4. **Deduplicate.** The DCS and SRS handlers are copy-pasted. Factor a `ProcessTarget` struct
   (process names, task name, start command, log label) and one `start_target()` /
   `stop_target()` pair. Pure refactor, same JSON shapes.
5. **Fallback path.** Drop `-WindowStyle Hidden` from the PowerShell fallback: when the dashboard
   is run from a desktop (not as a service) that flag is the only thing hiding the window.
6. **Optional, small:** extend `GET /api/server/dcs-process` (and SRS) with
   `start_method: "task" | "cmd" | "none"` and the task's state so the UI can explain a disabled
   Start button. Requires an `openapi.json` regeneration (`cargo test dump_openapi -- --ignored`).

`win_session.rs` is left as is. Option B above can improve it later, independently.

## Phase 5: frontend (small)

- `mission/page.tsx`: make `manageProcess()` and `manageSrsProcess()` read the response, show the
  `error` string under the box (same pattern as `processError` on the SRS page) instead of
  silently going back to `STOPPED`.
- Align the Restart button rule between the mission page (disabled unless running) and the SRS
  page (always enabled). Suggest: enabled unless `checking`, since after Phase 4 restart is
  safe when the process is already dead.
- No polling changes: the existing 5 s poll picks up the new process.

## Phase 6: docs

- `configuration.md`: document `DCS_SCHEDULED_TASK_NAME` / `SRS_SCHEDULED_TASK_NAME`, their
  priority over `*_START_CMD`, the Session 0 explanation, and the task registration steps
  (link to Phase 2). Fix the `SRS_START_CMD` example: it currently shows a full `Start-Process …`
  command, but the backend treats the first token as the executable path and `config.rs` would
  extract a broken `-cfg=` value from it.
- `features.md`: describe the DCS Server Process box on the Mission page (only SRS is described).
- `SUMMARY.md`: add this plan.

## Watchdog: decision needed

The combined script's loop restarts DCS/SRS within 30 to 60 s whenever they are not running. If it
is still running on a host, every dashboard **Stop** is undone shortly after. Options:

- **W1. Retire the watchdog.** Boot start via the `AtLogOn` trigger (D5); the dashboard handles the
  rest. Simplest, but an unattended crash is no longer auto-recovered.
- **W2. Watchdog with a maintenance flag (recommended).** New `Features/Services/Watchdog-DCS-SRS.ps1`
  = network wait + the old loop, calling the two new scripts. It skips restarting while a flag
  file exists (e.g. `<DCS_SAVED_GAMES_DIR>\dashboard_maintenance.flag`). The dashboard **Stop**
  creates the flag, **Start** removes it (about 10 lines of Rust in the stop/start helpers, path
  derived from `DCS_SAVED_GAMES_DIR`). Registered as its own `AtLogOn` task.
- **W3. Watchdog as a task the dashboard pauses.** Dashboard Stop also runs `Stop-ScheduledTask`
  on the watchdog task and Start restarts it. Needs a third env var and couples the two features.

## Decisions for review

| # | Question | Proposal |
| --- | --- | --- |
| D1 | Task Scheduler (A) or fix `win_session.rs` (B)? | A now, B later as fallback only. |
| D2 | Script names and location | `Features/Services/Start-DCS.ps1`, `Start-SRS.ps1`, optional `Register-DcsSrsTasks.ps1`. Original file untouched. |
| D3 | Watchdog | W2, as a separate phase after Phases 1 to 3 are validated. |
| D4 | Task names | `DCS Server Start`, `SRS Server Start` (spaces are fine, the name is passed as one argument). |
| D5 | `AtLogOn` trigger on the DCS task (and SRS, or watchdog) to replace the old boot start | Yes on the watchdog task if W2; else on both start tasks. |
| D6 | Phase 4.5 (`start_method` in GET) | Skip for now; the error message from 4.2 is enough. |

## Validation checklist (per host)

1. Run `Start-DCS.ps1` by hand from an RDP or console session: GUI appears, log shows a non-zero
   session id.
2. `Start-ScheduledTask 'DCS Server Start'` from the same session: GUI appears,
   `Get-Process DCS_server | Select SessionId` matches `quser`.
3. Dashboard Start, Stop, Restart from another machine; check `logs\dashboard*.log`.
4. Server 2019: repeat with the RDP session *disconnected* (not signed out). Then sign out and
   confirm the dashboard shows the `schtasks` error instead of a silent success.
5. Windows 11: same, from the console session.
6. With the watchdog (if W2): Stop from the dashboard, wait 2 minutes, DCS must stay down; Start,
   then kill DCS by hand, watchdog must bring it back.

## Side notes found during review

- `Stop-Process -Name 'DCS'` also kills a DCS *client* (`DCS.exe`) running on the same machine. Fine
  on a dedicated server, worth knowing on the Windows 11 box if it is ever used to play.
- `archive/rust-web-dashboard/docs/start-dashboard.ps1` contains a JWT secret, an admin password
  and a Discord client secret in clear text and is tracked in git. If those values were ever real,
  rotate them. Nothing is deleted by this plan.
