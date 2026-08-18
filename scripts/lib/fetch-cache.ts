/**
 * Tiny download cache for the catalog build. Sources are fetched once into
 * `.cache/` (git-ignored) so re-running the build is fast and offline-friendly.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = join(process.cwd(), '.cache');

export async function fetchText(url: string): Promise<string> {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const ext = url.split('?')[0].split('.').pop() ?? 'txt';
  const file = join(CACHE_DIR, `${key}.${ext.length <= 5 ? ext : 'txt'}`);

  if (existsSync(file)) return readFile(file, 'utf8');

  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = await res.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, body);
  return body;
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}
