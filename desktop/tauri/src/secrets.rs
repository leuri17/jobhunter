//! OS-keychain access for the OpenAI API key, served to the Node sidecar
//! over a token-authenticated loopback TCP bridge.
//!
//! The sidecar is a plain child process and cannot reach the OS keychain,
//! so the Tauri shell owns all keychain I/O and exposes it as a lockstep
//! request/response line protocol. The webview never talks to this bridge:
//! no Tauri command wraps it, and the port/token pair reaches the sidecar
//! through [`PORT_ENV_VAR`] / [`TOKEN_ENV_VAR`].
//!
//! Wire contract (UTF-8 JSON, one `\n`-terminated line each way, at most one
//! request/response pair per connection, request lines capped at 64 KiB):
//!
//! ```text
//! request:  {"auth":"<token>","op":"get"}
//!           {"auth":"<token>","op":"set","value":"<key>"}
//!           {"auth":"<token>","op":"delete"}
//! response: {"ok":true,"value":"<key>"}   get hit
//!           {"ok":true,"value":null}      get miss (NoEntry)
//!           {"ok":true}                   set / delete
//!           {"ok":false,"error":{"kind":"unavailable","reason":"…"}}
//!           {"ok":false,"error":{"kind":"failed","message":"…"}}
//! ```
//!
//! A wrong or missing token, malformed JSON, an unknown op, a non-UTF-8 or
//! unterminated line, or an oversized request closes the connection with no
//! response. The TypeScript client in a later lane consumes this contract
//! verbatim.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::thread;

use serde::{Deserialize, Serialize};

/// Keychain service name; matches the `identifier` in `tauri.conf.json`.
pub const SERVICE: &str = "com.leuri17.jobhunter";
/// Keychain account holding the OpenAI API key.
pub const ACCOUNT: &str = "openai-api-key";
/// Env var carrying the bridge port to the sidecar.
pub const PORT_ENV_VAR: &str = "JOBHUNTER_SECRETS_BRIDGE_PORT";
/// Env var carrying the per-launch auth token to the sidecar.
pub const TOKEN_ENV_VAR: &str = "JOBHUNTER_SECRETS_BRIDGE_TOKEN";

/// Maximum accepted request line length in bytes, excluding the `\n`.
const MAX_REQUEST_LINE: usize = 64 * 1024;

/// Error envelope for the bridge wire protocol.
///
/// `Unavailable` marks a missing, locked, or inaccessible keychain backend
/// (for example no Secret Service on headless Linux) so the client can
/// distinguish environment problems from other failures; `Failed` covers
/// everything else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SecretBridgeError {
    Unavailable { reason: String },
    Failed { message: String },
}

/// The keychain operations the bridge serves, abstracted so tests can run
/// the full wire path against an in-memory fake instead of the OS keychain.
pub trait SecretOps: Send + Sync + 'static {
    fn get(&self) -> Result<Option<String>, SecretBridgeError>;
    fn set(&self, value: String) -> Result<(), SecretBridgeError>;
    fn delete(&self) -> Result<(), SecretBridgeError>;
}

/// [`SecretOps`] backed by the OS keychain entry `(SERVICE, ACCOUNT)`.
///
/// `NoEntry` maps to a get miss and an idempotent delete; backend access
/// failures (`NoStorageAccess`, `PlatformFailure`) map to
/// [`SecretBridgeError::Unavailable`]; every other keyring error maps to
/// [`SecretBridgeError::Failed`].
pub struct KeyringOps;

impl KeyringOps {
    fn entry() -> Result<keyring::Entry, SecretBridgeError> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(map_keyring_error)
    }
}

impl SecretOps for KeyringOps {
    fn get(&self) -> Result<Option<String>, SecretBridgeError> {
        match Self::entry()?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(map_keyring_error(err)),
        }
    }

    fn set(&self, value: String) -> Result<(), SecretBridgeError> {
        Self::entry()?.set_password(&value).map_err(map_keyring_error)
    }

    fn delete(&self) -> Result<(), SecretBridgeError> {
        match Self::entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(map_keyring_error(err)),
        }
    }
}

fn map_keyring_error(err: keyring::Error) -> SecretBridgeError {
    match &err {
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
            SecretBridgeError::Unavailable {
                reason: err.to_string(),
            }
        }
        _ => SecretBridgeError::Failed {
            message: err.to_string(),
        },
    }
}

