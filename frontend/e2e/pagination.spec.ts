import { test, expect, loginApi, uploadApi } from './fixtures';

test('library loads the 25th real uploaded book without duplicating the first page', async ({ page, request, telegramUser }) => {
  test.setTimeout(150_000);
  const session = await loginApi(request, telegramUser);
  const headers = { Authorization: `Bearer ${session.token}` };
  await request.patch('http://127.0.0.1:8000/api/v1/settings/', { headers, data: { onboarding_done: true } });
  for (let number = 0; number < 25; number++) {
    await uploadApi(request, session.token, `Shelf ${String(number).padStart(2, '0')}.pdf`);
  }
  await page.goto('/library');
  await expect(page.locator('.book-card')).toHaveCount(24, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(25);
  const titles = await page.locator('.book-card h3').allTextContents();
  expect(new Set(titles).size).toBe(25);
  expect(titles).toContain('Shelf 00');
  expect(titles).toContain('Shelf 24');
  await expect(page.getByRole('button', { name: 'Показать ещё', exact: true })).toHaveCount(0);
});
