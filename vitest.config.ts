import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.js` too: the interface's pure half lives in `src/web/lib.js`, which is
    // plain ES modules and imports here exactly as it is served.
    include: ['src/**/*.test.ts', 'src/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Everything that ships, so a module nobody imports counts as the zero it
      // is. Reporting only what the tests happened to load is how "335 tests
      // pass" came to say nothing about what was exercised.
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/model/types.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
