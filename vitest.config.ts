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
      /*
       * Recalibrated for Vitest 4, which counts differently rather than
       * covering less. Measured on the same commit and the same 421 tests:
       *
       *                 Vitest 3              Vitest 4
       *   statements    64.27% (2933/4563)    65.60% (1438/2192)
       *   lines         64.27% (2933/4563)    65.60% (1366/2082)
       *   branches      88.68%  (995/1122)    70.77%  (879/1242)
       *   functions     81.27%   (230/283)    62.12%   (333/536)
       *
       * The denominators are the story. Functions go from 283 to 536 — Vitest 4
       * counts the callbacks and arrow functions that 3 walked past — and
       * branches gain 120. Statements and lines *rise*, because the old total
       * was inflated by lines that never execute. Nothing here got worse; the
       * accounting got honest, and thresholds set against the old arithmetic
       * were measuring something that no longer exists.
       */
      thresholds: {
        statements: 65,
        branches: 70,
        functions: 61,
        lines: 65,
      },
    },
  },
});
