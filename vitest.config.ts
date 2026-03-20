import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: ['data/**', '.claude/**', 'node_modules/**'],
    setupFiles: ['tests/helpers/daemon-mocks.ts'],
  },
});
