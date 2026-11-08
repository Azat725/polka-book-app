import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_PAGES === '1' ? '/polka-book-app/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000', '/admin': 'http://127.0.0.1:8000' },
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000', '/admin': 'http://127.0.0.1:8000' },
  },
  build: { target: ['chrome109', 'safari16.4'], sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/shared/api.ts',
        'src/shared/upload.ts',
        'src/shared/themes.ts',
        'src/shared/compat.ts',
        'src/reader/geometry.ts',
        'src/reader/range.ts',
        'src/reader/useProgress.ts',
        'src/reader/useBookSettings.ts',
      ],
    },
  },
});
