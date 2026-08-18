/**
 * End-to-end checks against a real production build in a real browser.
 *
 * These exist because of one specific bug: the offline guarantee — the whole
 * reason every catalogue is bundled — was silently broken by `Vary: Origin`, a
 * header most static hosts send. Everything typechecked, every unit test
 * passed, and the app was blank with the network cut. Only a browser can tell
 * you that.
 *
 * Run with `npm run test:e2e`, which builds first. Kept out of `npm test` so
 * the default suite stays fast and hermetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

const PORT = 4179;
const ORIGIN = `http://localhost:${PORT}`;
const CHROMIUM = '/opt/pw-browsers/chromium';

let server: ChildProcess;
let browser: Browser;

beforeAll(async () => {
  if (!existsSync(join(process.cwd(), 'dist', 'index.html'))) {
    throw new Error('No production build found. Run `npm run build` first, or use `npm run test:e2e`.');
  }

  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: false,
  });

  // Wait for the preview server rather than sleeping a fixed amount.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(ORIGIN);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  browser = await chromium.launch({ executablePath: CHROMIUM });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

describe('the app in a browser', () => {
  it('renders the sky, the ribbon and the events panel', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));

    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.sky-canvas', { timeout: 15_000 });

    expect(await page.textContent('.masthead h1')).toBe('Sidereal');
    expect(await page.locator('canvas.ribbon-canvas').count()).toBe(1);
    expect(await page.locator('.event').count()).toBeGreaterThan(0);
    expect(problems).toEqual([]);

    await page.close();
  }, 60_000);

  it('finds an object by name and opens its card', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('input.search-input');

    await page.fill('input.search-input', 'betelgeuse');
    await page.waitForSelector('.search-hit');
    expect(await page.textContent('.search-hit .search-label')).toBe('Betelgeuse');

    await page.click('.search-hit');
    await page.waitForSelector('.detail-card');
    expect(await page.textContent('.detail-card h2')).toBe('Betelgeuse');

    await page.close();
  }, 60_000);

  it('writes the view into the URL and restores it from a shared link', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.sky-canvas');

    // Pasting a link while the app is already open is a same-document hash
    // change — no reload — so this only works if the app listens for it.
    const shared = `${ORIGIN}/#at=-33.8688,151.2093,0&b=3&t=1768935600&v=40,180,25&l=Sydney`;
    await page.goto(shared);
    await page.waitForTimeout(600);
    expect(await page.textContent('.masthead-sub')).toBe('Sydney');

    // And a cold load of the same link lands in the same place.
    await page.goto(ORIGIN);
    await page.waitForSelector('canvas.sky-canvas');
    await page.goto(shared, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.sky-canvas');

    expect(await page.textContent('.masthead-sub')).toBe('Sydney');
    expect(await page.inputValue('input[type=range]')).toBe('3');
    // The hash the app writes back must describe the same place.
    const hash = decodeURIComponent(new URL(page.url()).hash);
    expect(hash).toContain('at=-33.8688,151.2093,0');
    expect(hash).toContain('v=40,180,25');

    await page.close();
  }, 60_000);

  it('works with the network cut — the whole point of bundling the catalogues', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const failures: string[] = [];

    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    page.on('requestfailed', (r) => failures.push(r.url()));
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('canvas.sky-canvas', { timeout: 20_000 });
    await page.waitForTimeout(2500);

    expect(await page.textContent('.masthead h1')).toBe('Sidereal');
    expect(await page.locator('canvas.ribbon-canvas').count()).toBe(1);
    expect(await page.locator('.event').count()).toBeGreaterThan(0);
    expect(failures).toEqual([]);

    await context.close();
  }, 90_000);

  it('has a night plan ready to print', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.sky-canvas');

    // Hidden on screen...
    expect(await page.locator('.night-plan').isVisible()).toBe(false);

    // ...and the only thing on the page in print.
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    expect(await page.locator('.night-plan').isVisible()).toBe(true);
    expect(await page.locator('canvas.sky-canvas').isVisible()).toBe(false);
    expect(await page.textContent('.night-plan h1')).toMatch(/^Night plan/);

    await page.close();
  }, 60_000);
});
