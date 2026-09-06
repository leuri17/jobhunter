import { test, expect } from '@playwright/test';

test('renders the Settings heading', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