/// Connection details for a launched bridge; the fields are what the sidecar
/// receives through [`PORT_ENV_VAR`] / [`TOKEN_ENV_VAR`].
#[derive(Debug, Clone)]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
}

/// Bind the secrets bridge on an OS-assigned loopback port and serve
/// keychain operations from [`KeyringOps`] on detached threads.
///
/// A bind failure means the sidecar cannot be given keychain access, so
/// callers treat it as fatal at startup. The accept and connection threads
/// are detached and end with process exit, matching the app lifecycle.
pub fn start_bridge() -> std::io::Result<BridgeInfo> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let token = generate_token();
    serve(listener, token.clone(), Arc::new(KeyringOps));
    Ok(BridgeInfo { port, token })
}

/// Accept connections on `listener` forever, answering each on its own
/// thread. Exposed with an injectable `ops` so integration tests can run the
/// real socket path against a fake instead of the OS keychain.
pub fn serve(listener: TcpListener, token: String, ops: Arc<dyn SecretOps>) {
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            let token = token.clone();
            let ops = Arc::clone(&ops);
            thread::spawn(move || handle_connection(stream, &token, &*ops));
        }
    });
}

fn handle_connection(stream: TcpStream, token: &str, ops: &dyn SecretOps) {
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    let Ok(Some(line)) = read_line_capped(&mut reader, MAX_REQUEST_LINE) else {
        return;
    };
    let Some(request) = parse_request_line(&line) else { return };
    if !request.authorized(token) {
        return;
    }
    let Some(operation) = request.operation() else { return };
    let out = build_response_line(&execute(operation, ops));
    let _ = writer.write_all(out.as_bytes());
    let _ = writer.flush();
}

/// Read one `\n`-terminated line, returning `None` on EOF before the
/// terminator, on a line longer than `cap` bytes, or on non-UTF-8 input.
/// Every one of those means "drop the connection".
fn read_line_capped(
    reader: &mut BufReader<TcpStream>,
    cap: usize,
) -> std::io::Result<Option<String>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(None);
        }
        match available.iter().position(|&b| b == b'\n') {
            Some(idx) => {
                line.extend_from_slice(&available[..idx]);
                reader.consume(idx + 1);
                if line.len() > cap {
                    return Ok(None);
                }
                return Ok(String::from_utf8(line).ok());
            }
            None => {
                let len = available.len();
                line.extend_from_slice(available);
                reader.consume(len);
                if line.len() > cap {
                    return Ok(None);
                }
            }
        }
    }
}

#[derive(Debug, PartialEq, Deserialize)]
struct WireRequest {
    auth: String,
    op: WireOp,
    #[serde(default)]
    value: Option<String>,
}

#[derive(Debug, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireOp {
    Get,
    Set,
    Delete,
}

impl WireRequest {
    fn authorized(&self, token: &str) -> bool {
        self.auth == token
    }

    /// `set` without a `value` string is malformed and yields `None`.
    fn operation(&self) -> Option<Operation> {
        match self.op {
            WireOp::Get => Some(Operation::Get),
            WireOp::Delete => Some(Operation::Delete),
            WireOp::Set => self.value.clone().map(Operation::Set),
        }
    }
}

#[derive(Debug, PartialEq)]
enum Operation {
    Get,
    Set(String),
    Delete,
}

/// Parse one request line; `None` covers malformed JSON and unknown ops.
fn parse_request_line(line: &str) -> Option<WireRequest> {
    serde_json::from_str(line).ok()
}

#[derive(Serialize)]
#[serde(untagged)]
enum WireResponse {
    Value { ok: bool, value: Option<String> },
    Ack { ok: bool },
    Error { ok: bool, error: SecretBridgeError },
}

fn execute(operation: Operation, ops: &dyn SecretOps) -> WireResponse {
    match operation {
        Operation::Get => match ops.get() {
            Ok(value) => WireResponse::Value { ok: true, value },
            Err(error) => WireResponse::Error { ok: false, error },
        },
        Operation::Set(value) => match ops.set(value) {
            Ok(()) => WireResponse::Ack { ok: true },
            Err(error) => WireResponse::Error { ok: false, error },
        },
        Operation::Delete => match ops.delete() {
            Ok(()) => WireResponse::Ack { ok: true },
            Err(error) => WireResponse::Error { ok: false, error },
        },
    }
}

