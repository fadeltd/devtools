import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pure functions: no DOM, and node boots much faster.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
