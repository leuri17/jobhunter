import { describe, expect, it } from 'vitest';

import type { Page, Locator } from 'playwright';

import { LINKEDIN_SELECTORS } from '../../src/linkedin/selectors.js';
import {
  detectOverlays,
  dismissOverlay,
  dismissRecoverableOverlays,
  type OverlayDetectionOptions,
} from '../../src/linkedin/overlay.js';
import type { OverlayDescriptor } from '../../src/linkedin/state.js';

/**
 * Inline fake `Page` for . The  `BrowserSession` will
 * provide a real Playwright `Page`;  uses this fake so the
 * detector + dismisser can be exercised without launching Chromium.
 */
interface LocatorCall {
  readonly selector: string;
  readonly count?: number;
  readonly hidden?: boolean;
  readonly clickThrows?: boolean;
}

interface FakeLocatorState {
  readonly selector: string;
  count: number;
  hiddenAfter: number | null;
  clickShouldThrow: boolean;
  /**
   * Which match indices are visible. `null` means every match below
   * `count` is visible (the pre-visibility fake's semantics, kept so
   * the original tests pass unchanged). Mirrors Playwright's
   * `locator.nth(i).isVisible()`.
   */
  visibleIndices: ReadonlySet<number> | null;
  /**
   * Conditional click failure — models "this click is blocked while
   * another overlay covers it" (e.g. a modal backdrop intercepting
   * pointer events). Checked before the dismissal effect applies.
   */
  clickThrowsWhile?: () => boolean;
}

interface ClickRecord {
  readonly selector: string;
  readonly index: number | null;
  readonly timeout: number | undefined;
}

class FakePage {
  public readonly locatorCalls: LocatorCall[] = [];
  public readonly states: FakeLocatorState[] = [];
  public clickCalls = 0;
  public readonly clickLog: ClickRecord[] = [];

  setState(
    selector: string,
    count: number,
    hiddenAfterMs: number | null = null,
    clickShouldThrow = false,
    clickThrowsWhile?: () => boolean,
  ): void {
    this.states.push({
      selector,
      count,
      hiddenAfter: hiddenAfterMs,
      clickShouldThrow,
      visibleIndices: null,
      ...(clickThrowsWhile !== undefined ? { clickThrowsWhile } : {}),
    });
  }

  /** Mark exactly which match indices of a selector are visible. */
  setVisible(selector: string, indices: readonly number[]): void {
    const state = this.states.find((s) => s.selector === selector);
    if (state !== undefined) state.visibleIndices = new Set(indices);
  }

  private stateFor(selector: string): FakeLocatorState {
    return (
      this.states.find((s) => s.selector === selector) ?? {
        selector,
        count: 0,
        hiddenAfter: null,
        clickShouldThrow: false,
        visibleIndices: null,
      }
    );
  }

  /**
   * A successful dismiss click hides the clicked node and — when the
   * click landed on a descendant (e.g. the banner's ACCEPT button) —
   * the ancestor overlay container that hosts it.
   */
  private applyDismissalEffect(state: FakeLocatorState): void {
    if (state.hiddenAfter === null) return;
    state.count = 0;
    for (const other of this.states) {
      if (state.selector.startsWith(`${other.selector} `)) other.count = 0;
    }
  }

  locator = (selector: string): Locator => this.makeLocator(selector, null);

  private makeLocator(selector: string, index: number | null): Locator {
    const state = this.stateFor(selector);
    const click = async (opts?: { timeout?: number }): Promise<void> => {
      this.clickLog.push({ selector, index, timeout: opts?.timeout });
      this.clickCalls += 1;
      if (state.clickShouldThrow || state.clickThrowsWhile?.() === true) {
        throw new Error('click failed');
      }
      this.applyDismissalEffect(state);
    };
    return {
      count: async () => {
        this.locatorCalls.push({ selector, count: state.count });
        return state.count;
      },
      first: () => this.makeLocator(selector, 0),
      nth: (i: number) => this.makeLocator(selector, i),
      isVisible: async () => {
        if (index === null) return state.count > 0;
        if (index >= state.count) return false;
        return state.visibleIndices?.has(index) ?? true;
      },
      click,
      waitFor: async (opts: { state: string; timeout: number }): Promise<void> => {
        if (opts.state === 'hidden' && state.count === 0) return;
        throw new Error('waitFor: not hidden');
      },
      locator: (childSelector: string) => this.makeLocator(`${selector} ${childSelector}`, index),
      // Pass-through methods we don't exercise in .
      elementHandle: async () => null,
      all: async () => [],
    } as unknown as Locator;
  }

