import { test, expect, loginApi, uploadApi, manyPagePdf, triggerTelegramBack } from './fixtures';
import type { Page, APIRequestContext } from '@playwright/test';

async function prepare(request: APIRequestContext, user: { id: number; first_name: string; language_code: string }, bytes?: Buffer, filename = 'Reading room.pdf') {
  const session = await loginApi(request, user);
  const headers = { Authorization: `Bearer ${session.token}` };
  const api = 'http://127.0.0.1:8000/api/v1';
  const settings = await request.patch(`${api}/settings/`, { headers, data: { onboarding_done: true } });
  expect(settings.ok()).toBeTruthy();
  const book = await uploadApi(request, session.token, filename, bytes);
  await expect.poll(async () => (await request.get(`${api}/books/${book.id}/`, { headers })).json().then(value => value.processing_status), { timeout: 60_000 }).toBe('ready');
  return { book, headers, api };
}

async function openBook(page: Page, title = 'Reading room') {
  await page.getByRole('button', { name: `Читать: ${title}`, exact: true }).click();
  await expect(page.getByTestId('pdf-reader')).toBeVisible();
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 30_000 });
}

test('reader searches real text, jumps to matches, zooms, rotates and turns pages', async ({ page, request, telegramUser }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const { book, headers, api } = await prepare(request, telegramUser);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openBook(page);
  await expect.poll(async () => {
    const bounds = await page.getByTestId('pdf-reader').boundingBox();
    return bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }).toEqual({ x: 0, y: 0, width: 430, height: 900 });
  await page.getByRole('button', { name: 'Поиск в книге', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Найти текст', exact: true }).fill('quiet shelf');
  await page.getByRole('dialog').getByRole('button', { name: 'Поиск в книге', exact: true }).click();
  await page.locator('.reader-result').filter({ hasText: 'quiet shelf' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Перейти к странице', exact: true })).toHaveValue('2');
  await expect(page.locator('[data-page-number="2"] .textLayer [data-reader-match="true"]')).toHaveCount(1);

  const initialWidth = await page.locator('[data-page-number="2"] .pdf-page').evaluate(element => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(page.getByRole('button', { name: /120%/ })).toBeVisible();
  await expect.poll(async () => page.locator('[data-page-number="2"] .pdf-page').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(initialWidth);
  await page.getByRole('button', { name: /120%/ }).click();
  await page.getByRole('button', { name: 'Повернуть страницу', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect.poll(async () => page.locator('[data-page-number="2"] .pdf-page').evaluate(element => element.getBoundingClientRect().width / element.getBoundingClientRect().height)).toBeGreaterThan(1);
  await expect(page.locator('[data-page-number="2"] .textLayer').getByText('CHAPTER TWO', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  for (let count = 0; count < 3; count++) await page.getByRole('button', { name: 'Повернуть страницу', exact: true }).click();
  await page.getByRole('combobox', { name: 'Режим чтения', exact: true }).selectOption('flip');
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect(page.locator('.textLayer').getByText('THE LAST PAGE', { exact: true })).toBeVisible();
  await expect(page.locator('.reader-curl')).toHaveCount(0, { timeout: 5_000 });
  await page.getByRole('button', { name: 'Предыдущая страница', exact: true }).click();
  await expect(page.locator('.textLayer').getByText('CHAPTER TWO', { exact: true })).toBeVisible();
  await expect(page.locator('.reader-curl')).toHaveCount(0, { timeout: 5_000 });
  expect(errors).toEqual([]);
  await page.screenshot({ path: '../artifacts/reader-tools.png' });
  const current = await (await request.get(`${api}/books/${book.id}/`, { headers })).json();
  expect(current.id).toBe(book.id);
});

test('250-page mixed-orientation book bounds live canvases and survives immediate Telegram back', async ({ page, request, telegramUser }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { headers, api, book } = await prepare(request, telegramUser, manyPagePdf(250, true), 'Long reading.pdf');
  await page.goto('/');
  await openBook(page, 'Long reading');
  await expect(page.locator('.pdf-page-slot')).toHaveCount(250);
  for (const number of [125, 250, 3]) {
    const field = page.getByRole('spinbutton', { name: 'Перейти к странице', exact: true });
    await field.fill(String(number)); await field.press('Enter');
    await expect(page.locator(`[data-page-number="${number}"] .textLayer`).getByText(`PAGE ${number}`, { exact: true })).toBeVisible();
    expect(await page.locator('.pdf-page canvas').count()).toBeLessThanOrEqual(5);
  }
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await page.getByRole('combobox', { name: 'Режим чтения', exact: true }).selectOption('flip');
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Перейти к странице', exact: true })).toHaveValue('4');
  await triggerTelegramBack(page);
  await expect(page.getByTestId('pdf-reader')).toHaveCount(0);
  await openBook(page, 'Long reading');
  await expect(page.locator('[data-page-number="4"] .textLayer').getByText('PAGE 4', { exact: true })).toBeVisible();
  await expect.poll(async () => (await request.get(`${api}/books/${book.id}/progress/`, { headers })).json().then(value => value.page)).toBe(4);
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.getByRole('button', { name: 'Следующая страница', exact: true })).toBeInViewport();
  await expect(page.locator('.reader-curl')).toHaveCount(0);
});

test('book-specific reader settings persist without changing another book or global preferences', async ({ page, request, telegramUser }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const { headers, api, book } = await prepare(request, telegramUser);
  const second = await uploadApi(request, headers.Authorization.slice('Bearer '.length), 'Another book.pdf');
  const foreign = await loginApi(request);
  await page.goto('/');
  await openBook(page);
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect.poll(async () => (await request.get(`${api}/books/${book.id}/reader-settings/`, { headers })).json().then(value => value.zoom)).toBe(1.2);
  await page.getByRole('combobox', { name: 'Режим чтения', exact: true }).selectOption('flip');
  await page.getByRole('combobox', { name: 'Размер страницы', exact: true }).selectOption('page');
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  await triggerTelegramBack(page);
  await expect(page.getByTestId('pdf-reader')).toHaveCount(0);
  await openBook(page);
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Режим чтения', exact: true })).toHaveValue('flip');
  await expect(page.getByRole('combobox', { name: 'Размер страницы', exact: true })).toHaveValue('page');
  const persisted = await (await request.get(`${api}/books/${book.id}/reader-settings/`, { headers })).json();
  expect(persisted.reader_mode).toBe('flip');
  expect(persisted.fit_mode).toBe('page');
  const untouched = await (await request.get(`${api}/books/${second.id}/reader-settings/`, { headers })).json();
  expect(untouched.reader_mode).toBe('scroll');
  expect(untouched.zoom).toBe(1);
  const global = await (await request.get(`${api}/settings/`, { headers })).json();
  expect(global.reader_mode).toBe('scroll');
  expect((await request.get(`${api}/books/${book.id}/reader-settings/`, { headers: { Authorization: `Bearer ${foreign.token}` } })).status()).toBe(404);
});

test('reader does not depend on newer Promise helpers being present in the host WebView', async ({ page, request, telegramUser }) => {
  await prepare(request, telegramUser);
  await page.addInitScript(() => {
    Reflect.deleteProperty(Promise, 'withResolvers');
    Reflect.deleteProperty(Promise, 'try');
  });
  await page.goto('/');
  await openBook(page);
  await expect(page.locator('.textLayer').getByText('THE READING ROOM', { exact: true })).toBeVisible();
});
