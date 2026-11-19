import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@enterprise-ai/shared': path.resolve(
        import.meta.dirname,
        '../shared/src/index.ts',
      ),
    },
  },
  test: {
    name: 'database',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
