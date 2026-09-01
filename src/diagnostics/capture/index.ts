export type { CaptureArtifactType, CaptureContext, CaptureResult, CaptureStrategy } from './types.js';
export { StackTraceCapture } from './stack-trace.js';
export { CurrentUrlCapture } from './current-url.js';
export { ScreenshotCapture } from './screenshot.js';
// Backward-compatible re-export: the legacy `PlaywrightTraceCapture`
// name is now an alias for the new `LinkedInPlaywrightTraceCapture`
// class. Tests + call sites that imported `PlaywrightTraceCapture`
// from this barrel keep working unchanged.
export { LinkedInPlaywrightTraceCapture as PlaywrightTraceCapture } from './playwright-trace.js';
export { LinkedInPlaywrightTraceCapture } from './playwright-trace.js';
export { HtmlSnapshotCapture } from './html-snapshot.js';