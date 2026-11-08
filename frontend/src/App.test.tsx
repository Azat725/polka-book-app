import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { defaultSettings, type Me } from './shared/types';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  api: vi.fn(),
  i18n: { exists: () => false, t: (key: string) => key, changeLanguage: () => Promise.resolve() },
}));
vi.mock('./shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared/api')>()),
  authenticate: mocks.authenticate,
  api: mocks.api,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      `${key}${values?.name ? ` ${values.name}` : ''}`,
    i18n: mocks.i18n,
  }),
}));

const me = (id: string, name: string): Me => ({
  user: { id, first_name: name },
  settings: { ...defaultSettings, onboarding_done: true },
  statistics: { books: 0, read: 0, reading: 0, storage_bytes: 0, reading_seconds: 0 },
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

it('never reuses a previous account query cache after a new Telegram login', async () => {
  const previous = me('old-user', 'Private previous name');
  const next = me('new-user', 'New reader');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], previous);
  client.setQueryData(['books', 'sort=-created_at'], {
    pages: [
      {
        results: [
          {
            id: 'secret-book',
            title: 'Private previous book',
            author: '',
            status: 'want',
            favorite: false,
            processing_status: 'ready',
            progress: { page: 1, position: 0, revision: 0 },
            page_count: 2,
            size_bytes: 100,
            cover_url: null,
            folder_id: null,
            collection_ids: [],
            created_at: '',
            deleted_at: null,
          },
        ],
        next: null,
      },
    ],
    pageParams: [''],
  });
  mocks.authenticate.mockResolvedValue(next);
  mocks.api.mockImplementation((path: string) =>
    Promise.resolve(path === '/me/' ? next : { results: [], next: null }),
  );
  const view = render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('greeting New reader')).toBeInTheDocument();
  expect(screen.queryByText(/Private previous/)).not.toBeInTheDocument();
  expect(client.getQueryData<Me>(['me'])?.user.id).toBe('new-user');
  view.unmount();
  client.clear();
});
