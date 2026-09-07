//! Tests for the single-instance plugin's window-forwarding behaviour.
//!
//! The plugin's closure lives inline at `src/lib.rs:82-97` (production code)
//! and delegates to `bring_main_window_forward` so it can be exercised in
//! isolation. These tests cover the two relevant shapes:
//!
//!   - the no-window path (the closure must not panic when no "main"
//!     webview window exists), and
//!   - the with-window path (the closure calls unminimize, show, and
//!     set_focus on the existing "main" window — verified by a custom
//!     Runtime that counts invocations through the WindowDispatch
//!     hook in `src/lib.rs`'s `bring_main_window_forward_tests` module).

use jobhunter_desktop_lib::bring_main_window_forward;

#[test]
fn bring_main_window_forward_does_not_panic_when_no_main_window() {
    // `mock_app()` constructs a tauri::App<MockRuntime> with no windows.
    // bring_main_window_forward must short-circuit cleanly when there is
    // no "main" window to operate on.
    let app = tauri::test::mock_app();
    bring_main_window_forward(&app.handle());
}

#[test]
fn bring_main_window_forward_calls_three_operations_on_main_window() {
    // The counting runtime installed by `bring_main_window_forward_tests`
    // records every WebviewWindow::unminimize / show / set_focus call into
    // a shared log. This test exercises the helper against a built
    // `CountingRuntime` app with a "main" window and asserts the recorded
    // sequence matches the documented order.
    jobhunter_desktop_lib::bring_main_window_forward_tests::run_bring_main_window_forward_against_counting_runtime();
}