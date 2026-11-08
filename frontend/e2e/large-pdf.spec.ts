import { test, expect, loginApi, uploadApi, hundredMegabytePdf } from './fixtures';

// Large request bodies are deliberately excluded from trace archives.
test.use({ trace: 'off' });
test('exact 100 MB PDF uploads and renders using partial authenticated requests @slow', async ({ page, request, telegramUser }) => {
  test.setTimeout(240_000);
  const session = await loginApi(request, telegramUser);
  const headers = { Authorization: `Bearer ${session.token}` };
  const api = 'http://127.0.0.1:8000/api/v1';
  await request.patch(`${api}/settings/`, { headers, data: { onboarding_done: true } });
  const bytes = hundredMegabytePdf();
  expect(bytes.length).toBe(100_000_000);
  const book = await uploadApi(request, session.token, '100 MB range.pdf', bytes);
  await expect.poll(async () => (await request.get(`${api}/books/${book.id}/`, { headers })).json().then(value => value.processing_status), { timeout: 60_000 }).toBe('ready');
  const actual = await (await request.get(`${api}/books/${book.id}/`, { headers })).json();
  expect(actual.size_bytes).toBe(100_000_000);
  const ranges: Array<{ status: number; bytes: number }> = [];
  page.on('response', response => {
    if (!response.url().includes(`/books/${book.id}/file`)) return;
    const range = response.headers()['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    ranges.push({ status: response.status(), bytes: range ? Number(range[2]) - Number(range[1]) + 1 : 100_000_000 });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Читать: 100 MB range', exact: true }).click();
  await expect(page.locator('.textLayer').getByText('THE READING ROOM', { exact: true })).toBeVisible({ timeout: 45_000 });
  expect(ranges.length).toBeGreaterThan(1);
  expect(ranges.every(range => range.status === 206)).toBe(true);
  expect(ranges.reduce((sum, range) => sum + range.bytes, 0)).toBeLessThan(5_000_000);
  await page.screenshot({ path: '../artifacts/reader-100mb.png' });
});
