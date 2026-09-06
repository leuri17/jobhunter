//! Pure payload builders for the OS-level notification surface.
//!
//! The Tauri command layer (`desktop/tauri/src/lib.rs`) takes a
//! `tauri::AppHandle`, the runtime status string, and the discovered
//! count, and emits an OS notification. The (title, body) shape is
//! status-dependent and pluralization depends on the count — neither
//! can be exercised at the unit level while living inside the
//! `tauri::command` body.
//!
//! This module extracts the payload computation into a pure function
//! so the 4-branch status mapping + the singular/plural inflection
//! can be pinned by tests (audit B4-B-L4.7 / H19).

/// Compute the `(title, body)` pair for a `notify_pipeline_complete`
/// system notification. The four documented branches are:
///   - `"done"`      → "Pipeline complete" + "Found <count> new job[s] matching your profile."
///   - `"failed"`    → "Pipeline failed" + a static explanation pointing the user at the runs tab.
///   - `"cancelled"` → "Pipeline cancelled" + a static explanation.
///   - *anything else* → "Pipeline update" + "Pipeline status: <other>." (forward-compatible).
///
/// Pluralization uses `count == 1` as the singular boundary; 0 uses
/// the plural form (consistent with natural-language usage and the
/// existing UI surface — see
/// `desktop/ui/src/components/log-pane.tsx` if/when this count is
/// rendered).
pub fn notification_payload_for(status: &str, count: u32) -> (String, String) {
    match status {
        "done" => (
            "Pipeline complete".to_string(),
            format!(
                "Found {count} new job{} matching your profile.",
                if count == 1 { "" } else { "s" },
            ),
        ),
        "failed" => (
            "Pipeline failed".to_string(),
            "The discovery pipeline encountered an error. Check the runs tab for details."
                .to_string(),
        ),
        "cancelled" => (
            "Pipeline cancelled".to_string(),
            "The discovery pipeline was cancelled before completion.".to_string(),
        ),
        other => (
            "Pipeline update".to_string(),
            format!("Pipeline status: {other}."),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::notification_payload_for;

    #[test]
    fn done_status_with_singular_count_uses_singular_noun() {
        let (title, body) = notification_payload_for("done", 1);
        assert_eq!(title, "Pipeline complete");
        assert_eq!(body, "Found 1 new job matching your profile.");
    }

    #[test]
    fn done_status_with_plural_count_uses_plural_noun() {
        let (title, body) = notification_payload_for("done", 5);
        assert_eq!(title, "Pipeline complete");
        assert_eq!(body, "Found 5 new jobs matching your profile.");
    }

    #[test]
    fn done_status_with_zero_count_uses_plural_noun() {
        // Zero is plural in English ("0 jobs"). Lock the choice here
        // so a future refactor doesn't drift to "0 job".
        let (title, body) = notification_payload_for("done", 0);
        assert_eq!(title, "Pipeline complete");
        assert_eq!(body, "Found 0 new jobs matching your profile.");
    }

    #[test]
    fn failed_status_uses_documented_body_and_omits_count() {
        let (title, body) = notification_payload_for("failed", 0);
        assert_eq!(title, "Pipeline failed");
        assert_eq!(
            body,
            "The discovery pipeline encountered an error. Check the runs tab for details.",
        );
    }

    #[test]
    fn cancelled_status_uses_documented_body_and_omits_count() {
        let (title, body) = notification_payload_for("cancelled", 0);
        assert_eq!(title, "Pipeline cancelled");
        assert_eq!(
            body,
            "The discovery pipeline was cancelled before completion.",
        );
    }

    #[test]
    fn unknown_status_falls_through_to_update_template_with_status_name() {
        let (title, body) = notification_payload_for("weird-state", 0);
        assert_eq!(title, "Pipeline update");
        assert_eq!(body, "Pipeline status: weird-state.");
    }

    #[test]
    fn empty_status_falls_through_to_update_template_with_empty_payload() {
        let (title, body) = notification_payload_for("", 7);
        assert_eq!(title, "Pipeline update");
        assert_eq!(body, "Pipeline status: .");
    }
}
