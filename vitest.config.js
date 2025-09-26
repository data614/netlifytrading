import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [],
    exclude: [...configDefaults.exclude, 'tests/aiAnalystBatch.spec.js'],
    include: ['tests/**/*.spec.js'],
  },
});
