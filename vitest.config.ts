import { defineConfig } from 'vitest/config'

// Unit tests only — the Playwright e2e specs live in tests/*.spec.ts and run
// under Playwright, not vitest. Scoping `include` to src/**/*.test.ts keeps the
// two runners from picking up each other's files.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
