/**
 * api.ts — rate-limited BALLDONTLIE NFL client.
 * - Sliding-window rate limiter (default 550/min; GOAT allows 600, keep headroom).
 * - Retries on 429/5xx with backoff.
 * - Cursor pagination as an async generator.
 */
import { config } from './config';

const WINDOW_MS = 60_000;
const stamps: number[] = [];

async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length < config.rateLimitPerMin) {
      stamps.push(now);
      return;
    }
    const wait = WINDOW_MS - (now - stamps[0]) + 50;
    await sleep(wait);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ApiPage<T> {
  data: T[];
  meta?: { next_cursor?: number | null; per_page?: number };
}

export type Params = Record<string, string | number | boolean | Array<string | number> | undefined>;

function buildUrl(path: string, params: Params): string {
  const url = new URL(config.baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      const key = k.endsWith('[]') ? k : `${k}[]`;
      for (const item of v) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function get<T>(path: string, params: Params = {}): Promise<ApiPage<T>> {
  const url = buildUrl(path, params);
  let attempt = 0;
  for (;;) {
    await acquire();
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: config.apiKey } });
    } catch (err) {
      if (++attempt > config.maxRetries) throw err;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.status === 429) {
      attempt++;
      const wait = Number(res.headers.get('retry-after')) * 1000 || 15_000;
      console.warn(`429 rate limited; waiting ${wait}ms (${url})`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500) {
      if (++attempt > config.maxRetries) throw new Error(`${res.status} after ${attempt} attempts: ${url}`);
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status} for ${url}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as ApiPage<T>;
  }
}

/** Iterate every page of a cursor-paginated endpoint. */
export async function* paginate<T>(path: string, params: Params = {}, perPage = 100): AsyncGenerator<T[]> {
  let cursor: number | undefined;
  for (;;) {
    const page = await get<T>(path, { ...params, per_page: perPage, cursor });
    if (page.data?.length) yield page.data;
    const next = page.meta?.next_cursor;
    if (next === undefined || next === null) return;
    cursor = next;
  }
}
