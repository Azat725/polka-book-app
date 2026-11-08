import { test, expect, loginApi, uploadApi, readingPdf } from './fixtures';

test('encrypted PDF warns the reader, rejects a wrong password and decrypts only on the client', async ({ page, request, telegramUser }) => {
  const session = await loginApi(request, telegramUser);
  const headers = { Authorization: `Bearer ${session.token}` };
  const api = 'http://127.0.0.1:8000/api/v1';
  await request.patch(`${api}/settings/`, { headers, data: { onboarding_done: true } });
  const book = await uploadApi(request, session.token, 'Password book.pdf', readingPdf('shelf-secret'));
  await expect.poll(async () => (await request.get(`${api}/books/${book.id}/`, { headers })).json().then(body => body.processing_status), { timeout: 60_000 }).toBe('locked');
  const requestBodies: string[] = [];
  page.on('request', event => { if (event.url().includes('/api/')) requestBodies.push(event.postData() || ''); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Читать: Password book', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Документ защищён паролем', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Он используется только на этом устройстве и не сохраняется/)).toBeVisible();
  await page.getByLabel('Пароль PDF', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Открыть документ', exact: true }).click();
  await expect(page.getByText('Неверный пароль. Попробуйте ещё раз.', { exact: true })).toBeVisible();
  await page.getByLabel('Пароль PDF', { exact: true }).fill('shelf-secret');
  await page.getByRole('button', { name: 'Открыть документ', exact: true }).click();
  await expect(page.locator('.textLayer').getByText('THE READING ROOM', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(requestBodies.some(body => body.includes('shelf-secret') || body.includes('wrong-password'))).toBe(false);
});
