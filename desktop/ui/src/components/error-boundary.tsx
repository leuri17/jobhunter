import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Catches render-time throws and query throws that escape the route
 * component tree, and renders a `RetryPanel` fallback instead of
 * unmounting the entire webview (audit C2 / B-L4.2). Recovery is
 * local: clicking *Retry* resets the boundary state and re-renders
 * the children. The first error to escape a render path inside the
 * boundary is captured; subsequent children may recover naturally
 * once the underlying cause (e.g. a malformed SSE payload, a stale
 * query cache) is cleared.
 *
 * The boundary does NOT catch:
 *   - Event handlers — those run outside the render path and should
 *     surface as `try/catch` errors at the call site.
 *   - Asynchronous work (Promises, `setTimeout`) — wrap those in
 *     `try/catch` or `.catch(...)` at the call site.
 *   - Server-side rendering errors — N/A in this desktop app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // No remote log sink in this desktop app. The structured
    // application logger lives in `src/logging/` (Rust/Tauri side)
    // and is not reachable from the webview; console.error is the
    // only signal the user can pick up via DevTools.
    console.error('ErrorBoundary caught render error', error, info.componentStack);
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <RetryPanel error={this.state.error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

interface RetryPanelProps {
  readonly error: Error;
  readonly onRetry: () => void;
}

/**
 * Fallback surface rendered by `ErrorBoundary`. Designed to be small
 * and inline so it never throws itself (which would re-trigger the
 * boundary and create a render loop). Uses the same `role="alert"`
 * + `aria-live` pattern as `SidecarBanner` for consistency.
 */
export function RetryPanel({ error, onRetry }: RetryPanelProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <h2 className="text-base font-semibold mb-2">Something went wrong</h2>
      <p className="mb-3 text-muted-foreground">
        The current view failed to render. The rest of the app is still reachable from the
        sidebar.
      </p>
      <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs">
        {error.message}
      </pre>
      <Button onClick={onRetry} variant="outline" size="sm">
        Retry
      </Button>
    </div>
  );
}
