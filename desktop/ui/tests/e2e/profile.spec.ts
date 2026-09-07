import { test, expect } from '@playwright/test';

test('renders the Profile versions heading', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile versions' })).toBeVisible();
});

test('approving a draft profile invalidates the profiles query and refreshes related queries', async ({
  page,
}) => {
  const profileGets: string[] = [];
  const jobsGets: string[] = [];
  const runsGets: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/profile') && !url.includes('/import') && req.method() === 'GET') {
      profileGets.push(url);
    }
    if (url.includes('/api/jobs') && req.method() === 'GET') {
      jobsGets.push(url);
    }
    if (url.includes('/api/runs') && req.method() === 'GET') {
      runsGets.push(url);
    }
  });

  const listResponse = page.waitForResponse(/\/api\/profile/);
  await page.goto('/profile');
  await listResponse;
  await expect(page.getByRole('heading', { name: 'Profile versions' })).toBeVisible();

  const profileGetsBefore = profileGets.length;

  // Open the draft profile by clicking the row whose font-mono span
  // matches its id (more specific than accessible-name matching
  // because the row also renders status text).
  const detailResponse = page.waitForResponse(/\/api\/profile\/prof_seed_1/);
  await page.locator('aside button').filter({ hasText: 'prof_seed_1' }).first().click();
  await detailResponse;

  // Wait for the detail to be visible — that confirms
  // detail.data.status === 'draft' and the Approve button is
  // enabled. Going straight to click() races TanStack Query's
  // state-update after the response arrives.
  const approveButton = page.getByRole('button', { name: /^approve$/i });
  await expect(approveButton).toBeEnabled({ timeout: 5_000 });

  const approveResponse = page.waitForResponse(/\/api\/profile\/[^/]+\/approve\b/);
  await approveButton.click();
  await approveResponse;

  // Wait for the invalidation-driven refetch on /api/profile (list).
  await expect.poll(() => profileGets.length, { timeout: 5_000 }).toBeGreaterThan(profileGetsBefore);

  // Cross-route invalidation cluster (issue #66): jobs + runs
  // queries are also invalidated. Mount each route and confirm a
  // fresh GET fires.
  const jobsBefore = jobsGets.length;
  const jobsResponse = page.waitForResponse(/\/api\/jobs/);
  await page.getByRole('link', { name: 'Jobs' }).click();
  await jobsResponse;
  expect(jobsGets.length).toBeGreaterThan(jobsBefore);

  const runsBefore = runsGets.length;
  const runsResponse = page.waitForResponse(/\/api\/runs/);
  await page.getByRole('link', { name: 'Runs' }).click();
  await runsResponse;
  expect(runsGets.length).toBeGreaterThan(runsBefore);
});

test('rejecting a draft profile invalidates the profiles query', async ({ page }) => {
  const profileGets: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/profile') && !url.includes('/import') && req.method() === 'GET') {
      profileGets.push(url);
    }
  });

  const listResponse = page.waitForResponse(/\/api\/profile/);
  await page.goto('/profile');
  await listResponse;
  await expect(page.getByRole('heading', { name: 'Profile versions' })).toBeVisible();

  // Use a separate draft (prof_seed_3) so the approve test's state
  // mutation doesn't gate this one — the fixture state is shared
  // across tests in the same playwright run.
  const detailResponse = page.waitForResponse(/\/api\/profile\/prof_seed_3/);
  await page.locator('aside button').filter({ hasText: 'prof_seed_3' }).first().click();
  await detailResponse;

  // Wait for the detail pane's status to render before clicking
  // — TanStack Query sets the data asynchronously after the response.
  const rejectButton = page.getByRole('button', { name: /^reject$/i });
  await expect(rejectButton).toBeEnabled({ timeout: 5_000 });

  const profileGetsBefore = profileGets.length;
  const rejectResponse = page.waitForResponse(/\/api\/profile\/[^/]+\/reject\b/);
  await rejectButton.click();
  await rejectResponse;

  await expect.poll(() => profileGets.length, { timeout: 5_000 }).toBeGreaterThan(profileGetsBefore);
});