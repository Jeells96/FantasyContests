/** Small fetch helper: timeout, retry with backoff, in-memory caching and a
 *  concurrency gate so building a player pool never fires hundreds of parallel
 *  requests at a public API. */

const cache = new Map<string, { at: number; value: unknown }>();

export interface GetJsonOptions {
  /** Serve from the in-memory cache when the entry is younger than this (ms). */
  cacheMs?: number;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Some networks only let a recognized client through to the public feeds, so
 * the CLI workers can be given a user agent with FEED_USER_AGENT. Browsers
 * send their own and ignore this.
 */
const NODE_HEADERS: Record<string, string> = (() => {
  if (typeof window !== 'undefined') return {};
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const agent = env?.FEED_USER_AGENT;
  return agent ? { 'user-agent': agent } : ({} as Record<string, string>);
})();

export async function getJson<T>(url: string, options: GetJsonOptions = {}): Promise<T> {
  const { cacheMs = 0, timeoutMs = 15000, retries = 2 } = options;
  if (cacheMs > 0) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value as T;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', ...NODE_HEADERS } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const value = (await response.json()) as T;
      if (cacheMs > 0) cache.set(url, { at: Date.now(), value });
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run tasks with bounded concurrency, keeping result order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Like mapLimit but a failing task yields null instead of rejecting. */
export async function mapLimitSettled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  return mapLimit(items, limit, async (item, index) => {
    try {
      return await worker(item, index);
    } catch {
      return null;
    }
  });
}

/** Parse ESPN-style values: "20/34", "2-9", "31:22", "6.0", "+26", "-". */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed === '--') return 0;
  const cleaned = trimmed.replace(/[+,]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Split composite feed values such as "20/34" or "2-9" into their parts. */
export function splitComposite(value: string): number[] {
  return value
    .split(/[/-]/)
    .map((part) => toNumber(part))
    .filter((n) => Number.isFinite(n));
}
