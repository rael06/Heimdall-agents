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
      /*
       * A floor just under where the suite actually stands, so the number can
       * only go up. Not a target: the uncovered half is `main.ts`, `serve.ts`
       * and the command entry points, which are wiring rather than decisions and
       * are covered end to end by the Playwright suite instead.
       *
       * Raise these when a change genuinely lifts them. Lowering one is a
       * decision to argue for in the commit message, not a way to get green.
       */
      thresholds: {
        statements: 62,
        branches: 87,
        functions: 80,
        lines: 62,
      },
    },
  },
});
