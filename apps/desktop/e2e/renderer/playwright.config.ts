import { defineConfig, devices } from '@playwright/test'

/**
 * Renderer layout suite: real components + real compiled styles.css in plain
 * Chromium, served by the Vite dev server. No Electron, no backend.
 *
 * For bugs only a real layout engine sees (Typography margins, aspect-ratio
 * frames): jsdom applies no compiled CSS, so vitest passes on broken code.
 * Harness pages live in ./harness and are served from the app root.
 */
const port = 5391

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/renderer',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: '../..',
    url: `http://127.0.0.1:${port}/e2e/renderer/harness/media-layout.html`,
    reuseExistingServer: false,
    timeout: 120_000
  }
})
