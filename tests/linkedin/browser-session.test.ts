import { describe, expect, it } from 'vitest';

import { FakeBrowserSession } from '../../src/linkedin/fake-session.js';
import { FakePage } from '../../src/linkedin/fake-page.js';
import { BrowserCapacityExceededError } from '../../src/linkedin/errors.js';

describe('src/linkedin/fake-session — Wave B', () => {
  it('launch() records the launch event + returns a stub browser/context', async () => {
    const session = new FakeBrowserSession();
    const { browser, context } = await session.launch();
    expect(browser).toBeDefined();
    expect(context).toBeDefined();
    expect(session.eventLog).toEqual([{ kind: 'launch' }]);
    expect(session.activePageCount).toBe(0);
    expect(session.activeFallbackCount).toBe(0);
  });

  it('openPage(url) increments activePageCount and records the event', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const page = await session.openPage('https://www.linkedin.com/jobs/search/?q=engineer');
    expect(page).toBeInstanceOf(FakePage);
    expect(session.activePageCount).toBe(1);
    expect(session.eventLog).toEqual([
      { kind: 'launch' },
      {
        kind: 'openPage',
        url: 'https://www.linkedin.com/jobs/search/?q=engineer',
        page: page as unknown as FakePage,
      },
    ]);
  });

  it('closePage() decrements activePageCount and removes the page from the map', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const page = await session.openPage('https://www.linkedin.com/jobs/search/?q=engineer');
    await session.closePage(page);
    expect(session.activePageCount).toBe(0);
    const closeEvent = session.eventLog.find((e) => e.kind === 'closePage');
    expect(closeEvent).toBeDefined();
  });

  it('closePage() on a page not opened by this session is a safe no-op', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const foreignPage = new FakePage();
    await expect(session.closePage(foreignPage as never)).resolves.toBeUndefined();
    // The event log records the close attempt (it does not crash on
    // an unknown page) but the activePageCount stays at 0.
    expect(session.activePageCount).toBe(0);
  });

  it('openPage() throws if launch() was not called first', async () => {
    const session = new FakeBrowserSession();
    await expect(
      session.openPage('https://www.linkedin.com/jobs/search/?q=engineer'),
    ).rejects.toThrow(/before launch/);
  });

  it('openFallbackPage() succeeds the first time and increments activeFallbackCount', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const page = await session.openFallbackPage('https://www.linkedin.com/jobs/view/123456/');
    expect(page).toBeInstanceOf(FakePage);
    expect(session.activePageCount).toBe(1);
    expect(session.activeFallbackCount).toBe(1);
  });

  it('openFallbackPage() throws BrowserCapacityExceededError on the second concurrent call', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    await session.openFallbackPage('https://www.linkedin.com/jobs/view/111111/');
    await expect(
      session.openFallbackPage('https://www.linkedin.com/jobs/view/222222/'),
    ).rejects.toBeInstanceOf(BrowserCapacityExceededError);
    expect(session.activeFallbackCount).toBe(1);
  });

  it('closeFallbackPage() decrements activeFallbackCount', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const page = await session.openFallbackPage('https://www.linkedin.com/jobs/view/123456/');
    await session.closeFallbackPage(page);
    expect(session.activeFallbackCount).toBe(0);
    expect(session.activePageCount).toBe(0);
  });

  it('after closeFallbackPage(), openFallbackPage() succeeds again', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const first = await session.openFallbackPage('https://www.linkedin.com/jobs/view/111111/');
    await session.closeFallbackPage(first);
    const second = await session.openFallbackPage('https://www.linkedin.com/jobs/view/222222/');
    expect(second).toBeInstanceOf(FakePage);
    expect(session.activeFallbackCount).toBe(1);
  });

  it('withRoute() + unrouteAll() record the call sequence', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    const handler = async () => undefined;
    await session.withRoute('**/jobs/search**', handler);
    await session.withRoute(/\/jobs\/view\/\d+/, handler);
    expect(session.routeRecords).toHaveLength(2);
    expect(session.routeRecords[0]?.pattern).toBe('**/jobs/search**');
    expect(session.routeRecords[1]?.pattern).toEqual(/\/jobs\/view\/\d+/);
    const withRouteEvents = session.eventLog.filter((e) => e.kind === 'withRoute');
    expect(withRouteEvents).toHaveLength(2);
    await session.unrouteAll();
    expect(session.routeRecords).toHaveLength(0);
    const unrouteAllEvents = session.eventLog.filter((e) => e.kind === 'unrouteAll');
    expect(unrouteAllEvents).toHaveLength(1);
  });

  it('withRoute() throws if launch() was not called first', async () => {
    const session = new FakeBrowserSession();
    await expect(session.withRoute('**', async () => undefined)).rejects.toThrow(/before launch/);
  });

  it('close() is idempotent and clears all open pages', async () => {
    const session = new FakeBrowserSession();
    await session.launch();
    await session.openPage('https://www.linkedin.com/jobs/search/?q=engineer');
    await session.openPage('https://www.linkedin.com/jobs/search/?q=designer');
    expect(session.activePageCount).toBe(2);
    await session.close();
    expect(session.activePageCount).toBe(0);
    // A second close is a no-op (records the event but does nothing).
    await session.close();
    const closeEvents = session.eventLog.filter((e) => e.kind === 'close');
    expect(closeEvents).toHaveLength(2);
  });

  it('createPage factory hook is called once per openPage/openFallbackPage', async () => {
    const calls: Array<{ url: string; method: 'openPage' | 'openFallbackPage' }> = [];
    const session = new FakeBrowserSession({
      createPage: (_s, url) => {
        calls.push({ url, method: 'openPage' });
        return new FakePage();
      },
    });
    await session.launch();
    await session.openPage('https://www.linkedin.com/jobs/search/?q=engineer');
    await session.openFallbackPage('https://www.linkedin.com/jobs/view/123456/');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('/jobs/search/');
    expect(calls[1]?.url).toContain('/jobs/view/');
  });
});

