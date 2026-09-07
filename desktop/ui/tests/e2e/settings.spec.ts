import { test, expect } from '@playwright/test';

test('renders the Settings heading', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('PATCH /api/config propagates to the next refetch of the config query', async ({ page }) => {
  const configRequests: { method: string; url: string }[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/config') && !url.includes('/validate')) {
      configRequests.push({ method: req.method(), url });
    }
  });

  // Register the GET listener BEFORE navigation so the initial fetch
  // isn't missed. The settings page issues exactly one GET on mount.
  const initialConfigGet = page.waitForResponse(
    (r) => r.url().includes('/api/config') && r.request().method() === 'GET',
  );
  await page.goto('/settings');
  await initialConfigGet;
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const marker = `marker-${Date.now()}`;
  // Drive the PATCH from the browser context. The fixture deep-merges
  // the patch into the seeded config so the next GET observes it.
  const patchResponse = await page.evaluate(async (m) => {
    const res = await fetch('http://127.0.0.1:14231/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { search: { searchQueries: [m] } } }),
    });
    return { status: res.status, body: await res.json() };
  }, marker);
  expect(patchResponse.status).toBe(200);

  // The settings page doesn't auto-invalidate today; navigate away
  // and back to force a fresh GET. A real config form will eventually
  // invalidate on success — this assertion verifies the mutation
  // reaches the server and the refetch observes it.
  const refetchedConfigGet = page.waitForResponse(
    (r) => r.url().includes('/api/config') && r.request().method() === 'GET',
  );
  await page.goto('/');
  await page.waitForResponse(/\/api\/runs/);
  await page.goto('/settings');
  await refetchedConfigGet;

  await expect(page.locator('pre').first()).toContainText(marker);

  expect(configRequests.some((r) => r.method === 'PATCH')).toBe(true);
  expect(configRequests.filter((r) => r.method === 'GET').length).toBeGreaterThanOrEqual(2);
});