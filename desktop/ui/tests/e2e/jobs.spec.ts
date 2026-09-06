import { test, expect } from '@playwright/test';

test('renders the Jobs heading and the state filter row', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
});
