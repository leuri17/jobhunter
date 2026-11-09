import { test, expect } from '@playwright/test';

test('renders the mission-control sections', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: /run pipeline/i })).toBeVisible();

  // Prerequisites banner resolved from /api/pipeline/prerequisites.
  await expect(page.getByText('All gates clear')).toBeVisible({ timeout: 10_000 });

  // Stage strip, search matrix, and scoring plan sections.
  await expect(page.getByRole('heading', { name: 'Run stages' })).toBeVisible();
  await expect(page.getByText('Search matrix', { exact: true })).toBeVisible();
  await expect(page.getByText('Scoring plan', { exact: true })).toBeVisible();
  // The seeded cross product renders a row.
  await expect(page.getByText('Frontend developer', { exact: true })).toBeVisible();
});

test('driving a start-run mutation streams progress, logs, and a summary', async ({ page }) => {
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

  // Status pill flips to Running once the SSE stream opens.
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });

  // Cancel becomes enabled while running; Start is disabled.
  await expect(page.getByRole('button', { name: /cancel/i })).toBeEnabled();
  await expect(startButton).toBeDisabled();

  // At least one log line lands in <LogPane/> before the terminal event.
  // The fixture emits `[info] pipeline tick N` strings.
  await expect(page.locator('text=/\\[info\\] pipeline tick/').first()).toBeVisible({
    timeout: 10_000,
  });

  // The run_summary payload renders the summary card; the pill flips
  // to Completed. (Both texts can coexist — take the first match.)
  await expect(page.getByTestId('run-summary')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });

  expect(
    pipelineRequests.some((r) => r.method === 'POST' && r.url.endsWith('/api/pipeline/run')),
  ).toBe(true);
  expect(
    pipelineRequests.some(
      (r) => r.method === 'GET' && /\/api\/pipeline\/[^/]+\/events$/.test(r.url),
    ),
  ).toBe(true);
});
