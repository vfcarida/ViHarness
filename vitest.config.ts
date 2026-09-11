import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/fixtures/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      // Minimum thresholds enforced per CI run.
      // Values reflect achievable unit-test-only coverage (integration tests supplement these numbers).
      // Raise these gradually as coverage improves — never lower them.
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    typecheck: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@vi-harness/core': new URL('./src/core', import.meta.url).pathname,
      '@vi-harness/infra': new URL('./src/infra', import.meta.url).pathname,
      '@vi-harness/di': new URL('./src/di', import.meta.url).pathname,
    },
  },
});
