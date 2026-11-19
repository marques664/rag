import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ai',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