  keyboard = {
    press: async (key: string): Promise<void> => {
      // Escape dismisses any visible overlay — mirrors the real
      // LinkedIn renderer behaviour where Escape triggers the
      // overlay's close button.
      if (key === 'Escape') {
        for (const state of this.states) {
          if (state.count > 0) state.count = 0;
        }
      }
    },
  } as Page['keyboard'];

  mouse = {
    click: async (x: number, y: number): Promise<void> => {
      void x;
      void y;
    },
  } as Page['mouse'];
}

const OPTS: OverlayDetectionOptions = { overlayDismissalMs: 5_000 };

describe('src/linkedin/overlay — ', () => {
  it('detectOverlays returns an empty array when no overlays are visible', async () => {
    const page = new FakePage();
    const descriptors = await detectOverlays(page as unknown as Page, OPTS);
    expect(descriptors).toEqual([]);
  });

  it('detectOverlays returns one descriptor when loginModal is visible', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1);
    const descriptors = await detectOverlays(page as unknown as Page, OPTS);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.selector).toBe(LINKEDIN_SELECTORS.overlays.loginModal);
    expect(descriptors[0]?.strategy).toBe('close');
    expect(descriptors[0]?.label).toBe('LinkedIn login modal');
  });

  it('detectOverlays returns multiple descriptors ordered topmost-first', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1);
    page.setState(LINKEDIN_SELECTORS.overlays.cookieConsent, 1);
    const descriptors = await detectOverlays(page as unknown as Page, OPTS);
    expect(descriptors.map((d) => d.selector)).toEqual([
      LINKEDIN_SELECTORS.overlays.loginModal,
      LINKEDIN_SELECTORS.overlays.cookieConsent,
    ]);
  });

  it('detectOverlays is read-only (no clicks dispatched)', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1);
    await detectOverlays(page as unknown as Page, OPTS);
    expect(page.clickCalls).toBe(0);
  });

  it('dismissOverlay returns dismissed when the overlay hides after click', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1, 0);
    const descriptor: OverlayDescriptor = {
      selector: LINKEDIN_SELECTORS.overlays.loginModal,
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('dismissed');
    expect(result.selector).toBe(LINKEDIN_SELECTORS.overlays.loginModal);
    expect(page.clickCalls).toBe(1);
  });

  it('dismissOverlay returns undismissable when the overlay stays visible', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1, null);
    const descriptor: OverlayDescriptor = {
      selector: LINKEDIN_SELECTORS.overlays.loginModal,
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('undismissable');
    if (result.kind === 'undismissable') {
      expect(result.selector).toBe(LINKEDIN_SELECTORS.overlays.loginModal);
      expect(result.reason).toContain('overlay still visible');
    }
  });

  it('dismissOverlay applies the escape strategy', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.genericModal, 1, 0);
    const descriptor: OverlayDescriptor = {
      selector: LINKEDIN_SELECTORS.overlays.genericModal,
      strategy: 'escape',
      label: 'Generic LinkedIn modal',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('dismissed');
  });

  it('dismissOverlay applies the accept strategy for cookie consent', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.cookieConsent, 1, 0);
    const descriptor: OverlayDescriptor = {
      selector: LINKEDIN_SELECTORS.overlays.cookieConsent,
      strategy: 'accept',
      label: 'Cookie consent banner',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('dismissed');
  });

  it('dismissRecoverableOverlays splits dismissed + undismissed correctly', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 1, 0);
    page.setState(LINKEDIN_SELECTORS.overlays.cookieConsent, 1, null);
    const { dismissed, undismissed } = await dismissRecoverableOverlays(
      page as unknown as Page,
      OPTS,
    );
    expect(dismissed.map((d) => d.selector)).toEqual([LINKEDIN_SELECTORS.overlays.loginModal]);
    expect(undismissed.map((d) => d.selector)).toEqual([LINKEDIN_SELECTORS.overlays.cookieConsent]);
  });

  // Regression tests for the discovery hang: LinkedIn's guest pages keep
  // hidden placeholder overlays (e.g. 5 of 6 `button[aria-label="Dismiss"]`
  // matches are invisible) in the DOM. Presence-based detection plus
  // `.first()` clicks with `timeout: 0` (infinite in Playwright) made
  // dismissRecoverableOverlays wait forever on a non-actionable node.

  it('detectOverlays ignores overlays whose matched nodes are all hidden', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 2);
    page.setVisible(LINKEDIN_SELECTORS.overlays.loginModal, []);
    const descriptors = await detectOverlays(page as unknown as Page, OPTS);
    expect(descriptors).toEqual([]);
  });

  it('detectOverlays reports an overlay when at least one match is visible', async () => {
    const page = new FakePage();
    page.setState(LINKEDIN_SELECTORS.overlays.loginModal, 3);
    page.setVisible(LINKEDIN_SELECTORS.overlays.loginModal, [1]);
    const descriptors = await detectOverlays(page as unknown as Page, OPTS);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.selector).toBe(LINKEDIN_SELECTORS.overlays.loginModal);
  });

  it('close strategy clicks the first VISIBLE dismiss button, bounded by overlayDismissalMs', async () => {
    const page = new FakePage();
    const modal = LINKEDIN_SELECTORS.overlays.loginModal;
    const closeButton = LINKEDIN_SELECTORS.overlays.closeButton;
    page.setState(modal, 1, 0);
    page.setState(closeButton, 3, 0);
    page.setVisible(closeButton, [2]);
    const descriptor: OverlayDescriptor = {
      selector: modal,
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(page.clickLog[0]).toEqual({ selector: closeButton, index: 2, timeout: 5_000 });
  });

  it('close strategy falls back to the visible overlay node when no dismiss button is visible', async () => {
    const page = new FakePage();
    const modal = LINKEDIN_SELECTORS.overlays.loginModal;
    const closeButton = LINKEDIN_SELECTORS.overlays.closeButton;
    page.setState(modal, 1, 0);
    page.setState(closeButton, 2, null);
    page.setVisible(closeButton, []);
    const descriptor: OverlayDescriptor = {
      selector: modal,
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('dismissed');
    expect(page.clickLog[0]).toEqual({ selector: modal, index: 0, timeout: 5_000 });
  });

  it('returns undismissable instead of hanging when the visible dismiss button is not clickable', async () => {
    const page = new FakePage();
    const modal = LINKEDIN_SELECTORS.overlays.loginModal;
    const closeButton = LINKEDIN_SELECTORS.overlays.closeButton;
    page.setState(modal, 1, null);
    page.setState(closeButton, 1, null, true);
    const descriptor: OverlayDescriptor = {
      selector: modal,
      strategy: 'close',
      label: 'LinkedIn login modal',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('undismissable');
  });

  it('accept strategy clicks the banner ACCEPT button, not the container', async () => {
    const page = new FakePage();
    const banner = LINKEDIN_SELECTORS.overlays.cookieConsent;
    const acceptButton = `${banner} button[action-type="ACCEPT"]`;
    page.setState(banner, 1, 0);
    page.setState(acceptButton, 1, 0);
    const descriptor: OverlayDescriptor = {
      selector: banner,
      strategy: 'accept',
      label: 'Cookie consent banner',
    };
    const result = await dismissOverlay(page as unknown as Page, descriptor, OPTS);
    expect(result.kind).toBe('dismissed');
    expect(page.clickLog).toEqual([{ selector: acceptButton, index: 0, timeout: 5_000 }]);
  });

  it('retries undismissed overlays once after a blocking overlay is dismissed', async () => {
    const page = new FakePage();
    const banner = LINKEDIN_SELECTORS.overlays.cookieConsent;
    const acceptButton = `${banner} button[action-type="ACCEPT"]`;
    const closeButton = LINKEDIN_SELECTORS.overlays.closeButton;
    // The banner's ACCEPT click is intercepted while the sign-in
    // modal's backdrop is up; the modal goes away once its X is
    // clicked (modeled by the close button disappearing).
    const modalStillUp = (): boolean =>
      (page.states.find((s) => s.selector === closeButton)?.count ?? 0) > 0;
    page.setState(banner, 1, 0);
    page.setState(acceptButton, 1, 0, false, modalStillUp);
    page.setState(closeButton, 1, 0);
    const { dismissed, undismissed } = await dismissRecoverableOverlays(
      page as unknown as Page,
      OPTS,
    );
    expect(dismissed.map((d) => d.label).sort()).toEqual([
      'Cookie consent banner',
      'Floating close button',
    ]);
    expect(undismissed).toEqual([]);
  });
});
