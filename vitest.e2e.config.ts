import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e.test.ts'],
    // One browser, one preview server, shared across the file.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
