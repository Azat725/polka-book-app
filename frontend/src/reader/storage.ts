import type { Progress } from '../shared/types';

export interface PendingProgress extends Progress {
  bookId: string;
  client_mutation_id: string;
  updatedAt: number;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open('book-app-reader', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('progress', { keyPath: 'bookId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('progress', mode);
    const request = run(transaction.objectStore('progress'));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function loadProgress(bookId: string): Promise<PendingProgress | undefined> {
  return transact('readonly', (store) => store.get(bookId));
}

export function queueProgress(progress: PendingProgress): Promise<IDBValidKey> {
  return transact('readwrite', (store) => store.put(progress));
}

export async function removeProgress(bookId: string, mutationId: string): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('progress', 'readwrite');
    const store = transaction.objectStore('progress');
    const request = store.get(bookId);
    request.onsuccess = () => {
      if (request.result?.client_mutation_id === mutationId) store.delete(bookId);
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export function clearReaderStorage(): Promise<undefined> {
  return transact('readwrite', (store) => store.clear());
}
