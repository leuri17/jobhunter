import { test, expect } from '@playwright/test';

test('renders the Jobs heading', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
});

test('state filter chip narrows the row count via GET /api/jobs', async ({ page }) => {
  const jobsRequests: { state: string | null }[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/jobs')) {
      const state = new URL(req.url()).searchParams.get('state');
      jobsRequests.push({ state });
    }
  });

  // Register the wait BEFORE goto so the initial GET isn't missed.
  const initialJobsResponse = page.waitForResponse(
    (r) => r.url().includes('/api/jobs') && r.url().includes('state=scored'),
  );
  await page.goto('/jobs');
  await initialJobsResponse;

  // Default filter is `scored`; the fixture seeds 3 scored jobs.
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await expect(page.getByText('Staff Backend Engineer')).toBeVisible();
  await expect(page.getByText('Principal SRE')).toBeHidden();
  const scoredRows = await page.locator('tbody tr').count();
  expect(scoredRows).toBeGreaterThan(1);

  // Click the `accepted` chip. Fixture seeds 1 accepted job.
  const acceptedResponse = page.waitForResponse(
    (r) => r.url().includes('/api/jobs') && r.url().includes('state=accepted'),
  );
  await page.getByRole('button', { name: 'accepted', exact: true }).click();
  await acceptedResponse;

  await expect(page.getByText('Principal SRE')).toBeVisible();
  await expect(page.getByText('Staff Backend Engineer')).toBeHidden();
  const acceptedRows = await page.locator('tbody tr').count();
  expect(acceptedRows).toBeLessThan(scoredRows);
  expect(jobsRequests.some((r) => r.state === 'accepted')).toBe(true);
});