import { test, expect } from '@playwright/test';

test('homepage renders products', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/RMIT Store/i);
});

test('API health is OK', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
});