describe('src/linkedin/fake-page — Wave B', () => {
  it('default url() returns "about:blank"', () => {
    const page = new FakePage();
    expect(page.url()).toBe('about:blank');
    expect(page.isClosed()).toBe(false);
  });

  it('setUrl updates the URL reported by url()', () => {
    const page = new FakePage();
    page.setUrl('https://www.linkedin.com/jobs/search/?q=engineer');
    expect(page.url()).toBe('https://www.linkedin.com/jobs/search/?q=engineer');
  });

  it('close() is idempotent and invokes onClose exactly once', async () => {
    let closeCount = 0;
    const page = new FakePage({
      onClose: () => {
        closeCount += 1;
      },
    });
    await page.close();
    expect(page.isClosed()).toBe(true);
    await page.close();
    expect(page.isClosed()).toBe(true);
    expect(closeCount).toBe(1);
  });

  it('elementHandle() returns getAttribute + querySelector that delegate to the hook', async () => {
    const anchor = {
      getAttribute: (name: string) => (name === 'data-occludable-job-id' ? '999999' : null),
      querySelector: () => null,
    };
    const page = new FakePage({
      onGetAttribute: (name) => (name === 'href' ? '/jobs/view/999999/' : null),
      onQuerySelector: () => anchor,
    });
    const handle = await page.elementHandle();
    expect(handle.getAttribute('href')).toBe('/jobs/view/999999/');
    expect(handle.getAttribute('data-occludable-job-id')).toBeNull();
    const inner = handle.querySelector('a');
    expect(inner).toBe(anchor);
  });

  it('elementHandle() defaults to null attribute + null querySelector', async () => {
    const page = new FakePage();
    const handle = await page.elementHandle();
    expect(handle.getAttribute('anything')).toBeNull();
    expect(handle.querySelector('anything')).toBeNull();
  });
});
