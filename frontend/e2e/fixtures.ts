import { createHash, createHmac, randomBytes } from 'node:crypto';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export interface TelegramUser { id: number; first_name: string; language_code: string; }
export function signedInitData(user: TelegramUser) {
  const token = process.env.E2E_BOT_TOKEN;
  if (!token) throw new Error('Playwright must provide a temporary signing secret');
  const fields = {
    auth_date: Math.floor(Date.now() / 1000).toString(),
    query_id: randomBytes(12).toString('hex'),
    user: JSON.stringify(user),
  };
  const checked = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(checked).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function newUser(): TelegramUser {
  return { id: 100_000_000 + Math.floor(Math.random() * 800_000_000), first_name: 'Читатель', language_code: 'ru' };
}

export async function installTelegram(page: Page, user: TelegramUser) {
  await page.route('https://telegram.org/js/telegram-web-app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '/* Telegram host bridge supplied by the signed test fixture. */' }));
  await page.addInitScript(({ initData }) => {
    // Only the Telegram host bridge is replaced. All application API calls are real.
    const callbacks = new Map<string, Set<(...args: unknown[]) => void>>();
    const backCallbacks = new Set<() => void>();
    window.addEventListener('e2e-telegram-back', () => Array.from(backCallbacks).forEach(callback => callback()));
    const bridge = {
      initData,
      initDataUnsafe: { user: { language_code: 'ru' } },
      version: '8.0', platform: 'tdesktop', colorScheme: 'dark',
      viewportStableHeight: window.innerHeight,
      ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
      onEvent(event: string, fn: (...args: unknown[]) => void) { const set = callbacks.get(event) || new Set(); set.add(fn); callbacks.set(event, set); },
      offEvent(event: string, fn: (...args: unknown[]) => void) { callbacks.get(event)?.delete(fn); },
      BackButton: { show() {}, hide() {}, onClick(callback: () => void) { backCallbacks.add(callback); }, offClick(callback: () => void) { backCallbacks.delete(callback); } },
    };
    // Keep the fixture stable if the external Telegram script initializes later.
    Object.defineProperty(window, 'Telegram', { configurable: false, get: () => ({ WebApp: bridge }), set: () => {} });
  }, { initData: signedInitData(user) });
}

export async function loginApi(request: APIRequestContext, user = newUser()) {
  const response = await request.post('http://127.0.0.1:8000/api/v1/auth/telegram/', { data: { init_data: signedInitData(user) } });
  expect(response.status()).toBe(200);
  const data = await response.json();
  return { token: data.access_token as string, refresh: data.refresh_token as string, user };
}

function rc4(key: Buffer, input: Buffer) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
  let i = 0; j = 0;
  return Buffer.from(input.map(byte => { i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]]; return byte ^ state[(state[i] + state[j]) & 255]; }));
}

