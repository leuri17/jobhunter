//! Integration tests for the sidecar spawn + READY-line parser.
//!
//! These exercise the public surface of `jobhunter_desktop_lib::sidecar`:
//!   - `parse_ready_line` covers the in-process handshake contract (pure unit tests).
//!   - `spawn_sidecar` is exercised end-to-end with a small Node.js script that
//!     prints the `READY <port>` line, then asserts the discovered port matches.

use jobhunter_desktop_lib::sidecar::{parse_ready_line, spawn_sidecar, stop_sidecar};

#[test]
fn parses_ready_line_extracts_port() {
    assert_eq!(parse_ready_line("READY 12345"), Some(12345));
    assert_eq!(parse_ready_line("READY 0"), Some(0));
    assert_eq!(parse_ready_line("READY 65535"), Some(65535));
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
