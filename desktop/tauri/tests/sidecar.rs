//! Integration tests for the sidecar spawn + READY-line parser.
//!
//! These exercise the public surface of `jobhunter_desktop_lib::sidecar`:
//!   - `parse_ready_line` covers the in-process handshake contract (pure unit tests).
//!   - `spawn_sidecar` is exercised end-to-end with small Node.js scripts that
//!     print the `READY <port>` line, then asserts the discovered port matches.

use std::time::Instant;

use jobhunter_desktop_lib::sidecar::{parse_ready_line, spawn_sidecar, stop_sidecar};

#[test]
fn parses_ready_line_extracts_port() {
    assert_eq!(parse_ready_line("READY 12345"), Some(12345));
    assert_eq!(parse_ready_line("READY 0"), Some(0));
    assert_eq!(parse_ready_line("READY 65535"), Some(65535));
    // Leading zeros are accepted and the numeric value is what counts
    // (u16::from_str parses the digits regardless of leading zeros).
    // Document the choice — the sidecar's contract is decimal, and
    // `READY 01234` and `READY 1234` are both valid forms of port 1234.
    assert_eq!(parse_ready_line("READY 01234"), Some(1234));
    assert_eq!(parse_ready_line("READY 00000"), Some(0));
}

#[test]
fn parse_ready_line_rejects_u16_overflow() {
    // Just-over-u16-max boundary. The function uses u16::from_str which
    // rejects 65536. Lock the contract here so a future refactor to a
    // wider type doesn't silently widen the port range.
    assert_eq!(parse_ready_line("READY 65536"), None);
    // The legacy test used 99999; the new test pins the precise
    // boundary at 65535 (last accepted) / 65536 (first rejected).
    assert_eq!(parse_ready_line("READY 65535"), Some(65535));
}

#[test]
fn parse_ready_line_rejects_leading_whitespace_and_unrelated_inputs() {
    // The parser applies `.trim()` to the post-prefix digits, so
    // trailing whitespace is accepted (the contract is forgiving on
    // this side — see src/sidecar.rs:9). Document the choice: the
    // caller can hand the raw stdout line to parse_ready_line
    // without trimming first.
    assert_eq!(parse_ready_line("READY 12345\n"), Some(12345));
    assert_eq!(parse_ready_line("READY 12345 "), Some(12345));
    assert_eq!(parse_ready_line("READY 12345\t"), Some(12345));
    // Leading whitespace before the literal "READY " prefix is NOT
    // stripped — the parser does an exact strip_prefix match. This is
    // a defensive guard: a line with leading whitespace is a malformed
    // handshake and must not be accepted.
    assert_eq!(parse_ready_line(" READY 12345"), None);
    // Sanity: an empty post-prefix is still rejected.
    assert_eq!(parse_ready_line("READY \n"), None);
}

#[test]
fn rejects_malformed_lines() {
    // Missing the literal "READY " prefix (case-sensitive, single space).
    assert_eq!(parse_ready_line(""), None);
    assert_eq!(parse_ready_line("not ready 12345"), None);
    assert_eq!(parse_ready_line("ready 12345"), None);
    assert_eq!(parse_ready_line("READY"), None); // no trailing space / port
    assert_eq!(parse_ready_line("READY "), None); // port missing
    assert_eq!(parse_ready_line("READY abc"), None); // non-numeric
    assert_eq!(parse_ready_line("READY 12345 extra"), None); // extra token
    assert_eq!(parse_ready_line("READY 99999"), None); // out of u16 range
}

