import { test, expect, loginApi } from './fixtures';

test('upload retries keep acknowledged chunks and reject conflicting bytes and size abuse', async ({ request }) => {
  const user = await loginApi(request);
  const prefix = 'http://127.0.0.1:8000/api/v1';
  const headers = { Authorization: `Bearer ${user.token}` };
  const tooLarge = await request.post(`${prefix}/uploads/`, { headers, data: { filename: 'huge.pdf', size: 100_000_001 } });
  expect(tooLarge.status()).toBe(413);
  const opened = await request.post(`${prefix}/uploads/`, { headers, data: { filename: 'resumable.pdf', size: 8_388_608 } });
  expect(opened.status()).toBe(201);
  const upload = await opened.json();
  const bytes = Buffer.alloc(upload.chunk_size, 0x20);
  bytes.write('%PDF-1.4\n');
  const chunkUrl = `${prefix}/uploads/${upload.id}/chunks/0/`;
  const binaryHeaders = { ...headers, 'Content-Type': 'application/octet-stream' };
  expect((await request.put(chunkUrl, { headers: binaryHeaders, data: bytes })).status()).toBe(204);
  expect((await request.put(chunkUrl, { headers: binaryHeaders, data: bytes })).status()).toBe(204);
  const resumed = await (await request.get(`${prefix}/uploads/${upload.id}/`, { headers })).json();
  expect(resumed.uploaded_chunks).toEqual([0]);
  bytes[50] = 0x21;
  expect((await request.put(chunkUrl, { headers: binaryHeaders, data: bytes })).status()).toBe(409);
  expect((await request.post(`${prefix}/uploads/${upload.id}/complete/`, { headers })).status()).toBe(409);
  expect((await request.delete(`${prefix}/uploads/${upload.id}/`, { headers })).status()).toBe(204);
  const cancelled = await (await request.get(`${prefix}/uploads/${upload.id}/`, { headers })).json();
  expect(cancelled.state).toBe('cancelled');
  expect((await request.put(chunkUrl, { headers: binaryHeaders, data: bytes })).status()).toBe(410);
});
