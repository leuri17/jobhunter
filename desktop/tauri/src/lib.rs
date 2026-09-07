pub mod notification;
pub mod sidecar;

use std::sync::Mutex;

use sidecar::{spawn_sidecar, stop_sidecar};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// Bring the existing `main` window forward. Extracted from the
/// single-instance plugin callback so the call site stays readable and
/// the body is unit-testable with a mocked `AppHandle`.
pub fn bring_main_window_forward<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Port the sidecar bound to; populated by `run()` and queried via Tauri IPC.
#[derive(Default, Clone, Copy)]
pub struct SidecarPort(pub u16);

/// Tauri command: returns the discovered sidecar port.
/// Phase D will call `await invoke<number>('sidecar_port')`.
#[tauri::command]
fn sidecar_port(state: tauri::State<SidecarPort>) -> u16 {
    state.0
}

/// Show an OS-level notification when the discovery pipeline finishes.
///
/// Invoked by the frontend (via `invoke('notify_pipeline_complete', …)`) when
/// the SSE `done` event arrives from `desktop/sidecar/src/routes/pipeline.ts`.
/// `status` is the run's terminal status (`done` | `failed` | `cancelled`);
/// `count` is the number of jobs discovered (only meaningful for `done`).
///
/// The (title, body) computation lives in `notification::notification_payload_for`
/// so the 4-branch status mapping + the singular/plural inflection can be
/// unit-tested independently of the Tauri AppHandle (audit B4-B-L4.7 / H19).
#[tauri::command]
fn notify_pipeline_complete(
    app: tauri::AppHandle,
    status: String,
    count: u32,
) -> Result<(), String> {
    let (title, body) = notification::notification_payload_for(&status, count);

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification failed: {e}"))
}

pub fn run() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let runtime_path = "npx";
    let entry_path = format!("{}/../sidecar/src/server.ts", manifest_dir);

    let (child, port) = spawn_sidecar(runtime_path, &entry_path)
        .expect("failed to start sidecar");

    // Keep the port for the webview (Tauri IPC; chromium doesn't inherit
    // parent-process env vars). The `JOBHUNTER_SIDECAR_PORT` env var is left
    // in place for tooling/debugging but the webview uses `sidecar_port()`.
    std::env::set_var("JOBHUNTER_SIDECAR_PORT", port.to_string());

    // Wrap the Child in `Mutex<Option<_>>` so the `FnMut` event callback (which
    // may fire multiple times) can move it out on the `ExitRequested` event
    // without violating closure capture rules.
    let child = Mutex::new(Some(child));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second invocation of the binary is intercepted by the
            // single-instance plugin and routed here. Bring the existing
            // window forward so the user lands on their existing session
            // rather than spawning a duplicate process that would fail to
            // bind the sidecar port.
            //
            // The body lives in `bring_main_window_forward` so it can be
            // unit-tested with a mocked AppHandle.
            bring_main_window_forward(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarPort(port))
        .invoke_handler(tauri::generate_handler![sidecar_port, notify_pipeline_complete])
        .setup(|_app| Ok(()))
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Ok(mut guard) = child.lock() {
                if let Some(c) = guard.take() {
                    let _ = stop_sidecar(c);
                }
            }
        }
    });
}

#[cfg(feature = "test-utils")]
#[doc(hidden)]
pub mod bring_main_window_forward_tests {
    //! Test infrastructure for asserting that [`bring_main_window_forward`]
    //! dispatches the three window operations (`unminimize`, `show`, `set_focus`)
    //! on the existing `main` webview window in the documented order.
    //!
    //! `tauri::test::mock_app()` cannot observe those calls because
    //! `MockRuntime` short-circuits them to no-ops, and `WebviewWindow`
    //! is wired to platform-specific behaviour. This module wraps the
    //! mock runtime with a thin decorator that records each intercepted
    //! call into a shared log so the test can assert method order.

    use std::sync::{Arc, Mutex, OnceLock};
    use tauri::test::{
        MockRuntime, MockRuntimeHandle, MockWebviewDispatcher, MockWindowBuilder, MockWindowDispatcher,
    };
    use tauri_runtime::window::{DetachedWindow, DetachedWindowWebview, RawWindow};
    use tauri_runtime::{
        webview::DetachedWebview, DeviceEventFilter, EventLoopProxy, Result, RunEvent,
        Runtime, RuntimeHandle, RuntimeInitArgs, UserEvent, WebviewDispatch, WindowDispatch,
    };
    use url::Url;

