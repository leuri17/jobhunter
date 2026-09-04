import { test, expect } from '@playwright/test';

test.describe('sidecar fallback banner (issue #31)', () => {
  test('shows a blocking banner when no sidecar is listening on the fallback port', async ({
    page,
  }) => {
    // The Playwright webServer runs `pnpm dev` (Vite) without a Tauri shell,
    // so `invoke('sidecar_port')` rejects, `VITE_SIDECAR_PORT` is unset, and
    // the resolver lands on the last-resort default (14231). With no
    // sidecar bound to 14231, the banner must appear within ~2 s.
    await page.goto('/');
    const banner = page.getByTestId('sidecar-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/Couldn't reach the sidecar/i);
    await expect(banner).toContainText('14231');
  });

  test('Retry button is present and clickable', async ({ page }) => {
    await page.goto('/');
    const retry = page.getByTestId('sidecar-banner-retry');
    await expect(retry).toBeVisible({ timeout: 5_000 });
    await retry.click();
    // After clicking, the banner should still be visible because the sidecar
    // is still down — but the click should not throw.
    await expect(retry).toBeVisible();
  });
});
