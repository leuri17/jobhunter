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
}

class FakePage {
  public readonly locatorCalls: LocatorCall[] = [];
  public readonly states: FakeLocatorState[] = [];
  public clickCalls = 0;

  setState(
    selector: string,
    count: number,
    hiddenAfterMs: number | null = null,
    clickShouldThrow = false,
  ): void {
    this.states.push({ selector, count, hiddenAfter: hiddenAfterMs, clickShouldThrow });
  }

  locator = (selector: string): Locator => {
    const state = this.states.find((s) => s.selector === selector) ?? {
      selector,
      count: 0,
      hiddenAfter: null,
      clickShouldThrow: false,
    };
    return {
      count: async () => {
        this.locatorCalls.push({ selector, count: state.count });
        return state.count;
      },
      first: () => {
        return this.locator(selector);
      },
      click: async (opts?: { timeout?: number }): Promise<void> => {
        void opts;
        this.clickCalls += 1;
        if (state.clickShouldThrow) {
          throw new Error('click failed');
        }
        if (state.hiddenAfter !== null) {
          state.count = 0;
        }
      },
      waitFor: async (opts: { state: string; timeout: number }): Promise<void> => {
        if (opts.state === 'hidden' && state.count === 0) return;
        throw new Error('waitFor: not hidden');
      },
      // Pass-through methods we don't exercise in .
      elementHandle: async () => null,
      all: async () => [],
    } as unknown as Locator;
  };

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
});
