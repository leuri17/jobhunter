import { test, expect } from '@playwright/test';

test('renders the Pipeline heading and the Run pipeline button', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: /run pipeline/i })).toBeVisible();
});

test('driving a start-run mutation streams log lines via SSE', async ({ page }) => {
  const pipelineRequests: { method: string; url: string }[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/pipeline')) {
      pipelineRequests.push({ method: req.method(), url: req.url() });
    }
  });

  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();

  const startButton = page.getByRole('button', { name: /run pipeline/i });
  await expect(startButton).toBeEnabled();

  // Register both waiters BEFORE the click — the POST and the SSE
  // GET race, and the response listener needs to be live before the
  // fetch is initiated.
  const runResponse = page.waitForResponse(/\/api\/pipeline\/run\b/);
  const eventsResponse = page.waitForResponse(/\/api\/pipeline\/[^/]+\/events$/);
  await startButton.click();
  await runResponse;
  await eventsResponse;

  // Status flips to running once the SSE 'heartbeat' arrives.
  await expect(page.getByText(/status: running/i)).toBeVisible({ timeout: 10_000 });

  // Cancel becomes enabled while running; Start is disabled.
  await expect(page.getByRole('button', { name: /cancel/i })).toBeEnabled();
  await expect(startButton).toBeDisabled();

  // At least one log line lands in <LogPane/> before the terminal event.
  // The fixture emits `[info] pipeline tick N` strings.
  await expect(page.locator('text=/\\[info\\] pipeline tick/').first()).toBeVisible({
    timeout: 10_000,
  });

  // Wait for the fixture's terminal transition (1.5 s in fixture).
  await expect(page.getByText(/status: done/i)).toBeVisible({ timeout: 10_000 });

  expect(
    pipelineRequests.some((r) => r.method === 'POST' && r.url.endsWith('/api/pipeline/run')),
  ).toBe(true);
  expect(
    pipelineRequests.some(
      (r) => r.method === 'GET' && /\/api\/pipeline\/[^/]+\/events$/.test(r.url),
    ),
  ).toBe(true);
});