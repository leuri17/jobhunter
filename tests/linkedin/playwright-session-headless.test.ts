import { describe, expect, it } from 'vitest';
import type { Browser, BrowserContext } from 'playwright';

import { PlaywrightBrowserSession } from '../../src/linkedin/playwright-session.js';
import { noopLinkedInScraperLogger } from '../../src/linkedin/log.js';

const TIMEOUT_CONFIG = {
  navigationMs: 30_000,
  initialResultsMs: 20_000,
  overlayDismissalMs: 5_000,
} as const;

function makeChromiumStub(launchCalls: Array<{ headless: boolean }>): {
  launch: (options: { headless: boolean }) => Promise<Browser>;
} {
  const context = {
    newPage: async () => {
      throw new Error('not needed for launch assertions');
    },
    close: async () => undefined,
    route: async () => undefined,
    unrouteAll: async () => undefined,
  } as unknown as BrowserContext;
  const browser = {
    newContext: async () => context,
    close: async () => undefined,
  } as unknown as Browser;
  return {
    launch: async (options: { headless: boolean }) => {
      launchCalls.push(options);
      return browser;
    },
  };
}

describe('PlaywrightBrowserSession headless mode', () => {
  it('launches headless by default when no headless option is given', async () => {
    const launchCalls: Array<{ headless: boolean }> = [];
    const session = new PlaywrightBrowserSession({
      config: TIMEOUT_CONFIG,
      logger: noopLinkedInScraperLogger,
      chromium: makeChromiumStub(launchCalls),
    });

    await session.launch();

    expect(launchCalls).toEqual([{ headless: true }]);
    await session.close();
  });

  it('launches headful when config.headless is false', async () => {
    const launchCalls: Array<{ headless: boolean }> = [];
    const session = new PlaywrightBrowserSession({
      config: { ...TIMEOUT_CONFIG, headless: false },
      logger: noopLinkedInScraperLogger,
      chromium: makeChromiumStub(launchCalls),
    });

    await session.launch();

    expect(launchCalls).toEqual([{ headless: false }]);
    await session.close();
  });
});
