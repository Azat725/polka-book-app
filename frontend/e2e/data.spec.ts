import { test, expect, loginApi, uploadApi, newUser } from './fixtures';

test('annotations, device progress conflicts, collections, trash and export survive real round trips', async ({ request }) => {
  const firstDevice = await loginApi(request);
  const secondDevice = await loginApi(request, firstDevice.user);
  const foreign = await loginApi(request, newUser());
  const headers = { Authorization: `Bearer ${firstDevice.token}` };
  const endpoint = (path: string) => `http://127.0.0.1:8000/api/v1${path}`;
  const created = await uploadApi(request, firstDevice.token, 'A private reading journey.pdf');
  const id = created.id as string;
  await expect.poll(async () => (await request.get(endpoint(`/books/${id}/`), { headers })).json().then(body => body.processing_status), { timeout: 60_000 }).toBe('ready');

  const collection = await request.post(endpoint('/collections/'), { headers, data: { name: 'Thoughtful reading' } });
  expect(collection.status()).toBe(201);
  const collectionId = (await collection.json()).id;
  expect((await request.put(endpoint(`/collections/${collectionId}/books/${id}/`), { headers })).ok()).toBeTruthy();
  const folder = await request.post(endpoint('/folders/'), { headers, data: { name: 'Private folder', parent_id: null } });
  expect(folder.status()).toBe(201);
  const folderId = (await folder.json()).id;
  expect((await request.patch(endpoint(`/books/${id}/`), { headers, data: { folder_id: folderId, favorite: true, status: 'reading' } })).ok()).toBeTruthy();

  const bookmark = await request.post(endpoint(`/books/${id}/bookmarks/`), { headers, data: { page: 1, position: 0, text: 'Return here' } });
  expect(bookmark.status()).toBe(201);
  const highlight = await request.post(endpoint(`/books/${id}/highlights/`), { headers, data: { page: 2, position: 0.2, text: 'quiet shelf', color: 'gold', quads: [[36, 420, 120, 435]], prefix: 'The ', suffix: ' remembers' } });
  expect(highlight.status()).toBe(201);
  const note = await request.post(endpoint(`/books/${id}/notes/`), { headers, data: { page: 2, position: 0.2, text: 'A thought worth keeping.' } });
  expect(note.status()).toBe(201);
  const noteObject = await note.json();
  expect((await request.patch(endpoint(`/notes/${noteObject.id}/`), { headers, data: { text: 'Edited without losing the anchor.', revision: noteObject.revision } })).ok()).toBeTruthy();

  const initial = await (await request.get(endpoint(`/books/${id}/progress/`), { headers })).json();
  const saved = await request.put(endpoint(`/books/${id}/progress/`), { headers, data: { page: 2, position: 0.25, revision: initial.revision, client_mutation_id: crypto.randomUUID() } });
  expect(saved.status()).toBe(200);
  const conflicting = await request.put(endpoint(`/books/${id}/progress/`), { headers: { Authorization: `Bearer ${secondDevice.token}` }, data: { page: 1, position: 0, revision: initial.revision, client_mutation_id: crypto.randomUUID() } });
  expect(conflicting.status()).toBe(409);
  const resumed = await (await request.get(endpoint(`/books/${id}/progress/`), { headers: { Authorization: `Bearer ${secondDevice.token}` } })).json();
  expect(resumed.page).toBe(2);
  expect(resumed.position).toBe(0.25);

  expect((await request.get(endpoint(`/books/${id}/notes/`), { headers: { Authorization: `Bearer ${foreign.token}` } })).status()).toBe(404);
  expect((await request.delete(endpoint(`/notes/${noteObject.id}/`), { headers: { Authorization: `Bearer ${foreign.token}` } })).status()).toBe(404);
  const exported = await request.get(endpoint('/exports/annotations/?format=json'), { headers });
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain('Edited without losing the anchor.');

  expect((await request.delete(endpoint(`/books/${id}/`), { headers })).ok()).toBeTruthy();
  const trash = await (await request.get(endpoint('/trash/'), { headers })).json();
  expect(trash.results.some((book: { id: string }) => book.id === id)).toBeTruthy();
  expect((await request.get(endpoint(`/books/${id}/file/`), { headers })).status()).toBe(404);
  expect((await request.post(endpoint(`/trash/${id}/restore/`), { headers })).ok()).toBeTruthy();
  const restored = await (await request.get(endpoint(`/books/${id}/`), { headers })).json();
  expect(restored.favorite).toBe(true);
  expect(restored.collection_ids).toContain(collectionId);
  expect(restored.folder_id).toBe(folderId);
  expect(restored.progress.page).toBe(2);
  const notes = await (await request.get(endpoint(`/books/${id}/notes/`), { headers })).json();
  expect(notes.results[0].text).toBe('Edited without losing the anchor.');
  expect((await request.delete(endpoint(`/collections/${collectionId}/`), { headers })).ok()).toBeTruthy();
  expect((await request.get(endpoint(`/books/${id}/`), { headers })).status()).toBe(200);
});

test('settings and a saved palette synchronize between authenticated devices', async ({ request }) => {
  const first = await loginApi(request);
  const second = await loginApi(request, first.user);
  const url = 'http://127.0.0.1:8000/api/v1';
  const headers = { Authorization: `Bearer ${first.token}` };
  const settings = await (await request.get(`${url}/settings/`, { headers })).json();
  const changed = await request.patch(`${url}/settings/`, { headers, data: { revision: settings.revision, theme: 'terracotta', language: 'en', reader_mode: 'flip', custom_colors: { accent: '#7C202D' } } });
  expect(changed.status()).toBe(200);
  const otherSettings = await (await request.get(`${url}/settings/`, { headers: { Authorization: `Bearer ${second.token}` } })).json();
  expect(otherSettings.theme).toBe('terracotta');
  expect(otherSettings.language).toBe('en');
  expect(otherSettings.reader_mode).toBe('flip');
  const preset = await request.post(`${url}/theme-presets/`, { headers, data: { name: 'My reading room', settings: { theme: 'terracotta', custom_colors: { accent: '#7C202D' } } } });
  expect(preset.status()).toBe(201);
  const invalid = await request.patch(`${url}/settings/`, { headers, data: { custom_colors: { bg: 'url(https://outside.example)' } } });
  expect(invalid.status()).toBe(400);
});
