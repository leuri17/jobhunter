import { test, expect } from '@playwright/test';

test.describe('sidecar fallback banner (issue #31)', () => {
  test('does not show a blocking banner when the resolver returns a high-confidence URL', async ({
    page,
  }) => {
    // With the fixture sidecar booted by playwright.config.ts and
    // VITE_SIDECAR_PORT=14231, `resolveSidecar()` lands on the
    // env-override branch and returns a non-fallback URL. The banner
    // is fallback-specific (see sidecar-banner.tsx), so it must stay
    // hidden even though no Tauri webview is running.
    await page.goto('/');
    const banner = page.getByTestId('sidecar-banner');
    await expect(banner).toBeHidden({ timeout: 5_000 });
  });

  test('the StatusPill reports sidecar connected on port 14231', async ({ page }) => {
    // The pill refetches every 5 s. Wait for the connected state
    // (rather than asserting it on first render, which races the
    // first /api/health roundtrip).
    await page.goto('/');
    await expect(page.getByText(/sidecar connected/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sidecar offline/i)).toBeHidden();
  });

  test('the resolver sends traffic to the fixture sidecar on port 14231', async ({ page }) => {
    // Belt-and-braces assertion: confirm a real request reaches the
    // fixture on the expected port rather than just the Vite proxy
    // default. The first /api/health probe is enough.
    const healthRequest = page.waitForRequest(
      (req) => req.url() === 'http://127.0.0.1:14231/api/health',
    );
    await page.goto('/');
    const req = await healthRequest;
    expect(req.url()).toBe('http://127.0.0.1:14231/api/health');
  });
});