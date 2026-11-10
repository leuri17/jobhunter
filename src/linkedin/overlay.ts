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
    if ((await firstVisibleIndex(locator)) >= 0) {
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
 *
 * After the first pass, each undismissed overlay gets exactly one
 * bounded retry: an overlay can be unclickable only because another
 * overlay's backdrop still covers it (e.g. the cookie banner sits
 * under the sign-in modal's dimming layer), and that blocker may have
 * been dismissed later in the same pass.
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
  for (const descriptor of [...undismissed]) {
    const result = await dismissOverlay(page, descriptor, opts);
    if (result.kind !== 'dismissed') continue;
    dismissed.push(descriptor);
    undismissed.splice(undismissed.indexOf(descriptor), 1);
  }
  return { dismissed, undismissed };
}

/**
 * Apply a single dismissal strategy. Returns `true` if the action was
 * attempted and landed (callers follow up with a `waitFor` to confirm
 * the overlay actually hid). Every click is bounded by
 * `overlayDismissalMs` — Playwright treats `timeout: 0` as *no
 * timeout*, so an unbounded click on a present-but-hidden node waits
 * forever (the discovery-hang root cause). Only VISIBLE matches are
 * clicked: LinkedIn keeps hidden placeholder overlays (e.g. unused
 * `button[aria-label="Dismiss"]` instances) in the DOM, and the first
 * DOM-order match is routinely one of those.
 */
async function applyStrategy(
  page: Page,
  locator: Locator,
  strategy: OverlayDismissalStrategy,
  overlayDismissalMs: number,
): Promise<boolean> {
  switch (strategy) {
    case 'close': {
      const closeButton = page.locator(LINKEDIN_SELECTORS.overlays.closeButton);
      const visibleClose = await firstVisibleIndex(closeButton);
      if (visibleClose >= 0) {
        return boundedClick(closeButton.nth(visibleClose), overlayDismissalMs);
      }
      return clickFirstVisible(locator, overlayDismissalMs);
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
      return clickActionButton(locator, 'ACCEPT', overlayDismissalMs);
    case 'reject':
      return clickActionButton(locator, 'REJECT', overlayDismissalMs);
  }
}

/**
 * Index of the first currently-visible match for `locator`, or -1 when
 * every match (or the selector itself) is absent or hidden.
 */
async function firstVisibleIndex(locator: Locator): Promise<number> {
  const total = await locator.count();
  for (let i = 0; i < total; i += 1) {
    if (await locator.nth(i).isVisible()) return i;
  }
  return -1;
}

/** Click `locator`'s first visible match, bounded by `timeoutMs`. */
async function clickFirstVisible(locator: Locator, timeoutMs: number): Promise<boolean> {
  const index = await firstVisibleIndex(locator);
  if (index < 0) return false;
  return boundedClick(locator.nth(index), timeoutMs);
}

/**
 * Click the banner's `button[action-type="ACCEPT"|"REJECT"]` inside the
 * overlay, falling back to the overlay's own visible match. Clicking
 * the container itself risks landing on a link (e.g. the Cookie Policy
 * href) instead of the decision button.
 */
async function clickActionButton(
  overlay: Locator,
  actionType: 'ACCEPT' | 'REJECT',
  timeoutMs: number,
): Promise<boolean> {
  const actionButton = overlay.locator(`button[action-type="${actionType}"]`);
  const index = await firstVisibleIndex(actionButton);
  if (index >= 0) {
    return boundedClick(actionButton.nth(index), timeoutMs);
  }
  return clickFirstVisible(overlay, timeoutMs);
}

/** Bounded click: a failed/timed-out click is `false`, never a throw or a hang. */
async function boundedClick(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
