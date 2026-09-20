import { defineConfig } from '@playwright/test';

/**
 * Electron e2e. There is no `webServer` and no browser project: each
 * test launches the *built* desktop app through Playwright's Electron
 * driver (see src/fixtures/desktop.ts), so `nx e2e desktop-e2e`
 * depends on `desktop:build`.
 *
 * Workers stay at 1. Every test gets its own repo and HOME, but the
 * app spawns real PTYs and runs real git, and a single instance at a
 * time keeps failures readable.
 */
/**
 * Where this run's traces, videos and screenshot diffs land. Playwright
 * empties its output directory at the start of every run, and `e2e` and
 * `e2e:visual` are two runs over the same checkout — sharing one
 * directory means whichever finishes last deletes the other's results
 * before CI ever uploads them, which is how a failing screenshot's
 * expected/actual/diff PNGs went missing from the artifact. `e2e:visual`
 * passes its own base (see run-visual.mjs), and the nx targets declare
 * the matching `outputs`.
 */
const outputBase =
  process.env.N10_E2E_OUTPUT_BASE ?? './test-output/playwright';

export default defineConfig({
  testDir: './src',
  outputDir: `${outputBase}/output`,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: `${outputBase}/report` }],
      ]
    : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
