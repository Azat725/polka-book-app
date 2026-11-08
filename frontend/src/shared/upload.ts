import { api, ApiError } from './api';
import type { Book } from './types';
export function validatePdf(file: Pick<File, 'name' | 'size'>) {
  if (!file.name.toLowerCase().endsWith('.pdf') || file.size <= 0) throw new Error('invalid_pdf');
  if (file.size > 100_000_000) throw new Error('file_too_large');
}
function resumeId(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value?: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Resume persistence is optional; transfer and authorization are not. */
  }
}
async function chunkHash(blob: Blob): Promise<string> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
export async function uploadBook(
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  owner: string,
): Promise<Book> {
  validatePdf(file);
  const key = `polka_upload:${owner}:${file.name}:${file.size}:${file.lastModified}`;
  let session: {
    id: string;
    chunk_size: number;
    uploaded_chunks?: number[];
    chunk_checksums?: Record<string, string>;
  } | null = null;
  try {
    const saved = resumeId(key);
    if (saved) session = await api(`/uploads/${encodeURIComponent(saved)}/`, { signal });
  } catch (error) {
    if (!(error instanceof ApiError && [404, 410].includes(error.status))) throw error;
    remember(key);
  }
  if (!session)
    session = await api('/uploads/', {
      method: 'POST',
      signal,
      body: JSON.stringify({ filename: file.name, size: file.size }),
    });
  if (!session || session.chunk_size <= 0) throw new Error('Invalid upload response');
  remember(key, session.id);
  const chunks = Math.ceil(file.size / session.chunk_size);
  const uploaded = new Set(session.uploaded_chunks || []);
  for (let index = 0; index < chunks; index++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (uploaded.has(index) && session.chunk_checksums?.[String(index)] && crypto.subtle) {
      const digest = await chunkHash(
        file.slice(
          index * session.chunk_size,
          Math.min(file.size, (index + 1) * session.chunk_size),
        ),
      );
      if (digest !== session.chunk_checksums[String(index)]) {
        remember(key);
        await api(`/uploads/${session.id}/`, { method: 'DELETE', signal }).catch(() => undefined);
        throw new Error('resume_file_changed');
      }
    }
    if (!uploaded.has(index)) {
      let attempt = 0;
      while (true) {
        try {
          await api(`/uploads/${session.id}/chunks/${index}/`, {
            method: 'PUT',
            signal,
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file.slice(
              index * session.chunk_size,
              Math.min(file.size, (index + 1) * session.chunk_size),
            ),
          });
          break;
        } catch (error) {
          if (signal.aborted || (error instanceof ApiError && error.status < 500) || ++attempt > 2)
            throw error;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', abort);
              resolve();
            }, attempt * 700);
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', abort, { once: true });
          });
        }
      }
    }
    onProgress(Math.round(((index + 1) / chunks) * 100));
  }
  const book = await api<Book>(`/uploads/${session.id}/complete/`, { method: 'POST', signal });
  remember(key);
  return book;
}
