import { test, expect } from '@playwright/test';

test('renders the Profile versions heading', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile versions' })).toBeVisible();
});