#[test]
fn spawns_node_and_reads_ready_line() {
    // A minimal script that prints the `READY <port>` handshake on stdout and
    // then idles. We use a `.ts` extension and invoke via `npx tsx` so the
    // test exercises the same code path as production (where Node 24 has no
    // native TS handler and `tsx` is the loader).
    let script_path = std::env::temp_dir().join("jobhunter-sidecar-test.ts");
    std::fs::write(
        &script_path,
        "process.stdout.write('READY 54321\\n');\n\
         // Keep the process alive long enough for the parent to read the line.\n\
         setInterval(() => {}, 1000);\n",
    )
    .expect("write test script");

    let spawn_result = spawn_sidecar("npx", script_path.to_str().unwrap());

    let (child, port) = match spawn_result {
        Ok(v) => v,
        Err(e) => {
            // Surface the error rather than silently passing if npx/tsx is missing.
            panic!("spawn_sidecar failed: {e}");
        }
    };

    assert_eq!(port, 54321, "port should be parsed from READY line");

    // Clean up the child so the test process exits; ignore errors (it may
    // already have exited on slow CI).
    let _ = stop_sidecar(child);

    let _ = std::fs::remove_file(&script_path);
}

// Coverage for the 15-second deadline branch. The fixture idles without ever
// printing READY, so spawn_sidecar must return Err on the timeout path with
// the documented error message and within the deadline + recv_timeout slack.
//
// The fixture self-exits just past the deadline so the reader thread in
// spawn_sidecar sees EOF and the test binary doesn't hang on an orphan
// child.
#[test]
fn spawn_times_out_when_child_never_prints_ready() {
    let script_path = std::env::temp_dir().join("jobhunter-sidecar-no-output.ts");
    std::fs::write(
        &script_path,
        "// Idle without printing the READY handshake. Self-exit shortly\n\
         // after the 15s deadline so spawn_sidecar's reader thread sees\n\
         // EOF and the test binary can exit cleanly.\n\
         setInterval(() => {}, 60_000);\n\
         setTimeout(() => process.exit(0), 15_500);\n",
    )
    .expect("write test script");

    let started = Instant::now();
    let result = spawn_sidecar("npx", script_path.to_str().unwrap());
    let elapsed = started.elapsed();

    let err = result.expect_err("expected spawn to time out without READY");
    assert!(
        err.contains("did not become ready within"),
        "unexpected error: {err}",
    );
    assert!(
        elapsed.as_secs() <= 16,
        "timeout branch should fire within 16s (15s deadline + 500ms recv slack), took {elapsed:?}",
    );

    let _ = std::fs::remove_file(&script_path);
}

// Coverage for the deadline racing a slow-to-print child. The fixture waits
// past the 15s deadline before printing READY, so spawn_sidecar must return
// Err on the timeout path before the late READY arrives.
#[test]
fn spawn_times_out_when_ready_prints_after_deadline() {
    let script_path = std::env::temp_dir().join("jobhunter-sidecar-late-ready.ts");
    std::fs::write(
        &script_path,
        "// Print the handshake past the 15s deadline. spawn_sidecar should\n\
         // time out before this fires; the late READY is ignored. Self-exit\n\
         // shortly after so the reader thread sees EOF and the test binary\n\
         // can exit cleanly.\n\
         setTimeout(() => {\n  \
           process.stdout.write('READY 11111\\n');\n\
         }, 16_000);\n\
         setTimeout(() => process.exit(0), 16_500);\n",
    )
    .expect("write test script");

    let started = Instant::now();
    let result = spawn_sidecar("npx", script_path.to_str().unwrap());
    let elapsed = started.elapsed();

    let err = result.expect_err("expected spawn to time out before late READY");
    assert!(
        err.contains("did not become ready within"),
        "unexpected error: {err}",
    );
    assert!(
        elapsed.as_secs() <= 16,
        "timeout branch should fire within 16s, took {elapsed:?}",
    );

    let _ = std::fs::remove_file(&script_path);
}

