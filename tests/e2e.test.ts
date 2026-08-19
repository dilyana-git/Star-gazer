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
import { chromium, devices, type Browser } from 'playwright';

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

  it('keeps the desktop layout on a desktop viewport', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas.sky-canvas');

    expect(await page.locator('.controls').count()).toBe(1);
    expect(await page.locator('.phone').count()).toBe(0);
    await page.close();
  }, 60_000);

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

describe('the phone version', () => {
  const openPhone = async () => {
    const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));

    await page.goto(`${ORIGIN}/#at=42.6977,23.3219,550&b=4&t=1768939200&l=Sofia`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('canvas.sky-canvas', { timeout: 20_000 });
    await page.waitForTimeout(1800);
    return { context, page, problems };
  };

  it('serves a phone-first shell, not the desktop one squeezed', async () => {
    const { context, page, problems } = await openPhone();

    expect(await page.locator('.phone').count()).toBe(1);
    expect(await page.locator('.sheet').count()).toBe(1);
    // The desktop control bar and events column have no business here.
    expect(await page.locator('.controls').count()).toBe(0);
    expect(await page.locator('.stage').count()).toBe(0);
    expect(problems).toEqual([]);

    await context.close();
  }, 60_000);

  it('gives every control the 44px touch target the spec asks for', async () => {
    const { context, page } = await openPhone();

    const tooSmall = await page.evaluate(() => {
      const bad: string[] = [];
      const selectors = ['.phone-status', '.fab', '.sheet-grip'];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const r = el.getBoundingClientRect();
          if (r.height < 44 || r.width < 44) bad.push(`${selector} ${r.width}×${r.height}`);
        }
      }
      return bad;
    });
    expect(tooSmall).toEqual([]);

    await context.close();
  }, 60_000);

  it('cycles the sheet through its three positions on a tap', async () => {
    const { context, page } = await openPhone();
    const top = async () => (await page.locator('.sheet').boundingBox())!.y;

    const peek = await top();
    await page.tap('.sheet-grip');
    await page.waitForTimeout(500);
    const half = await top();
    await page.tap('.sheet-grip');
    await page.waitForTimeout(500);
    const full = await top();

    // Each tap lifts the sheet further up the screen...
    expect(half).toBeLessThan(peek - 50);
    expect(full).toBeLessThan(half - 50);
    expect(await page.locator('.event').count()).toBeGreaterThan(0);

    // ...and the third wraps back down, so one control does the whole job.
    await page.tap('.sheet-grip');
    await page.waitForTimeout(500);
    expect(await top()).toBeCloseTo(peek, -1);

    await context.close();
  }, 60_000);

  it('opens where-and-when from the status line', async () => {
    const { context, page } = await openPhone();

    await page.tap('.phone-status');
    await page.waitForSelector('.controls-sheet');
    expect(await page.textContent('.controls-sheet-head h2')).toBe('Where and when');

    await page.tap('.controls-close');
    await page.waitForTimeout(400);
    expect(await page.locator('.controls-sheet').count()).toBe(0);

    await context.close();
  }, 60_000);

  it('follows the handset when you point it at the sky', async () => {
    const { context, page, problems } = await openPhone();

    await page.tap('.fab-primary');
    await page.waitForTimeout(400);

    // Feed the sensor synthetically: alpha 225 is a bearing of 135 (south-east),
    // and beta 105 aims 15° above the horizon. The conversion itself is covered
    // by tests/orientation.test.ts; what is checked here is that it reaches the
    // view at all.
    await page.evaluate(() => {
      const fire = () => {
        const e = new Event('deviceorientationabsolute');
        Object.defineProperties(e, {
          alpha: { value: 225 },
          beta: { value: 105 },
          gamma: { value: 0 },
          absolute: { value: true },
        });
        window.dispatchEvent(e);
      };
      // Enough readings for the smoothing to settle.
      for (let i = 0; i < 80; i++) setTimeout(fire, i * 8);
    });
    await page.waitForTimeout(1400);

    expect(await page.getAttribute('.fab-primary', 'aria-pressed')).toBe('true');

    const view = /v=([^&]*)/.exec(decodeURIComponent(new URL(page.url()).hash))![1];
    const [altitude, azimuth, field] = view.split(',').map(Number);
    expect(altitude).toBeCloseTo(15, 0);
    expect(azimuth).toBeCloseTo(135, 0);
    // Pointing at a patch of sky zooms to a patch-sized field.
    expect(field).toBeLessThan(45);

    // Stopping returns to the whole sky.
    await page.tap('.fab-primary');
    await page.waitForTimeout(500);
    expect(await page.getAttribute('.fab-primary', 'aria-pressed')).toBe('false');
    expect(decodeURIComponent(new URL(page.url()).hash)).toContain('v=90,0,90');
    expect(problems).toEqual([]);

    await context.close();
  }, 90_000);
});
