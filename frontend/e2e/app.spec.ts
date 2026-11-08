import { test, expect, readingPdf, skipOnboarding, loginApi, uploadApi, newUser } from './fixtures';

test('first launch opens a private empty library and the real PDF journey', async ({ page, telegramUser }) => {
  const clientErrors: string[] = [];
  page.on('pageerror', error => clientErrors.push(error.message));
  expect(telegramUser.id).toBeGreaterThan(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Ваша библиотека/ })).toBeVisible();
  await skipOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Здесь начнётся ваша история' })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить PDF', exact: true }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Выбрать PDF', exact: true }).click();
  await (await chooser).setFiles({ name: 'Reading room.pdf', mimeType: 'application/pdf', buffer: readingPdf() });
  const card = page.locator('.book-card').filter({ hasText: 'Reading room' });
  await expect(page.getByText('Книга на вашей полке', { exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText('Обрабатывается')).toHaveCount(0, { timeout: 60_000 });
  await card.getByRole('button', { name: 'Читать: Reading room' }).click();
  await expect(page.locator('.textLayer').getByText('THE READING ROOM', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Добавить закладку', exact: true }).click();
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect(page.locator('.textLayer').getByText('CHAPTER TWO', { exact: true })).toBeVisible();
  await page.locator('.textLayer').getByText('The quiet shelf remembers every page.', { exact: true }).evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Выделить', exact: true }).click();
  await expect(page.locator('[data-page-number="2"] .pdf-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: 'Заметка к странице', exact: true }).click();
  await page.getByRole('textbox', { name: 'Заметка к странице', exact: true }).fill('Keep this thought for tomorrow.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Сохранено', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.locator('.book-card').filter({ hasText: 'Reading room' }).getByRole('button', { name: 'Читать: Reading room' }).click();
  await expect(page.locator('.textLayer').getByText('CHAPTER TWO', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Закладки и заметки', exact: true }).click();
  await expect(page.getByText('Keep this thought for tomorrow.', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт заметок', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  expect(clientErrors).toEqual([]);
});

test('file endpoints enforce identity and byte ranges against a real stored PDF', async ({ request }) => {
  const owner = await loginApi(request);
  const other = await loginApi(request, newUser());
  const book = await uploadApi(request, owner.token);
  const url = `http://127.0.0.1:8000/api/v1/books/${book.id}/file/`;
  await expect.poll(async () => (await request.get(`http://127.0.0.1:8000/api/v1/books/${book.id}/`, { headers: { Authorization: `Bearer ${owner.token}` } })).json().then(body => body.processing_status), { timeout: 60_000 }).toBe('ready');
  expect((await request.get(url)).status()).toBe(401);
  expect((await request.get(url, { headers: { Authorization: `Bearer ${other.token}` } })).status()).toBe(404);
  const part = await request.get(url, { headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=0-7' } });
  expect(part.status()).toBe(206);
  expect(part.headers()['content-range']).toMatch(/^bytes 0-7\/\d+$/);
  expect((await part.body()).toString()).toBe('%PDF-1.4');
  expect((await request.get(url, { headers: { Authorization: `Bearer ${owner.token}`, Range: 'bytes=999999-1000000' } })).status()).toBe(416);
});

test('invalid initData and invalid PDF cannot become valid user data', async ({ request }) => {
  const rejected = await request.post('http://127.0.0.1:8000/api/v1/auth/telegram/', { data: { init_data: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=forged' } });
  expect(rejected.status()).toBe(401);
  const owner = await loginApi(request);
  const book = await uploadApi(request, owner.token, 'invalid.pdf', Buffer.from('%PDF-1.7\nThis is not a real PDF.\n%%EOF'));
  await expect.poll(async () => (await request.get(`http://127.0.0.1:8000/api/v1/books/${book.id}/`, { headers: { Authorization: `Bearer ${owner.token}` } })).json().then(body => body.processing_status), { timeout: 60_000 }).toBe('error');
});
