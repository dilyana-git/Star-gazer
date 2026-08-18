import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emit a service worker that precaches the app shell and the astronomical data,
 * so Sidereal genuinely works with no network at all — which is the point of
 * bundling every catalogue in the first place (spec §0, §3).
 *
 * The precache list is generated from the real bundle rather than hand-written,
 * because Vite hashes its filenames and a hand-written list would go stale on
 * the first rebuild. The cities list is deliberately left out: it is 1.3 MB and
 * only needed if somebody opens the location search, so it is cached on use
 * instead of on install.
 */
function serviceWorker(): Plugin {
  const RUNTIME_ONLY = /cities/;

  return {
    name: 'sidereal-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => !RUNTIME_ONLY.test(name))
        .map((name) => `/${name}`);

      // Files in public/ never reach the bundle, so they are listed directly.
      const fonts = readdirSync(join(process.cwd(), 'public', 'fonts'))
        .filter((f) => f.endsWith('.woff2') || f.endsWith('.css'))
        .map((f) => `/fonts/${f}`);

      // The HTML is emitted outside this hook, so it is listed by hand. Both
      // forms: '/' is what a navigation asks for, '/index.html' is what a
      // static host may resolve it to.
      const precache = [
        '/',
        '/index.html',
        ...assets,
        ...fonts,
        '/manifest.webmanifest',
        '/favicon.svg',
        '/icon.svg',
      ];
      const version = createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 12);

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(version, precache) });
    },
  };
}

function workerSource(version: string, precache: string[]): string {
  return `/* Generated at build time by vite.config.ts — do not edit. */
const CACHE = 'sidereal-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one 404 does not fail the whole install.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // \`ignoreVary\` is not optional. Most static hosts send \`Vary: Origin\` (Vite's
  // own preview server does), and the Cache API then refuses to match a stored
  // response against a request whose Origin header differs — which is exactly
  // what happens between the fetch that filled the cache and the parser-issued
  // requests that read it. Without this the whole offline guarantee silently
  // evaporates on any such host.
  const lookup = (req) => caches.match(req, { ignoreVary: true });

  // Navigations fall back to the cached shell, so a cold start with no network
  // still opens the app rather than the browser's offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => lookup(request).then((hit) => hit || lookup('/'))),
    );
    return;
  }

  // Everything else is cache-first: the catalogues never change without a new
  // build, and a new build means a new cache name.
  event.respondWith(
    lookup(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
`;
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
});
