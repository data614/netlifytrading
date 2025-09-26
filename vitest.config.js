import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup-environment.js'],
    include: ['tests/**/*.spec.js'],
    exclude: [...configDefaults.exclude, 'tests/aiAnalystBatch.spec.js'],
  },
});

