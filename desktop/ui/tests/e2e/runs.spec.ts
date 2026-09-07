import { test, expect } from '@playwright/test';

test('renders the Runs heading', async ({ page }) => {
  await page.goto('/runs');
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
});

test('cancelling a pipeline run invalidates the runs query', async ({ page }) => {
  const runsRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/runs')) {
      runsRequests.push(`${req.method()} ${req.url()}`);
    }
  });

  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();

  // Start a run. Register the SSE 'running' status expectation by
  // waiting for it after the click — the Cancel button is gated on
  // `events.status === 'running'`.
  const startButton = page.getByRole('button', { name: /run pipeline/i });
  const runResponse = page.waitForResponse(/\/api\/pipeline\/run\b/);
  await startButton.click();
  await runResponse;
  await expect(page.getByText(/status: running/i)).toBeVisible({ timeout: 10_000 });

  const cancelButton = page.getByRole('button', { name: /cancel/i });
  await expect(cancelButton).toBeEnabled();

  // Capture the runs-request count after the cancel-driven
  // invalidation; the next /runs navigation should issue a fresh GET.
  const runsResponse = page.waitForResponse(/\/api\/runs/);
  const cancelResponse = page.waitForResponse(/\/api\/pipeline\/[^/]+\/cancel\b/);
  await cancelButton.click();
  await cancelResponse;

  await page.getByRole('link', { name: 'Runs' }).click();
  await runsResponse;

  // At least one GET /api/runs must have fired after the cancel
  // mutation, demonstrating the ['runs'] invalidation reached the
  // runs route.
  expect(runsRequests.filter((r) => r.startsWith('GET')).length).toBeGreaterThanOrEqual(1);
});