export function readingPdf(password?: string) {
  // Legacy Standard Security revision 2 is generated only as an interoperability fixture.
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const pad = (value: string) => Buffer.concat([Buffer.from(value, 'latin1'), padding]).subarray(0, 32);
  const md5 = (value: Buffer) => createHash('md5').update(value).digest();
  const identifier = Buffer.from('polka-e2e-pdf-id');
  const ownerKey = md5(pad('fixture-owner')).subarray(0, 5);
  const owner = password ? rc4(ownerKey, pad(password)) : null;
  const permission = Buffer.alloc(4); permission.writeInt32LE(-4);
  const fileKey = password && owner ? md5(Buffer.concat([pad(password), owner, permission, identifier])).subarray(0, 5) : null;
  const user = fileKey ? rc4(fileKey, padding) : null;
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [
    ['THE READING ROOM', 'A small book for a real reading journey.', 'Bookmarks keep a place for tomorrow.'],
    ['CHAPTER TWO', 'The quiet shelf remembers every page.', 'A sentence worth highlighting and a thought worth keeping.'],
    ['THE LAST PAGE', 'Every finished book begins another story.', 'Thank you for reading.'],
  ];
  pages.forEach((lines, index) => {
    const streamId = 5 + index * 2;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    let stream = Buffer.from(`BT /F1 18 Tf 36 535 Td (${lines[0]}) Tj /F1 12 Tf 0 -48 Td (${lines[1]}) Tj 0 -30 Td (${lines[2]}) Tj ET\n`);
    if (fileKey) {
      const object = Buffer.alloc(5); object.writeUIntLE(streamId, 0, 3);
      const objectKey = md5(Buffer.concat([fileKey, object])).subarray(0, 10);
      stream = rc4(objectKey, stream);
    }
    add(`<< /Length ${stream.length} >>\nstream\n${stream.toString('latin1')}endstream`);
  });
  if (fileKey && owner && user) add(`<< /Filter /Standard /V 1 /Length 40 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`);
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(text, 'latin1')); text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(text, 'latin1');
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { text += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${fileKey ? ` /Encrypt 10 0 R /ID [<${identifier.toString('hex')}> <${identifier.toString('hex')}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, 'latin1');
}

export async function uploadApi(request: APIRequestContext, token: string, filename = 'Reading room.pdf', bytes = readingPdf()) {
  const headers = { Authorization: `Bearer ${token}` };
  const opened = await request.post('http://127.0.0.1:8000/api/v1/uploads/', { headers, data: { filename, size: bytes.length } });
  expect(opened.status()).toBe(201);
  const session = await opened.json();
  for (let offset = 0; offset < bytes.length; offset += session.chunk_size) {
    const index = Math.floor(offset / session.chunk_size);
    const chunk = await request.put(`http://127.0.0.1:8000/api/v1/uploads/${session.id}/chunks/${index}/`, { headers: { ...headers, 'Content-Type': 'application/octet-stream' }, data: bytes.subarray(offset, Math.min(bytes.length, offset + session.chunk_size)) });
    expect(chunk.ok()).toBeTruthy();
    await chunk.dispose();
  }
  const finished = await request.post(`http://127.0.0.1:8000/api/v1/uploads/${session.id}/complete/`, { headers });
  expect(finished.status()).toBe(202);
  return await finished.json();
}

export async function skipOnboarding(page: Page) {
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

export async function triggerTelegramBack(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-telegram-back')));
}

export function manyPagePdf(pageCount = 250, mixedOrientation = false) {
  const objects: string[] = [];
  const ids = Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${ids}] /Count ${pageCount} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let index = 0; index < pageCount; index++) {
    const streamId = 5 + index * 2;
    const landscape = mixedOrientation && index % 10 === 4;
    const width = landscape ? 595 : 420;
    const height = landscape ? 420 : 595;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    const stream = `BT /F1 18 Tf 36 ${height - 60} Td (PAGE ${index + 1}) Tj /F1 12 Tf 0 -48 Td (Searchable paragraph on page ${index + 1}. A quiet library.) Tj ET\n`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { text += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  return Buffer.from(`${text}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

export function hundredMegabytePdf() {
  const original = readingPdf();
  const text = original.toString('latin1');
  const match = /startxref\n(\d+)\n%%EOF/.exec(text);
  if (!match) throw new Error('Fixture xref missing');
  const oldXref = Number(match[1]);
  const prefix = original.subarray(0, oldXref);
  const oldTail = original.subarray(oldXref).toString('latin1');
  let padding = 100_000_000 - original.length;
  let tail = '';
  for (let iteration = 0; iteration < 4; iteration++) {
    tail = oldTail.replace(/startxref\n\d+/, `startxref\n${prefix.length + padding}`);
    const next = 100_000_000 - prefix.length - Buffer.byteLength(tail, 'latin1');
    if (next === padding) break;
    padding = next;
  }
  const comments = Buffer.alloc(padding, 0x20);
  for (let start = 0; start < padding; start += 80) {
    comments[start] = 0x25;
    comments[Math.min(start + 79, padding - 1)] = 0x0a;
  }
  const result = Buffer.concat([prefix, comments, Buffer.from(tail, 'latin1')]);
  if (result.length !== 100_000_000) throw new Error('Fixture must hit the exact upload boundary');
  return result;
}

export const test = base.extend<{ telegramUser: TelegramUser }>({
  telegramUser: async ({ page }, use) => { const user = newUser(); await installTelegram(page, user); await use(user); },
});
export { expect };
