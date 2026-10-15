use std::io::{BufRead, BufReader};
use std::path::Path;
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
                    child
                        .wait()
                        .map_err(|e| format!("sidecar SIGKILL fallback failed: {e}"))?;
                    return Ok(());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("sidecar wait failed: {e}")),
        }
    }
}

/// Wait for the external sidecar to write its bound port to `path`,
/// parse the first line as a `u16`, and return it. Used when
/// `JOBHUNTER_SIDECAR_EXTERNAL=1` is set; see
/// `docs/superpowers/specs/2026-10-15-hmr-split-dev-design.md` §3.2.
///
/// Polls every 100ms until `deadline` elapses. A `NotFound` error or a
/// transient parse failure is treated as "keep polling"; on deadline the
/// returned `Err` names the env var and the fix-it command so a dev who
/// hits this can recover without consulting the docs.
pub fn discover_external_sidecar_port_with_deadline(
    path: &Path,
    deadline: Duration,
) -> Result<u16, String> {
    use std::time::Instant;

    let start = Instant::now();
    let poll = Duration::from_millis(100);
    loop {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                if let Some(line) = contents.lines().next() {
                    if let Ok(port) = line.trim().parse::<u16>() {
                        return Ok(port);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("failed reading {}: {e}", path.display())),
        }
        if start.elapsed() >= deadline {
            return Err(format!(
                "timed out waiting for external sidecar port file {}: ensure `JOBHUNTER_SIDECAR_EXTERNAL=1` is set and the sidecar is running (`pnpm --filter @jobhunter/sidecar dev` in another terminal)",
                path.display(),
            ));
        }
        std::thread::sleep(poll);
    }
}

/// Production wrapper: reads `desktop/sidecar/.sidecar-port` with a 5s deadline.
pub fn discover_external_sidecar_port(path: &Path) -> Result<u16, String> {
    discover_external_sidecar_port_with_deadline(path, Duration::from_secs(5))
}

#[cfg(test)]
mod discover_external_sidecar_port_tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_port_path(tag: &str) -> std::path::PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "jobhunter-sidecar-discover-{}-{}-{}",
            std::process::id(),
            n,
            tag
        ));
        let _ = fs::create_dir_all(&dir);
        dir.join(".sidecar-port")
    }

    #[test]
    fn happy_path_reads_port_on_first_attempt() {
        let path = temp_port_path("happy");
        fs::write(&path, "14231\n").unwrap();
        let result = discover_external_sidecar_port_with_deadline(&path, Duration::from_secs(1));
        let _ = fs::remove_file(&path);
        assert_eq!(result.unwrap(), 14231);
    }

    #[test]
    fn late_write_is_picked_up_before_deadline() {
        let path = temp_port_path("late");
        let path_clone = path.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            fs::write(&path_clone, "14231\n").unwrap();
        });
        let result = discover_external_sidecar_port_with_deadline(&path, Duration::from_secs(2));
        let _ = fs::remove_file(&path);
        assert_eq!(result.unwrap(), 14231);
    }

    #[test]
    fn missing_file_times_out_with_actionable_error() {
        let dir = std::env::temp_dir().join(format!(
            "jobhunter-sidecar-discover-missing-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("nope-not-here");
        let result =
            discover_external_sidecar_port_with_deadline(&path, Duration::from_millis(500));
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("JOBHUNTER_SIDECAR_EXTERNAL"),
            "error should mention the env var: {msg}"
        );
        assert!(
            msg.contains("pnpm --filter @jobhunter/sidecar dev"),
            "error should mention how to fix it: {msg}"
        );
    }

    #[test]
    fn garbage_contents_are_treated_as_transient() {
        let path = temp_port_path("garbage");
        fs::write(&path, "not-a-port\n").unwrap();
        let result =
            discover_external_sidecar_port_with_deadline(&path, Duration::from_millis(500));
        let _ = fs::remove_file(&path);
        assert!(result.is_err(), "should time out, not panic on parse");
    }
}