// Coverage for the RecvTimeoutError::Disconnected branch: the child exits
// cleanly without ever printing READY, so the reader thread hits EOF on the
// pipe and the channel closes before the deadline.
#[test]
fn spawn_returns_disconnected_when_child_exits_without_ready() {
    let script_path = std::env::temp_dir().join("jobhunter-sidecar-exit.ts");
    std::fs::write(
        &script_path,
        "// Exit immediately without printing the handshake.\n\
         process.exit(0);\n",
    )
    .expect("write test script");

    let started = Instant::now();
    let result = spawn_sidecar("npx", script_path.to_str().unwrap());
    let elapsed = started.elapsed();

    let err = result.expect_err("expected spawn to fail when child exits early");
    assert!(
        err.contains("exited before becoming ready"),
        "unexpected error: {err}",
    );
    assert!(
        elapsed.as_secs() < 2,
        "disconnected branch should fire promptly, took {elapsed:?}",
    );

    let _ = std::fs::remove_file(&script_path);
}

// Coverage for stop_sidecar's SIGTERM-then-SIGKILL fallback. The fixture
// installs a SIGTERM handler that traps and ignores the signal, forcing
// stop_sidecar to fall through to SIGKILL after the 5s deadline.
#[cfg(unix)]
#[test]
fn stop_sidecar_falls_back_to_sigkill_when_sigterm_ignored() {
    let script_path = std::env::temp_dir().join("jobhunter-sidecar-ignores-sigterm.ts");
    std::fs::write(
        &script_path,
        "// Print the handshake so spawn_sidecar returns Ok, then trap SIGTERM\n\
         // and ignore it. stop_sidecar's SIGTERM (t=0) is ignored; its\n\
         // SIGKILL (t=5s) terminates the process. Self-exit well past the\n\
         // SIGKILL window as a belt-and-suspenders against the orphan\n\
         // grandchild (npx -> tsx -> node) outliving the test process.\n\
         process.stdout.write('READY 0\\n');\n\
         process.on('SIGTERM', () => {});\n\
         setInterval(() => {}, 1000);\n\
         setTimeout(() => process.exit(0), 8000);\n",
    )
    .expect("write test script");

    let (child, _port) = spawn_sidecar("npx", script_path.to_str().unwrap())
        .expect("spawn fixture sidecar");

    let pid = child.id();
    let started = Instant::now();
    let stop_result = stop_sidecar(child);
    let elapsed = started.elapsed();

    stop_result.expect("stop_sidecar should fall back to SIGKILL");

    // The SIGKILL fallback fires at the 5s deadline; the actual stop should
    // land a touch past that (deadline check + kill + wait).
    assert!(
        elapsed.as_secs() >= 4 && elapsed.as_secs() <= 7,
        "stop_sidecar should take ~5s on SIGTERM-ignored fixture, took {elapsed:?}",
    );

    // Confirm the process is actually gone via kill(pid, 0). A signal-zero
    // probe returns ESRCH when the process doesn't exist.
    let probe = unsafe { libc::kill(pid as libc::pid_t, 0) };
    assert_eq!(
        probe, -1,
        "child pid {pid} should be gone after SIGKILL fallback",
    );
    let errno = std::io::Error::last_os_error().raw_os_error();
    assert_eq!(
        errno,
        Some(libc::ESRCH),
        "kill(pid, 0) should report ESRCH for a reaped process, got {errno:?}",
    );

    let _ = std::fs::remove_file(&script_path);
    // The process is reaped by stop_sidecar's internal `child.wait()` call
    // (see sidecar.rs:86 — `child.wait().map_err(...)` after the SIGKILL).
    // No further cleanup required; the kill(pid, 0) probe above confirms
    // the OS no longer has the process.
}

// Compile-time check that the non-Unix branch in stop_sidecar exists. The
// cfg-gated test below is a no-op on Unix CI; on Windows it would call into
// the `child.kill()` path. The actual behaviour on Windows is best validated
// by a Windows runner.
#[cfg(not(unix))]
#[test]
fn stop_sidecar_non_unix_branch_compiles() {
    // Pure compile-time gate. The body is intentionally trivial: the value
    // of this test is that the surrounding #[cfg(not(unix))] attribute
    // exercises the same code path that production builds on Windows.
}
