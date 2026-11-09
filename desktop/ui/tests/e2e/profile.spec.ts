import { test, expect } from '@playwright/test';

test('renders the Profile page with its six tabs', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  for (const tab of [
    'Overview',
    'Experience',
    'Skills',
    'Education',
    'Conflicts',
    'Version history',
  ]) {
    await expect(page.getByRole('tab', { name: new RegExp(tab, 'i') })).toBeVisible();
  }
});

test('approving a draft from version history invalidates the profiles query and refreshes related queries', async ({
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

  await page.getByRole('tab', { name: /version history/i }).click();

  // The seeded drafts render Approve actions; wait for the first enabled
  // one so TanStack Query's post-response state update has landed.
  const approveButton = page.getByRole('button', { name: /^approve$/i }).first();
  await expect(approveButton).toBeEnabled({ timeout: 5_000 });

  const approveResponse = page.waitForResponse(/\/api\/profile\/[^/]+\/approve\b/);
  await approveButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Approve & publish' }).click();
  await approveResponse;

  // Wait for the invalidation-driven refetch on /api/profile (list).
  const profileGetsBefore = profileGets.length;
  await expect
    .poll(() => profileGets.length, { timeout: 5_000 })
    .toBeGreaterThan(profileGetsBefore);

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

test('rejecting a draft from version history invalidates the profiles query', async ({ page }) => {
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

  await page.getByRole('tab', { name: /version history/i }).click();

  // Use the last seeded draft so the approve test's state mutation
  // doesn't gate this one — the fixture state is shared across tests
  // in the same playwright run.
  const rejectButton = page.getByRole('button', { name: /^reject$/i }).last();
  await expect(rejectButton).toBeEnabled({ timeout: 5_000 });

  const profileGetsBefore = profileGets.length;
  const rejectResponse = page.waitForResponse(/\/api\/profile\/[^/]+\/reject\b/);
  await rejectButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reject draft' }).click();
  await rejectResponse;

  await expect
    .poll(() => profileGets.length, { timeout: 5_000 })
    .toBeGreaterThan(profileGetsBefore);
});
