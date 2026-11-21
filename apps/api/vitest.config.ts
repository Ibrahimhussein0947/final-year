import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/tests/helpers/loadTestEnv.ts'],
    include: ['src/**/*.test.ts'],
    // Tests share one database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
