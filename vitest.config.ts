import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30_000,
    exclude: ['data/**', '.claude/**', 'node_modules/**'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'daemon',
          include: ['tests/daemon/**/*.test.ts'],
          setupFiles: ['tests/helpers/daemon-mocks.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/helpers/integration-setup.ts'],
          testTimeout: 60_000,
          pool: 'forks',
        },
      },
    ],
  },
});
