use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Parse a single line of sidecar stdout into a discovered port, if the line
/// matches the `READY <port>` handshake contract.
pub fn parse_ready_line(line: &str) -> Option<u16> {
    let rest = line.strip_prefix("READY ")?;
    let port = rest.trim().parse::<u16>().ok()?;
    Some(port)
}

/// Spawn the Node sidecar and wait until it prints `READY <port>` on stdout.
///
/// `runtime_path` is the executable that launches the sidecar script (typically
/// `npx` or `node`); `entry_path` is the script argument passed to that
/// executable. For the production path we invoke `npx tsx <entry_path>` so the
/// `tsx` loader is responsible for handling `.ts` (Node 24 has no native TS).
pub fn spawn_sidecar(runtime_path: &str, entry_path: &str) -> Result<(Child, u16), String> {
    let mut child = Command::new(runtime_path)
        .args(["tsx", entry_path])
        .env("JOBHUNTER_SIDECAR_PORT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let stdout = child.stdout.take().ok_or("sidecar stdout not captured")?;
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        if std::time::Instant::now() >= deadline {
            return Err("sidecar did not become ready within 15s".to_string());
        }
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                if let Some(port) = parse_ready_line(&line) {
                    return Ok((child, port));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("sidecar exited before becoming ready".to_string());
            }
        }
    }
}

/// Politely stop the sidecar: SIGTERM (triggers the sidecar's graceful-shutdown
/// handler), wait up to 5s, then SIGKILL as a hard fallback.
pub fn stop_sidecar(mut child: Child) -> Result<(), String> {
    // Try SIGTERM first (Unix only) so the sidecar can drain in-flight requests
    // and abort any active pipeline runs via its B10-fix I1 handler.
    #[cfg(unix)]
    {
        let pid = child.id();
        // Safety: libc::kill with SIGTERM is a well-defined signal send.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    }
    // On non-Unix, fall through to Child::kill (SIGKILL on Unix anyway).
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }

    // Wait up to 5s for graceful exit; SIGKILL if it lingers.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    child.wait().map_err(|e| format!("sidecar SIGKILL fallback failed: {e}"))?;
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("sidecar wait failed: {e}")),
        }
    }
}
