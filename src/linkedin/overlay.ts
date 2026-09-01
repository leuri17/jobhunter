/**
 * Overlay detection + dismissal.
 *
 * The orchestrator calls `detectOverlays` per search to enumerate
 * currently-visible overlays (login / join / cookie consent / modal),
 * then iterates each descriptor with `dismissOverlay`. The dismisser
 * applies ONE strategy (close / Escape / outside-click / accept /
 * reject) bounded by `overlayDismissalMs`; if the overlay is still
 * visible afterwards it returns `{ kind: 'undismissable' }` so the
 * caller can convert to `OverlayUndismissableError` at the per-search
 * boundary.
 *
 * Imports `Page` and `Locator` as TYPES only — the runtime values flow
 * through Playwright in  (`playwright-session.ts`).
 * exercises this code via inline fakes in `tests/linkedin/overlay.test.ts`.
 */
import type { Page, Locator } from 'playwright';

import { LINKEDIN_SELECTORS, OVERLAY_DISMISSAL_STRATEGY } from './selectors.js';
import type {
  OverlayDescriptor,
  OverlayDismissalResult,
  OverlayDismissalStrategy,
} from './state.js';

export interface OverlayDetectionOptions {
  readonly overlayDismissalMs: number;
}

/** A pair of selectors the overlay detector should test against. */
interface OverlaySelectorEntry {
  readonly key: keyof typeof LINKEDIN_SELECTORS.overlays;
  readonly selector: string;
  readonly strategy: OverlayDismissalStrategy;
  readonly label: string;
}

/**
 * Ordered list of overlays to detect. The detector walks the list
 * topmost-first (z-index heuristic proxy). Cookies / global alerts
 * are checked last so a login modal takes precedence.
 */
const OVERLAY_ENTRIES: readonly OverlaySelectorEntry[] = [
  {
    key: 'loginModal',
    selector: LINKEDIN_SELECTORS.overlays.loginModal,
    strategy: OVERLAY_DISMISSAL_STRATEGY.loginModal,
    label: 'LinkedIn login modal',
  },
  {
    key: 'joinModal',
    selector: LINKEDIN_SELECTORS.overlays.joinModal,
    strategy: OVERLAY_DISMISSAL_STRATEGY.joinModal,
    label: 'LinkedIn join modal',
  },
  {
    key: 'genericModal',
    selector: LINKEDIN_SELECTORS.overlays.genericModal,
    strategy: OVERLAY_DISMISSAL_STRATEGY.genericModal,
    label: 'Generic LinkedIn modal',
  },
  {
    key: 'cookieConsent',
    selector: LINKEDIN_SELECTORS.overlays.cookieConsent,
    strategy: OVERLAY_DISMISSAL_STRATEGY.cookieConsent,
    label: 'Cookie consent banner',
  },
  {
    key: 'closeButton',
    selector: LINKEDIN_SELECTORS.overlays.closeButton,
    strategy: OVERLAY_DISMISSAL_STRATEGY.closeButton,
    label: 'Floating close button',
  },
];

/**
 * Detect all currently-visible overlays on the page. Pure read: no
 * mutation, no network, no I/O beyond the Playwright locator query.
 *
 * The detector considers an overlay visible when its container
 * locator resolves to at least one node.
 */
export async function detectOverlays(
  page: Page,
  _opts: OverlayDetectionOptions,
): Promise<readonly OverlayDescriptor[]> {
  void _opts;
  const descriptors: OverlayDescriptor[] = [];
  for (const entry of OVERLAY_ENTRIES) {
    const locator = page.locator(entry.selector);
    if ((await locator.count()) > 0) {
      descriptors.push({
        selector: entry.selector,
        strategy: entry.strategy,
        label: entry.label,
      });
    }
  }
  return descriptors;
}

/**
 * Apply ONE strategy to dismiss a single overlay, bounded by
 * `overlayDismissalMs`. Returns the discriminated `OverlayDismissalResult`;
 * the caller is responsible for converting `kind: 'undismissable'` to
 * a thrown `OverlayUndismissableError` (orchestrator).
 */
export async function dismissOverlay(
  page: Page,
  descriptor: OverlayDescriptor,
  opts: OverlayDetectionOptions,
): Promise<OverlayDismissalResult> {
  const locator = page.locator(descriptor.selector);
  const applied = await applyStrategy(page, locator, descriptor.strategy, opts.overlayDismissalMs);
  if (!applied) {
    return {
      kind: 'undismissable',
      selector: descriptor.selector,
      reason: 'strategy did not hide overlay',
    };
  }
  try {
    await locator.first().waitFor({ state: 'hidden', timeout: opts.overlayDismissalMs });
    return { kind: 'dismissed', selector: descriptor.selector };
  } catch {
    return {
      kind: 'undismissable',
      selector: descriptor.selector,
      reason: `overlay still visible after ${opts.overlayDismissalMs}ms`,
    };
  }
}

/**
 * Convenience: detect + dismiss every recoverable overlay. Returns
 * the dismissed set + the undismissable set so the orchestrator can
 * record both via `DiagnosticManager.recordScraperError`.
 */
export async function dismissRecoverableOverlays(
  page: Page,
  opts: OverlayDetectionOptions,
): Promise<{
  readonly dismissed: readonly OverlayDescriptor[];
  readonly undismissed: readonly OverlayDescriptor[];
}> {
  const descriptors = await detectOverlays(page, opts);
  const dismissed: OverlayDescriptor[] = [];
  const undismissed: OverlayDescriptor[] = [];
  for (const descriptor of descriptors) {
    const result = await dismissOverlay(page, descriptor, opts);
    if (result.kind === 'dismissed') {
      dismissed.push(descriptor);
    } else {
      undismissed.push(descriptor);
    }
  }
  return { dismissed, undismissed };
}

/**
 * Apply a single dismissal strategy. Returns `true` if the action was
 * attempted (callers should follow up with a `waitFor` to confirm).
 * Each branch uses Playwright locator semantics that are compatible
 * with both the real `BrowserSession` and the inline test
 * fakes.
 */
async function applyStrategy(
  page: Page,
  locator: Locator,
  strategy: OverlayDismissalStrategy,
  _overlayDismissalMs: number,
): Promise<boolean> {
  void _overlayDismissalMs;
  switch (strategy) {
    case 'close': {
      // Try the LinkedIn close button first; fall back to clicking the overlay itself.
      const closeButton = page.locator(LINKEDIN_SELECTORS.overlays.closeButton);
      if ((await closeButton.count()) > 0) {
        await closeButton.first().click({ timeout: 0 });
        return true;
      }
      await locator.first().click({ timeout: 0 });
      return true;
    }
    case 'escape':
      await page.keyboard.press('Escape');
      return true;
    case 'outside_click': {
      // Click at (0, 0) — outside any reasonable overlay position.
      await page.mouse.click(0, 0);
      return true;
    }
    case 'accept':
      // LinkedIn renders an "Accept" button inside the cookie consent
      // banner; we approximate by clicking the banner's primary CTA.
      await locator.first().click({ timeout: 0 });
      return true;
    case 'reject':
      await locator.first().click({ timeout: 0 });
      return true;
  }
}
