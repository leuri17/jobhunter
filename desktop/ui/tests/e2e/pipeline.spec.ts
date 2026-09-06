import { test, expect } from '@playwright/test';

test('renders the Pipeline heading and the Run pipeline button', async ({ page }) => {
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: /run pipeline/i })).toBeVisible();
});
