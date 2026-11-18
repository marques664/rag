import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
  },
});
