//! Launch a process in the active interactive Windows session.
//!
//! When the dashboard runs as an NSSM service (Session 0), any child process
//! inherits Session 0 — which has no desktop.  DCS needs a window/desktop
//! even with `--norender`, so it silently dies after `Immediate load done`.
//!
//! This module uses Win32 APIs to find the active console session, obtain the
//! user's token, and call `CreateProcessAsUser` so DCS runs in the interactive
//! session with a desktop.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::ptr;

use winapi::shared::minwindef::{DWORD, FALSE, LPVOID};
use winapi::um::errhandlingapi::GetLastError;
use winapi::um::handleapi::CloseHandle;
use winapi::um::processthreadsapi::{
    CreateProcessAsUserW, PROCESS_INFORMATION, STARTUPINFOW,
};
use winapi::um::userenv::{CreateEnvironmentBlock, DestroyEnvironmentBlock};
use winapi::um::winbase::{CREATE_NEW_CONSOLE, CREATE_UNICODE_ENVIRONMENT, NORMAL_PRIORITY_CLASS, WTSGetActiveConsoleSessionId};
use winapi::um::winnt::HANDLE;
use winapi::um::wtsapi32::WTSQueryUserToken;

/// Encode a Rust string as a null-terminated wide (UTF-16) vector for Win32.
fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Encode a Rust string as a mutable null-terminated wide (UTF-16) vector.
/// `CreateProcessAsUserW` requires a mutable `lpCommandLine`.
fn to_wide_mut(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

/// Launch `exe_path` with the given arguments in the active interactive session.
///
/// Returns `Ok(())` on success, or an error string describing the failure.
///
/// # Safety
///
/// Calls unsafe Win32 functions (`WTSGetActiveConsoleSessionId`,
/// `WTSQueryUserToken`, `CreateEnvironmentBlock`, `CreateProcessAsUser`).
pub fn launch_in_user_session(exe_path: &str, args: &str, working_dir: Option<&str>) -> Result<(), String> {
    unsafe {
        // 1. Get the active console session (the one with keyboard/mouse/display).
        let session_id: DWORD = WTSGetActiveConsoleSessionId();
        if session_id == 0xFFFFFFFF {
            return Err("No active console session found (is anyone logged in?)".into());
        }
        tracing::info!("Active console session ID: {}", session_id);

        // 2. Get the user token for that session.
        let mut user_token: HANDLE = ptr::null_mut();
        if WTSQueryUserToken(session_id, &mut user_token) == FALSE {
            let err = GetLastError();
            return Err(format!(
                "WTSQueryUserToken failed for session {}: Win32 error {}. \
                 The service may need to run as LocalSystem or have SE_TCB_NAME privilege.",
                session_id, err
            ));
        }
        tracing::info!("Got user token for session {}", session_id);

        // Ensure we close the token handle on all exit paths.
        let _token_guard = HandleGuard(user_token);

        // 3. Create an environment block for the user.
        let mut env_block: LPVOID = ptr::null_mut();
        if CreateEnvironmentBlock(&mut env_block, user_token, FALSE) == FALSE {
            let err = GetLastError();
            tracing::warn!("CreateEnvironmentBlock failed (error {}), proceeding without", err);
            env_block = ptr::null_mut();
        }
        let _env_guard = if !env_block.is_null() {
            Some(EnvBlockGuard(env_block))
        } else {
            None
        };

        // 4. Build the command line.  CreateProcessAsUserW wants the full
        //    command line (exe + args) as a single mutable wide string.
        let cmd_line = if args.is_empty() {
            format!("\"{}\"", exe_path)
        } else {
            format!("\"{}\" {}", exe_path, args)
        };
        let mut cmd_wide = to_wide_mut(&cmd_line);

        // Optional working directory.
        let wd_wide: Option<Vec<u16>> = working_dir.map(|d| to_wide(d));
        let wd_ptr: *const u16 = wd_wide.as_ref().map_or(ptr::null(), |v| v.as_ptr());

        // 5. Set up STARTUPINFO.
        let mut si: STARTUPINFOW = std::mem::zeroed();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        // Specify the WinSta0\Default desktop so the process gets the
        // interactive desktop.
        let mut desktop = to_wide_mut("WinSta0\\Default");
        si.lpDesktop = desktop.as_mut_ptr();

        let mut pi: PROCESS_INFORMATION = std::mem::zeroed();

        let creation_flags = CREATE_NEW_CONSOLE
            | CREATE_UNICODE_ENVIRONMENT
            | NORMAL_PRIORITY_CLASS;

        // 6. Launch!
        tracing::info!("CreateProcessAsUser: {}", cmd_line);
        let ok = CreateProcessAsUserW(
            user_token,
            ptr::null(),             // lpApplicationName — embedded in cmd line
            cmd_wide.as_mut_ptr(),   // lpCommandLine (mutable)
            ptr::null_mut(),         // lpProcessAttributes
            ptr::null_mut(),         // lpThreadAttributes
            FALSE as i32,            // bInheritHandles
            creation_flags,          // dwCreationFlags
            env_block,               // lpEnvironment
            wd_ptr,                  // lpCurrentDirectory
            &mut si,                 // lpStartupInfo
            &mut pi,                 // lpProcessInformation
        );

        if ok == FALSE {
            let err = GetLastError();
            return Err(format!("CreateProcessAsUser failed: Win32 error {}", err));
        }

        tracing::info!(
            "Successfully launched process in session {} (PID {})",
            session_id, pi.dwProcessId
        );

        // Close the process and thread handles (we don't need them).
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);

        Ok(())
    }
}

/// RAII guard that calls `CloseHandle` on drop.
struct HandleGuard(HANDLE);
impl Drop for HandleGuard {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0); }
    }
}

/// RAII guard that calls `DestroyEnvironmentBlock` on drop.
struct EnvBlockGuard(LPVOID);
impl Drop for EnvBlockGuard {
    fn drop(&mut self) {
        unsafe { DestroyEnvironmentBlock(self.0); }
    }
}
