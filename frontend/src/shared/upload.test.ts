import { describe, expect, it, vi } from 'vitest';
import { validatePdf, uploadBook } from './upload';
import * as client from './api';
import { webcrypto } from 'node:crypto';
describe('PDF transfer', () => {
  it('rejects oversize and wrong extension before opening a session', () => {
    expect(() => validatePdf({ name: 'book.txt', size: 8 })).toThrow('invalid_pdf');
    expect(() => validatePdf({ name: 'book.pdf', size: 100_000_001 })).toThrow('file_too_large');
    expect(() => validatePdf({ name: 'BOOK.PDF', size: 100_000_000 })).not.toThrow();
  });
  it('uploads chunks then finalizes the actual server book', async () => {
    const request = vi
      .spyOn(client, 'api')
      .mockResolvedValueOnce({ id: 'u1', chunk_size: 4 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ id: 'b1' });
    const file = new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' });
    const result = await uploadBook(file, vi.fn(), new AbortController().signal, 'owner');
    expect(result.id).toBe('b1');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/uploads/',
      '/uploads/u1/chunks/0/',
      '/uploads/u1/chunks/1/',
      '/uploads/u1/complete/',
    ]);
    request.mockRestore();
  });
  it('continues a transfer when optional browser resume storage is blocked', async () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    const request = vi
      .spyOn(client, 'api')
      .mockResolvedValueOnce({ id: 'u2', chunk_size: 100 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 'b2' });
    await expect(
      uploadBook(
        new File(['%PDF-1.7'], 'private.pdf'),
        vi.fn(),
        new AbortController().signal,
        'owner',
      ),
    ).resolves.toHaveProperty('id', 'b2');
    request.mockRestore();
    storage.mockRestore();
  });
  it('refuses to mix a changed source file with already acknowledged chunks', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const read = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('resume1');
    const request = vi
      .spyOn(client, 'api')
      .mockResolvedValueOnce({
        id: 'resume1',
        chunk_size: 4,
        uploaded_chunks: [0],
        chunk_checksums: { '0': '0'.repeat(64) },
      })
      .mockResolvedValueOnce(undefined);
    await expect(
      uploadBook(
        new File(['%PDF-1.7'], 'changed.pdf'),
        vi.fn(),
        new AbortController().signal,
        'owner',
      ),
    ).rejects.toThrow('resume_file_changed');
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/uploads/resume1/',
      '/uploads/resume1/',
    ]);
    expect(request.mock.calls[1][1]?.method).toBe('DELETE');
    request.mockRestore();
    read.mockRestore();
    vi.unstubAllGlobals();
  });
});