    /// Active log for the current process. `CountingRuntime::new` reads from
    /// this; the test installs a fresh one before calling `Builder::build`.
    /// The `CountingRuntime` constructor is invoked by `Builder::build`, so
    /// the test installs the log before the builder runs and reads it after.
    fn active_log() -> &'static Arc<MethodCallLog> {
        static LOG: OnceLock<Arc<MethodCallLog>> = OnceLock::new();
        LOG.get_or_init(|| Arc::new(MethodCallLog::default()))
    }

    /// Append-only log of intercepted `WebviewWindow` method names, recorded
    /// in invocation order. Shared between the runtime and the runtime handle
    /// so windows created via either path contribute to the same log.
    #[derive(Default)]
    struct MethodCallLog {
        calls: Mutex<Vec<&'static str>>,
    }

    impl MethodCallLog {
        fn push(&self, method: &'static str) {
            self.calls.lock().unwrap().push(method);
        }

        fn snapshot(&self) -> Vec<&'static str> {
            self.calls.lock().unwrap().clone()
        }
    }

    /// Window dispatcher that wraps a [`MockWindowDispatcher`] and records the
    /// three forward calls that [`bring_main_window_forward`] issues. All
    /// other `WindowDispatch` methods pass through to the wrapped dispatcher.
    #[derive(Clone)]
    struct CountingWindowDispatcher {
        inner: MockWindowDispatcher,
        log: Arc<MethodCallLog>,
    }

    impl std::fmt::Debug for CountingWindowDispatcher {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("CountingWindowDispatcher")
                .field("inner", &self.inner)
                .finish()
        }
    }

    impl<T: UserEvent + Send + Sync + 'static> WindowDispatch<T> for CountingWindowDispatcher {
        type Runtime = CountingRuntime<T>;
        type WindowBuilder = MockWindowBuilder;

        fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::run_on_main_thread(&self.inner, f)
        }

        fn on_window_event<F: Fn(&tauri_runtime::window::WindowEvent) + Send + 'static>(
            &self,
            f: F,
        ) -> tauri_runtime::WindowEventId {
            <MockWindowDispatcher as WindowDispatch<T>>::on_window_event(&self.inner, f)
        }

        fn scale_factor(&self) -> Result<f64> {
            <MockWindowDispatcher as WindowDispatch<T>>::scale_factor(&self.inner)
        }

        fn inner_position(&self) -> Result<tauri_runtime::dpi::PhysicalPosition<i32>> {
            <MockWindowDispatcher as WindowDispatch<T>>::inner_position(&self.inner)
        }

        fn outer_position(&self) -> Result<tauri_runtime::dpi::PhysicalPosition<i32>> {
            <MockWindowDispatcher as WindowDispatch<T>>::outer_position(&self.inner)
        }

        fn inner_size(&self) -> Result<tauri_runtime::dpi::PhysicalSize<u32>> {
            <MockWindowDispatcher as WindowDispatch<T>>::inner_size(&self.inner)
        }

        fn outer_size(&self) -> Result<tauri_runtime::dpi::PhysicalSize<u32>> {
            <MockWindowDispatcher as WindowDispatch<T>>::outer_size(&self.inner)
        }

        fn is_fullscreen(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_fullscreen(&self.inner)
        }

        fn is_minimized(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_minimized(&self.inner)
        }

        fn is_maximized(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_maximized(&self.inner)
        }

        fn is_focused(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_focused(&self.inner)
        }

        fn is_decorated(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_decorated(&self.inner)
        }

        fn is_resizable(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_resizable(&self.inner)
        }

        fn is_maximizable(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_maximizable(&self.inner)
        }

        fn is_minimizable(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_minimizable(&self.inner)
        }

        fn is_closable(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_closable(&self.inner)
        }

        fn is_visible(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_visible(&self.inner)
        }

        fn is_enabled(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_enabled(&self.inner)
        }

        fn is_always_on_top(&self) -> Result<bool> {
            <MockWindowDispatcher as WindowDispatch<T>>::is_always_on_top(&self.inner)
        }

        fn title(&self) -> Result<String> {
            <MockWindowDispatcher as WindowDispatch<T>>::title(&self.inner)
        }

        fn current_monitor(&self) -> Result<Option<tauri_runtime::monitor::Monitor>> {
            <MockWindowDispatcher as WindowDispatch<T>>::current_monitor(&self.inner)
        }

        fn primary_monitor(&self) -> Result<Option<tauri_runtime::monitor::Monitor>> {
            <MockWindowDispatcher as WindowDispatch<T>>::primary_monitor(&self.inner)
        }

        fn monitor_from_point(&self, x: f64, y: f64) -> Result<Option<tauri_runtime::monitor::Monitor>> {
            <MockWindowDispatcher as WindowDispatch<T>>::monitor_from_point(&self.inner, x, y)
        }

        fn available_monitors(&self) -> Result<Vec<tauri_runtime::monitor::Monitor>> {
            <MockWindowDispatcher as WindowDispatch<T>>::available_monitors(&self.inner)
        }

        fn theme(&self) -> Result<tauri_utils::Theme> {
            <MockWindowDispatcher as WindowDispatch<T>>::theme(&self.inner)
        }

        fn window_handle(
            &self,
        ) -> std::result::Result<
            raw_window_handle::WindowHandle<'_>,
            raw_window_handle::HandleError,
        > {
            <MockWindowDispatcher as WindowDispatch<T>>::window_handle(&self.inner)
        }

        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn gtk_window(&self) -> Result<gtk::ApplicationWindow> {
            <MockWindowDispatcher as WindowDispatch<T>>::gtk_window(&self.inner)
        }

        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn default_vbox(&self) -> Result<gtk::Box> {
            <MockWindowDispatcher as WindowDispatch<T>>::default_vbox(&self.inner)
        }

        #[cfg(target_os = "android")]
        fn activity_name(&self) -> Result<String> {
            <MockWindowDispatcher as WindowDispatch<T>>::activity_name(&self.inner)
        }

        #[cfg(target_os = "ios")]
        fn scene_identifier(&self) -> Result<String> {
            <MockWindowDispatcher as WindowDispatch<T>>::scene_identifier(&self.inner)
        }

        fn center(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::center(&self.inner)
        }

        fn request_user_attention(
            &self,
            request_type: Option<tauri_runtime::UserAttentionType>,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::request_user_attention(&self.inner, request_type)
        }

        fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
            &mut self,
            pending: tauri_runtime::window::PendingWindow<T, Self::Runtime>,
            after_window_creation: Option<F>,
        ) -> Result<DetachedWindow<T, Self::Runtime>> {
            let pending: tauri_runtime::window::PendingWindow<T, MockRuntime> =
                transmute_pending(pending);
            let mut detached = self.inner.create_window(pending, after_window_creation)?;
            Ok(DetachedWindow {
                id: detached.id,
                label: detached.label,
                dispatcher: CountingWindowDispatcher {
                    inner: detached.dispatcher.clone(),
                    log: Arc::clone(&self.log),
                },
                webview: detached.webview.take().map(|w| DetachedWindowWebview {
                    webview: DetachedWebview {
                        label: w.webview.label,
                        dispatcher: CountingWebviewDispatcher(w.webview.dispatcher),
                    },
                    use_https_scheme: w.use_https_scheme,
                }),
            })
        }

        fn create_webview(
            &mut self,
            pending: tauri_runtime::webview::PendingWebview<T, Self::Runtime>,
        ) -> Result<DetachedWebview<T, Self::Runtime>> {
            let pending = transmute_pending_webview(pending);
            let detached = self.inner.create_webview(pending)?;
            Ok(DetachedWebview {
                label: detached.label,
                dispatcher: CountingWebviewDispatcher(detached.dispatcher),
            })
        }

        fn set_resizable(&self, resizable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_resizable(&self.inner, resizable)
        }

        fn set_enabled(&self, enabled: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_enabled(&self.inner, enabled)
        }

        fn set_maximizable(&self, maximizable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_maximizable(&self.inner, maximizable)
        }

        fn set_minimizable(&self, minimizable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_minimizable(&self.inner, minimizable)
        }

        fn set_closable(&self, closable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_closable(&self.inner, closable)
        }

        fn set_title<S: Into<String>>(&self, title: S) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_title(&self.inner, title)
        }

        fn maximize(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::maximize(&self.inner)
        }

        fn unmaximize(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::unmaximize(&self.inner)
        }

        fn minimize(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::minimize(&self.inner)
        }

        fn unminimize(&self) -> Result<()> {
            self.log.push("unminimize");
            <MockWindowDispatcher as WindowDispatch<T>>::unminimize(&self.inner)
        }

        fn show(&self) -> Result<()> {
            self.log.push("show");
            <MockWindowDispatcher as WindowDispatch<T>>::show(&self.inner)
        }

        fn hide(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::hide(&self.inner)
        }

        fn close(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::close(&self.inner)
        }

        fn destroy(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::destroy(&self.inner)
        }

        fn set_decorations(&self, decorations: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_decorations(&self.inner, decorations)
        }

        fn set_shadow(&self, shadow: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_shadow(&self.inner, shadow)
        }

        fn set_always_on_bottom(&self, always_on_bottom: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_always_on_bottom(&self.inner, always_on_bottom)
        }

        fn set_always_on_top(&self, always_on_top: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_always_on_top(&self.inner, always_on_top)
        }

        fn set_visible_on_all_workspaces(&self, visible_on_all_workspaces: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_visible_on_all_workspaces(&self.inner, visible_on_all_workspaces)
        }

        fn set_content_protected(&self, protected: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_content_protected(&self.inner, protected)
        }

        fn set_size(&self, size: tauri_runtime::dpi::Size) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_size(&self.inner, size)
        }

        fn set_min_size(&self, size: Option<tauri_runtime::dpi::Size>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_min_size(&self.inner, size)
        }

        fn set_max_size(&self, size: Option<tauri_runtime::dpi::Size>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_max_size(&self.inner, size)
        }

        fn set_position(&self, position: tauri_runtime::dpi::Position) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_position(&self.inner, position)
        }

        fn set_fullscreen(&self, fullscreen: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_fullscreen(&self.inner, fullscreen)
        }

        #[cfg(target_os = "macos")]
        fn set_simple_fullscreen(&self, enable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_simple_fullscreen(&self.inner, enable)
        }

        fn set_focus(&self) -> Result<()> {
            self.log.push("set_focus");
            <MockWindowDispatcher as WindowDispatch<T>>::set_focus(&self.inner)
        }

        fn set_focusable(&self, focusable: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_focusable(&self.inner, focusable)
        }

        fn set_icon(&self, icon: tauri_runtime::Icon<'_>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_icon(&self.inner, icon)
        }

        fn set_skip_taskbar(&self, skip: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_skip_taskbar(&self.inner, skip)
        }

        fn set_cursor_grab(&self, grab: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_cursor_grab(&self.inner, grab)
        }

        fn set_cursor_visible(&self, visible: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_cursor_visible(&self.inner, visible)
        }

        fn set_cursor_icon(&self, icon: tauri_runtime::window::CursorIcon) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_cursor_icon(&self.inner, icon)
        }

        fn set_cursor_position<Pos: Into<tauri_runtime::dpi::Position>>(
            &self,
            position: Pos,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_cursor_position(&self.inner, position)
        }

        fn set_ignore_cursor_events(&self, ignore: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_ignore_cursor_events(&self.inner, ignore)
        }

        fn start_dragging(&self) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::start_dragging(&self.inner)
        }

        fn start_resize_dragging(
            &self,
            direction: tauri_runtime::ResizeDirection,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::start_resize_dragging(&self.inner, direction)
        }

        fn set_progress_bar(&self, progress_state: tauri_runtime::ProgressBarState) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_progress_bar(&self.inner, progress_state)
        }

        fn set_badge_count(&self, count: Option<i64>, desktop_filename: Option<String>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_badge_count(&self.inner, count, desktop_filename)
        }

        fn set_badge_label(&self, label: Option<String>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_badge_label(&self.inner, label)
        }

        fn set_overlay_icon(&self, icon: Option<tauri_runtime::Icon<'_>>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_overlay_icon(&self.inner, icon)
        }

        fn set_title_bar_style(&self, style: tauri_utils::TitleBarStyle) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_title_bar_style(&self.inner, style)
        }

        fn set_traffic_light_position(&self, position: tauri_runtime::dpi::Position) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_traffic_light_position(&self.inner, position)
        }

        fn set_size_constraints(
            &self,
            constraints: tauri_runtime::window::WindowSizeConstraints,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_size_constraints(&self.inner, constraints)
        }

        fn set_theme(&self, theme: Option<tauri_utils::Theme>) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_theme(&self.inner, theme)
        }

        fn set_background_color(
            &self,
            color: Option<tauri_utils::config::Color>,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_background_color(&self.inner, color)
        }
    }

    // Convert `PendingWindow<T, CountingRuntime<T>>` into the
    // `PendingWindow<T, MockRuntime>` that the inner `MockRuntime`
    // constructor expects. The two runtimes share their window and
    // webview dispatcher types at the bit level — `CountingWindowDispatcher`
    // is just `MockWindowDispatcher + log`, `CountingWebviewDispatcher` is
    // `#[repr(transparent)]` over `MockWebviewDispatcher`, and both
    // runtimes' `WindowBuilder` is `MockWindowBuilder` — so the
    // representations match. We only ever invoke `MockRuntime::create_window`
    // after the transmute, and that function reads `pending.label` and
    // `pending.webview.unwrap().url` (both `String`); the
    // R-parameterised `WebviewIpcHandler` closure inside `PendingWebview`
    // is never invoked, so its nominal `R` mismatch is never observed.
    fn transmute_pending<T: UserEvent + Send + Sync + 'static>(
        pending: tauri_runtime::window::PendingWindow<T, CountingRuntime<T>>,
    ) -> tauri_runtime::window::PendingWindow<T, MockRuntime> {
        // SAFETY: see the comment above the function. The `R` type parameter
        // appears in `PendingWindow` only via `R::WindowDispatcher`'s
        // `WindowBuilder` (same `MockWindowBuilder` on both runtimes) and via
        // `PendingWebview`'s `WebviewIpcHandler` closure (never invoked).
        // All other fields are `R`-independent, so the structs are
        // layout-compatible.
        unsafe {
            std::mem::transmute::<
                tauri_runtime::window::PendingWindow<T, CountingRuntime<T>>,
                tauri_runtime::window::PendingWindow<T, MockRuntime>,
            >(pending)
        }
    }

    fn transmute_pending_webview<T: UserEvent + Send + Sync + 'static>(
        pending: tauri_runtime::webview::PendingWebview<T, CountingRuntime<T>>,
    ) -> tauri_runtime::webview::PendingWebview<T, MockRuntime> {
        // SAFETY: see `transmute_pending`. The `PendingWebview` shape is
        // determined by the same `R`-independent fields plus the
        // `WebviewIpcHandler` closure (never invoked). All other
        // handler fields (`Box<dyn Fn(Request<String>) + Send>` etc.)
        // are `R`-independent.
        unsafe {
            std::mem::transmute::<
                tauri_runtime::webview::PendingWebview<T, CountingRuntime<T>>,
                tauri_runtime::webview::PendingWebview<T, MockRuntime>,
            >(pending)
        }
    }

    /// Runtime handle that delegates to [`MockRuntimeHandle`] but routes the
    /// window dispatcher through [`CountingWindowDispatcher`] so every
    /// `create_window` call hooks into the same shared log.
    #[derive(Clone)]
    struct CountingRuntimeHandle {
        inner: MockRuntimeHandle,
        log: Arc<MethodCallLog>,
    }

    impl std::fmt::Debug for CountingRuntimeHandle {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("CountingRuntimeHandle").finish()
        }
    }

    impl<T: UserEvent + Send + Sync + 'static> RuntimeHandle<T> for CountingRuntimeHandle {
        type Runtime = CountingRuntime<T>;

        fn create_proxy(&self) -> CountingEventProxy {
            CountingEventProxy
        }

        #[cfg(target_os = "macos")]
        fn set_activation_policy(
            &self,
            activation_policy: tauri_runtime::ActivationPolicy,
        ) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_activation_policy(&self.inner, activation_policy)
        }

        #[cfg(target_os = "macos")]
        fn set_dock_visibility(&self, visible: bool) -> Result<()> {
            <MockWindowDispatcher as WindowDispatch<T>>::set_dock_visibility(&self.inner, visible)
        }

        fn request_exit(&self, code: i32) -> Result<()> {
            <MockRuntimeHandle as RuntimeHandle<T>>::request_exit(&self.inner, code)
        }

        fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
            &self,
            pending: tauri_runtime::window::PendingWindow<T, Self::Runtime>,
            after_window_creation: Option<F>,
        ) -> Result<DetachedWindow<T, Self::Runtime>> {
            let pending: tauri_runtime::window::PendingWindow<T, MockRuntime> =
                transmute_pending(pending);
            let mut detached = self.inner.create_window(pending, after_window_creation)?;
            Ok(DetachedWindow {
                id: detached.id,
                label: detached.label,
                dispatcher: CountingWindowDispatcher {
                    inner: detached.dispatcher.clone(),
                    log: Arc::clone(&self.log),
                },
                webview: detached.webview.take().map(|w| DetachedWindowWebview {
                    webview: DetachedWebview {
                        label: w.webview.label,
                        dispatcher: CountingWebviewDispatcher(w.webview.dispatcher),
                    },
                    use_https_scheme: w.use_https_scheme,
                }),
            })
        }

        fn create_webview(
            &self,
            window_id: tauri_runtime::window::WindowId,
            pending: tauri_runtime::webview::PendingWebview<T, Self::Runtime>,
        ) -> Result<DetachedWebview<T, Self::Runtime>> {
            let pending = transmute_pending_webview(pending);
            let detached = self.inner.create_webview(window_id, pending)?;
            Ok(DetachedWebview {
                label: detached.label,
                dispatcher: CountingWebviewDispatcher(detached.dispatcher),
            })
        }

        fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
            <MockRuntimeHandle as RuntimeHandle<T>>::run_on_main_thread(&self.inner, f)
        }

        fn display_handle(
            &self,
        ) -> std::result::Result<
            raw_window_handle::DisplayHandle<'_>,
            raw_window_handle::HandleError,
        > {
            <MockRuntimeHandle as RuntimeHandle<T>>::display_handle(&self.inner)
        }

        fn primary_monitor(&self) -> Option<tauri_runtime::monitor::Monitor> {
            <MockRuntimeHandle as RuntimeHandle<T>>::primary_monitor(&self.inner)
        }

        fn monitor_from_point(&self, x: f64, y: f64) -> Option<tauri_runtime::monitor::Monitor> {
            <MockRuntimeHandle as RuntimeHandle<T>>::monitor_from_point(&self.inner, x, y)
        }

        fn available_monitors(&self) -> Vec<tauri_runtime::monitor::Monitor> {
            <MockRuntimeHandle as RuntimeHandle<T>>::available_monitors(&self.inner)
        }

        fn cursor_position(&self) -> Result<tauri_runtime::dpi::PhysicalPosition<f64>> {
            <MockRuntimeHandle as RuntimeHandle<T>>::cursor_position(&self.inner)
        }

        fn set_theme(&self, theme: Option<tauri_utils::Theme>) {
            <MockRuntimeHandle as RuntimeHandle<T>>::set_theme(&self.inner, theme)
        }

        #[cfg(target_os = "macos")]
        fn show(&self) -> Result<()> {
            <MockRuntimeHandle as RuntimeHandle<T>>::show(&self.inner)
        }

        #[cfg(target_os = "macos")]
        fn hide(&self) -> Result<()> {
            <MockRuntimeHandle as RuntimeHandle<T>>::hide(&self.inner)
        }

        fn set_device_event_filter(&self, filter: DeviceEventFilter) {
            <MockRuntimeHandle as RuntimeHandle<T>>::set_device_event_filter(&self.inner, filter)
        }
    }

    /// Webview dispatcher that wraps a [`MockWebviewDispatcher`] but reports
    /// `CountingRuntime<T>` as its associated runtime so it can satisfy the
    /// `Runtime::WebviewDispatcher` bound. Tauri's `WebviewWindow` keeps this
    /// dispatcher around for IPC plumbing; the test only exercises the
    /// window-side dispatcher, so all webview methods pass through unchanged.
    ///
    /// `repr(transparent)` keeps the layout identical to the wrapped type so
    /// `PendingWindow<T, CountingRuntime<T>>` and `PendingWindow<T, MockRuntime>`
    /// are layout-compatible — the `transmute` we use to delegate to the inner
    /// runtime relies on that.
    #[derive(Clone)]
    #[repr(transparent)]
    struct CountingWebviewDispatcher(MockWebviewDispatcher);

    impl std::fmt::Debug for CountingWebviewDispatcher {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_tuple("CountingWebviewDispatcher").finish()
        }
    }

    impl<T: UserEvent + Send + Sync + 'static> WebviewDispatch<T> for CountingWebviewDispatcher {
        type Runtime = CountingRuntime<T>;

        fn run_on_main_thread<F: FnOnce() + Send + 'static>(&self, f: F) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::run_on_main_thread(&self.0, f)
        }

        fn on_webview_event<F: Fn(&tauri_runtime::window::WebviewEvent) + Send + 'static>(
            &self,
            f: F,
        ) -> tauri_runtime::WebviewEventId {
            <MockWebviewDispatcher as WebviewDispatch<T>>::on_webview_event(&self.0, f)
        }

        fn with_webview<F: FnOnce(Box<dyn std::any::Any>) + Send + 'static>(
            &self,
            f: F,
        ) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::with_webview(&self.0, f)
        }

        #[cfg(any(debug_assertions, feature = "devtools"))]
        fn open_devtools(&self) {
            <MockWebviewDispatcher as WebviewDispatch<T>>::open_devtools(&self.0)
        }

        #[cfg(any(debug_assertions, feature = "devtools"))]
        fn close_devtools(&self) {
            <MockWebviewDispatcher as WebviewDispatch<T>>::close_devtools(&self.0)
        }

        #[cfg(any(debug_assertions, feature = "devtools"))]
        fn is_devtools_open(&self) -> Result<bool> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::is_devtools_open(&self.0)
        }

        fn url(&self) -> Result<String> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::url(&self.0)
        }

        fn bounds(&self) -> Result<tauri_runtime::dpi::Rect> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::bounds(&self.0)
        }

        fn position(&self) -> Result<tauri_runtime::dpi::PhysicalPosition<i32>> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::position(&self.0)
        }

        fn size(&self) -> Result<tauri_runtime::dpi::PhysicalSize<u32>> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::size(&self.0)
        }

        fn navigate(&self, url: Url) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::navigate(&self.0, url)
        }

        fn reload(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::reload(&self.0)
        }

        fn print(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::print(&self.0)
        }

        fn close(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::close(&self.0)
        }

        fn set_bounds(&self, bounds: tauri_runtime::dpi::Rect) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_bounds(&self.0, bounds)
        }

        fn set_size(&self, size: tauri_runtime::dpi::Size) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_size(&self.0, size)
        }

        fn set_position(&self, position: tauri_runtime::dpi::Position) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_position(&self.0, position)
        }

        fn set_focus(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_focus(&self.0)
        }

        fn hide(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::hide(&self.0)
        }

        fn show(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::show(&self.0)
        }

        fn eval_script<S: Into<String>>(&self, script: S) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::eval_script(&self.0, script)
        }

        fn eval_script_with_callback<S: Into<String>>(
            &self,
            script: S,
            callback: impl Fn(String) + Send + 'static,
        ) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::eval_script_with_callback(&self.0, script, callback)
        }

        fn reparent(&self, window_id: tauri_runtime::window::WindowId) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::reparent(&self.0, window_id)
        }

        fn cookies(&self) -> Result<Vec<tauri_runtime::Cookie<'static>>> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::cookies(&self.0)
        }

        fn cookies_for_url(&self, url: Url) -> Result<Vec<tauri_runtime::Cookie<'static>>> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::cookies_for_url(&self.0, url)
        }

        fn set_cookie(&self, cookie: tauri_runtime::Cookie<'_>) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_cookie(&self.0, cookie)
        }

        fn delete_cookie(&self, cookie: tauri_runtime::Cookie<'_>) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::delete_cookie(&self.0, cookie)
        }

        fn set_auto_resize(&self, auto_resize: bool) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_auto_resize(&self.0, auto_resize)
        }

        fn set_zoom(&self, scale_factor: f64) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_zoom(&self.0, scale_factor)
        }

        fn set_background_color(
            &self,
            color: Option<tauri_utils::config::Color>,
        ) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::set_background_color(&self.0, color)
        }

        fn clear_all_browsing_data(&self) -> Result<()> {
            <MockWebviewDispatcher as WebviewDispatch<T>>::clear_all_browsing_data(&self.0)
        }
    }

    #[derive(Clone, Debug)]
    struct CountingEventProxy;

    impl<T: UserEvent + Send + Sync + 'static> EventLoopProxy<T> for CountingEventProxy {
        fn send_event(&self, _event: T) -> Result<()> {
            Ok(())
        }
    }

    /// `tauri::Runtime` decorator that wraps [`MockRuntime`] so every window
    /// dispatcher it produces records its `unminimize`/`show`/`set_focus`
    /// calls into a shared [`MethodCallLog`].
    struct CountingRuntime<T: UserEvent> {
        inner: MockRuntime,
        handle: CountingRuntimeHandle,
        _marker: std::marker::PhantomData<T>,
    }

    impl<T: UserEvent + Send + Sync + 'static> std::fmt::Debug for CountingRuntime<T> {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("CountingRuntime").finish()
        }
    }

    impl<T: UserEvent + Send + Sync + 'static> Runtime<T> for CountingRuntime<T> {
        type WindowDispatcher = CountingWindowDispatcher;
        type WebviewDispatcher = CountingWebviewDispatcher;
        type Handle = CountingRuntimeHandle;
        type EventLoopProxy = CountingEventProxy;

        fn new(_args: RuntimeInitArgs) -> Result<Self> {
            let inner = <MockRuntime as Runtime<T>>::new(_args)?;
            // Pick up the test's log if one is installed; otherwise fall back
            // to a fresh log. The OnceLock is initialised lazily — the first
            // `active_log()` access from the test installs the handle.
            let log = Arc::clone(active_log());
            let handle = CountingRuntimeHandle {
                inner: <MockRuntime as Runtime<T>>::handle(&inner),
                log: Arc::clone(&log),
            };
            Ok(Self {
                inner,
                handle,
                _marker: std::marker::PhantomData,
            })
        }

        #[cfg(any(
            windows,
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        fn new_any_thread(args: RuntimeInitArgs) -> Result<Self> {
            Self::new(args)
        }

        fn create_proxy(&self) -> CountingEventProxy {
            CountingEventProxy
        }

        fn handle(&self) -> Self::Handle {
            self.handle.clone()
        }

        fn create_window<F: Fn(RawWindow<'_>) + Send + 'static>(
            &self,
            pending: tauri_runtime::window::PendingWindow<T, Self>,
            after_window_creation: Option<F>,
        ) -> Result<DetachedWindow<T, Self>> {
            let pending: tauri_runtime::window::PendingWindow<T, MockRuntime> =
                transmute_pending(pending);
            let mut detached = self.inner.create_window(pending, after_window_creation)?;
            Ok(DetachedWindow {
                id: detached.id,
                label: detached.label,
                dispatcher: CountingWindowDispatcher {
                    inner: detached.dispatcher.clone(),
                    log: Arc::clone(&self.handle.log),
                },
                webview: detached.webview.take().map(|w| DetachedWindowWebview {
                    webview: DetachedWebview {
                        label: w.webview.label,
                        dispatcher: CountingWebviewDispatcher(w.webview.dispatcher),
                    },
                    use_https_scheme: w.use_https_scheme,
                }),
            })
        }

        fn create_webview(
            &self,
            window_id: tauri_runtime::window::WindowId,
            pending: tauri_runtime::webview::PendingWebview<T, Self>,
        ) -> Result<DetachedWebview<T, Self>> {
            let pending = transmute_pending_webview(pending);
            let detached = self.inner.create_webview(window_id, pending)?;
            Ok(DetachedWebview {
                label: detached.label,
                dispatcher: CountingWebviewDispatcher(detached.dispatcher),
            })
        }

        fn primary_monitor(&self) -> Option<tauri_runtime::monitor::Monitor> {
            <MockRuntime as Runtime<T>>::primary_monitor(&self.inner)
        }

        fn monitor_from_point(
            &self,
            x: f64,
            y: f64,
        ) -> Option<tauri_runtime::monitor::Monitor> {
            <MockRuntime as Runtime<T>>::monitor_from_point(&self.inner, x, y)
        }

        fn available_monitors(&self) -> Vec<tauri_runtime::monitor::Monitor> {
            <MockRuntime as Runtime<T>>::available_monitors(&self.inner)
        }

        fn cursor_position(&self) -> Result<tauri_runtime::dpi::PhysicalPosition<f64>> {
            <MockRuntime as Runtime<T>>::cursor_position(&self.inner)
        }

        fn set_theme(&self, theme: Option<tauri_utils::Theme>) {
            <MockRuntime as Runtime<T>>::set_theme(&self.inner, theme)
        }

        #[cfg(target_os = "macos")]
        fn set_activation_policy(&mut self, activation_policy: tauri_runtime::ActivationPolicy) {
            <MockRuntime as Runtime<T>>::set_activation_policy(&mut self.inner, activation_policy)
        }

        #[cfg(target_os = "macos")]
        fn set_dock_visibility(&mut self, visible: bool) {
            <MockRuntime as Runtime<T>>::set_dock_visibility(&mut self.inner, visible)
        }

        #[cfg(target_os = "macos")]
        fn show(&self) {
            <MockRuntime as Runtime<T>>::show(&self.inner)
        }

        #[cfg(target_os = "macos")]
        fn hide(&self) {
            <MockRuntime as Runtime<T>>::hide(&self.inner)
        }

        fn set_device_event_filter(&mut self, filter: DeviceEventFilter) {
            <MockRuntime as Runtime<T>>::set_device_event_filter(&mut self.inner, filter)
        }

        fn run_iteration<F: FnMut(RunEvent<T>) + 'static>(&mut self, callback: F) {
            #[cfg(desktop)]
            self.inner.run_iteration(callback)
        }

        fn run_return<F: FnMut(RunEvent<T>) + 'static>(self, callback: F) -> i32 {
            self.inner.run_return(callback)
        }

        fn run<F: FnMut(RunEvent<T>) + 'static>(self, callback: F) {
            self.inner.run(callback)
        }
    }

    // The runtime is created inside `Builder::build`, so the test needs a way
    // to share its log with the freshly built `CountingRuntime`. The
    // `active_log()` helper at the top of the module handles this — the test
    // clears it before building and reads it back after.

    /// Build a `CountingRuntime` app with a "main" webview window, invoke
    /// `bring_main_window_forward`, and assert the recorded call sequence
    /// is exactly `[unminimize, show, set_focus]`. Public so the
    /// `tests/single_instance.rs` integration test can call it directly.
    pub fn run_bring_main_window_forward_against_counting_runtime() {
        // Clear the shared log so this run starts from a clean slate.
        let runtime_log = active_log();
        runtime_log.calls.lock().unwrap().clear();

        let app = tauri::Builder::<CountingRuntime<tauri::EventLoopMessage>>::new()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("counting app builds");

        let _ = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("main window builds");

        crate::bring_main_window_forward(&app.handle());

        let calls = runtime_log.snapshot();

        assert_eq!(
            calls,
            vec!["unminimize", "show", "set_focus"],
            "bring_main_window_forward must call the three operations in order"
        );
    }

    #[test]
    fn bring_main_window_forward_calls_three_operations_on_main_window() {
        run_bring_main_window_forward_against_counting_runtime();
    }
}