/// Serialize a response onto its wire line, including the trailing `\n`.
fn build_response_line(response: &WireResponse) -> String {
    let mut line = serde_json::to_string(response).expect("wire responses always serialize");
    line.push('\n');
    line
}

/// Generate the per-launch 128-bit hex auth token.
///
/// Two fresh `RandomState` instances draw independent OS-entropy seeds, and
/// their hashers' `finish()` values yield two 64-bit words — a
/// dependency-free source of per-process unpredictable randomness from std
/// alone. The token only has to resist guessing by other local processes for
/// the lifetime of one app launch; the loopback-only bind is the primary
/// boundary.
fn generate_token() -> String {
    let first = RandomState::new().build_hasher().finish();
    let second = RandomState::new().build_hasher().finish();
    format!("{first:016x}{second:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_envelope_serializes_with_kind_tag() {
        let unavailable = SecretBridgeError::Unavailable {
            reason: "no Secret Service".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&unavailable).unwrap(),
            r#"{"kind":"unavailable","reason":"no Secret Service"}"#
        );
        let failed = SecretBridgeError::Failed {
            message: "boom".to_string(),
        };
        assert_eq!(
            serde_json::to_string(&failed).unwrap(),
            r#"{"kind":"failed","message":"boom"}"#
        );
    }

    #[test]
    fn error_envelope_round_trips() {
        let error: SecretBridgeError =
            serde_json::from_str(r#"{"kind":"unavailable","reason":"locked"}"#).unwrap();
        assert_eq!(
            error,
            SecretBridgeError::Unavailable {
                reason: "locked".to_string()
            }
        );
    }

    #[test]
    fn parse_request_line_accepts_documented_shapes() {
        let get = parse_request_line(r#"{"auth":"t","op":"get"}"#).unwrap();
        assert_eq!(
            get,
            WireRequest {
                auth: "t".to_string(),
                op: WireOp::Get,
                value: None
            }
        );
        assert_eq!(get.operation(), Some(Operation::Get));

        let set =
            parse_request_line(r#"{"auth":"t","op":"set","value":"sk-1"}"#).unwrap();
        assert_eq!(set.operation(), Some(Operation::Set("sk-1".to_string())));

        let delete = parse_request_line(r#"{"auth":"t","op":"delete"}"#).unwrap();
        assert_eq!(delete.operation(), Some(Operation::Delete));
    }

    #[test]
    fn parse_request_line_rejects_malformed_input() {
        assert_eq!(parse_request_line("not json"), None);
        assert_eq!(parse_request_line(r#"{"op":"get"}"#), None);
        assert_eq!(parse_request_line(r#"{"auth":"t","op":"frobnicate"}"#), None);
        assert_eq!(parse_request_line(r#"[]"#), None);
        assert_eq!(parse_request_line(""), None);
    }

    #[test]
    fn set_without_value_is_malformed() {
        let set = parse_request_line(r#"{"auth":"t","op":"set"}"#).unwrap();
        assert_eq!(set.operation(), None);
    }

    #[test]
    fn authorized_compares_against_token() {
        let request = parse_request_line(r#"{"auth":"t","op":"get"}"#).unwrap();
        assert!(request.authorized("t"));
        assert!(!request.authorized("wrong"));
    }

    #[test]
    fn response_lines_match_wire_contract() {
        assert_eq!(
            build_response_line(&WireResponse::Value {
                ok: true,
                value: Some("sk-1".to_string())
            }),
            "{\"ok\":true,\"value\":\"sk-1\"}\n"
        );
        assert_eq!(
            build_response_line(&WireResponse::Value {
                ok: true,
                value: None
            }),
            "{\"ok\":true,\"value\":null}\n"
        );
        assert_eq!(
            build_response_line(&WireResponse::Ack { ok: true }),
            "{\"ok\":true}\n"
        );
        assert_eq!(
            build_response_line(&WireResponse::Error {
                ok: false,
                error: SecretBridgeError::Failed {
                    message: "boom".to_string()
                }
            }),
            "{\"ok\":false,\"error\":{\"kind\":\"failed\",\"message\":\"boom\"}}\n"
        );
    }

    #[test]
    fn token_is_32_lowercase_hex_chars_and_varies_per_launch() {
        for token in [generate_token(), generate_token()] {
            assert_eq!(token.len(), 32);
            assert!(
                token.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
                "token must be lowercase hex: {token}"
            );
        }
    }
}
