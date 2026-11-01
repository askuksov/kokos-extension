import { defineConfig } from 'vitest/config';

// Modules take their browser dependencies by injection, so a plain node
// environment is the default (DOM tests opt into jsdom per file) — no
// WxtVitest / fake-browser plugin needed.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
