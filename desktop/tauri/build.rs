fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(
                tauri_build::AppManifest::new()
                    .commands(&["sidecar_port", "notify_pipeline_complete"]),
            ),
    )
    .expect("failed to build tauri application");
}
