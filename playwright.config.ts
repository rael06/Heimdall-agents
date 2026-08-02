import { defineConfig } from '@playwright/test';

/**
 * The interface is checked in a real browser, not only in unit tests. M1 shipped
 * a `watch` command whose unit tests were all green and which exited a tenth of
 * a second after starting; a page that throws on its first line would look just
 * as finished.
 */
export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  // Each spec starts its own service on its own port, in its own temporary home.
  fullyParallel: false,
  workers: 1,
  use: { baseURL: undefined },
});
