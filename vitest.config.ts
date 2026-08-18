import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The end-to-end suite needs a production build and a real browser, so it
    // runs separately via `npm run test:e2e` and stays out of the fast path.
    exclude: ['tests/e2e.test.ts'],
  },
});
