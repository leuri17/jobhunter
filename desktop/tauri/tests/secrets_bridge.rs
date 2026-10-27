//! Integration tests for the secrets bridge wire protocol.
//!
//! These run the real socket path (`serve` + `TcpStream`) against an
//! in-memory fake so CI never touches a real OS keychain (headless Linux
//! has no Secret Service, and a dev machine's keychain must not be mutated
//! by tests). The serde shapes and the line parser are unit-tested inside
//! `src/secrets.rs`.

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use jobhunter_desktop_lib::secrets::{serve, SecretBridgeError, SecretOps};

/// In-memory `SecretOps` that records every call so tests can assert
/// order and arguments, and can be configured to fail with a wire error.
#[derive(Default)]
struct FakeSecrets {
    error: Option<SecretBridgeError>,
    value: Mutex<Option<String>>,
    calls: Mutex<Vec<(&'static str, Option<String>)>>,
}

impl SecretOps for FakeSecrets {
    fn get(&self) -> Result<Option<String>, SecretBridgeError> {
        self.record("get", None);
        self.fail_if_configured()?;
        Ok(self.value.lock().unwrap().clone())
    }

    fn set(&self, value: String) -> Result<(), SecretBridgeError> {
        self.record("set", Some(value.clone()));
        self.fail_if_configured()?;
        *self.value.lock().unwrap() = Some(value);
        Ok(())
    }

    fn delete(&self) -> Result<(), SecretBridgeError> {
        self.record("delete", None);
        self.fail_if_configured()?;
        *self.value.lock().unwrap() = None;
        Ok(())
    }
}

impl FakeSecrets {
    fn record(&self, op: &'static str, arg: Option<String>) {
        self.calls.lock().unwrap().push((op, arg));
    }

    fn fail_if_configured(&self) -> Result<(), SecretBridgeError> {
        match &self.error {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
}

const TOKEN: &str = "test-token";

fn start_fake_bridge(ops: Arc<FakeSecrets>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    serve(listener, TOKEN.to_string(), ops);
    port
}

fn connect(port: u16) -> TcpStream {
    let stream = TcpStream::connect(("127.0.0.1", port)).expect("connect to bridge");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set read timeout");
    stream
}

/// Send one request line and return the response line (without `\n`), or
/// `None` when the bridge closes the connection without responding. Write
/// errors are ignored: the bridge may already have closed (RST) on the
/// no-response paths, which is the behavior under test.
fn request(stream: &mut TcpStream, line: &str) -> Option<String> {
    let _ = stream.write_all(line.as_bytes());
    let _ = stream.write_all(b"\n");
    let _ = stream.flush();
    let Ok(clone) = stream.try_clone() else {
        return None;
    };
    let mut reader = BufReader::new(clone);
    let mut response = String::new();
    match reader.read_line(&mut response) {
        Ok(0) => None,
        Ok(_) => Some(response.trim_end_matches('\n').to_string()),
        Err(e) if e.kind() == ErrorKind::ConnectionReset => None,
        Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
            panic!("bridge neither responded nor closed within the read timeout")
        }
        Err(e) => panic!("unexpected read error: {e}"),
    }
}

#[test]
fn get_hit_returns_value() {
    let ops = Arc::new(FakeSecrets {
        value: Mutex::new(Some("sk-test-123".to_string())),
        ..Default::default()
    });
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut stream = connect(port);
    let response = request(&mut stream, r#"{"auth":"test-token","op":"get"}"#);

    assert_eq!(response.as_deref(), Some(r#"{"ok":true,"value":"sk-test-123"}"#));
}

#[test]
fn get_miss_returns_null_value() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut stream = connect(port);
    let response = request(&mut stream, r#"{"auth":"test-token","op":"get"}"#);

    assert_eq!(response.as_deref(), Some(r#"{"ok":true,"value":null}"#));
}

#[test]
fn set_then_delete_roundtrip_records_calls_in_order() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut set_conn = connect(port);
    assert_eq!(
        request(
            &mut set_conn,
            r#"{"auth":"test-token","op":"set","value":"sk-xyz"}"#
        )
        .as_deref(),
        Some(r#"{"ok":true}"#)
    );

    let mut delete_conn = connect(port);
    assert_eq!(
        request(&mut delete_conn, r#"{"auth":"test-token","op":"delete"}"#).as_deref(),
        Some(r#"{"ok":true}"#)
    );

    let mut get_conn = connect(port);
    assert_eq!(
        request(&mut get_conn, r#"{"auth":"test-token","op":"get"}"#).as_deref(),
        Some(r#"{"ok":true,"value":null}"#)
    );

    assert_eq!(
        *ops.calls.lock().unwrap(),
        vec![
            ("set", Some("sk-xyz".to_string())),
            ("delete", None),
            ("get", None),
        ]
    );
}

#[test]
fn unavailable_error_serializes_as_tagged_envelope() {
    let ops = Arc::new(FakeSecrets {
        error: Some(SecretBridgeError::Unavailable {
            reason: "no Secret Service".to_string(),
        }),
        ..Default::default()
    });
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut stream = connect(port);
    let response = request(&mut stream, r#"{"auth":"test-token","op":"get"}"#);

    assert_eq!(
        response.as_deref(),
        Some(r#"{"ok":false,"error":{"kind":"unavailable","reason":"no Secret Service"}}"#)
    );
}

#[test]
fn wrong_or_missing_token_closes_without_response() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut wrong = connect(port);
    assert_eq!(request(&mut wrong, r#"{"auth":"wrong","op":"get"}"#), None);

    let mut missing = connect(port);
    assert_eq!(request(&mut missing, r#"{"op":"get"}"#), None);

    assert!(ops.calls.lock().unwrap().is_empty());
}

#[test]
fn malformed_line_closes_without_response() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    let mut garbage = connect(port);
    assert_eq!(request(&mut garbage, "this is not json"), None);

    let mut unknown_op = connect(port);
    assert_eq!(
        request(&mut unknown_op, r#"{"auth":"test-token","op":"frobnicate"}"#),
        None
    );

    assert!(ops.calls.lock().unwrap().is_empty());
}

#[test]
fn oversized_request_line_is_dropped() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    let oversized = format!(
        r#"{{"auth":"test-token","op":"set","value":"{}"}}"#,
        "a".repeat(70 * 1024)
    );
    let mut stream = connect(port);
    assert_eq!(request(&mut stream, &oversized), None);

    assert!(ops.calls.lock().unwrap().is_empty());
}

#[test]
fn request_line_cap_boundary_is_exact() {
    let ops = Arc::new(FakeSecrets::default());
    let port = start_fake_bridge(Arc::clone(&ops));

    // A line of exactly 64 KiB is served; one byte more is dropped.
    let at_cap = padded_set_request(64 * 1024);
    assert_eq!(at_cap.len(), 64 * 1024);
    let mut ok_conn = connect(port);
    assert_eq!(request(&mut ok_conn, &at_cap).as_deref(), Some(r#"{"ok":true}"#));

    let over_cap = padded_set_request(64 * 1024 + 1);
    let mut drop_conn = connect(port);
    assert_eq!(request(&mut drop_conn, &over_cap), None);
}

/// Build a valid `set` request whose total line length is exactly
/// `total_len` bytes (the padding uses `a`, which needs no JSON escaping).
fn padded_set_request(total_len: usize) -> String {
    let base = format!(r#"{{"auth":"test-token","op":"set","value":""}}"#);
    let padding = total_len - base.len();
    format!(r#"{{"auth":"test-token","op":"set","value":"{}"}}"#, "a".repeat(padding))
}
