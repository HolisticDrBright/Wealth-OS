import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    // Glob patterns — bare names only match top-level, which let vitest crawl
    // into apps/mobile/node_modules. apps/mobile has its own toolchain.
    exclude: ['**/node_modules/**', '**/.next/**', '**/.expo/**', 'apps/mobile/**'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
  resolve: {
    alias: {
      // The 'server-only' marker package throws outside React Server
      // Components; in node tests it must be a no-op.
      'server-only': path.resolve(__dirname, '__tests__/stubs/server-only.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
})
