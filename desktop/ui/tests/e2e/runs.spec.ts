import { test, expect } from '@playwright/test';

test('renders the Runs heading', async ({ page }) => {
  await page.goto('/runs');
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
});
