/* Shared client plumbing: hash router, global filters, data fetching, formatting. */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

/* ---------------------------------------------------------------- routing */
export interface Route { path: string[]; query: URLSearchParams }

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [p, qs = ''] = raw.split('?');
  return { path: p ? p.split('/').filter(Boolean) : ['overview'], query: new URLSearchParams(qs) };
}

const subscribe = (cb: () => void) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
const snapshot = () => window.location.hash;

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => parseHash(), [hash]);
}

export function href(path: string, params: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `#/${path}${s ? `?${s}` : ''}`;
}

/* ---------------------------------------------------------------- global filters */
export type Format = 'standard' | 'half_ppr' | 'ppr';
export interface Filters { season: number; seasonType: 2 | 3; format: Format }
export interface FilterCtx extends Filters { set: (f: Partial<Filters>) => void }
export const FiltersContext = createContext<FilterCtx>(null as unknown as FilterCtx);
export const useFilters = () => useContext(FiltersContext);

export const FORMAT_LABEL: Record<Format, string> = { standard: 'Standard', half_ppr: 'Half PPR', ppr: 'PPR' };
export const SEASON_TYPE_LABEL: Record<number, string> = { 1: 'Preseason', 2: 'Regular season', 3: 'Postseason' };

export function loadPrefs(): Partial<Filters> {
  try { return JSON.parse(localStorage.getItem('nfl-dash-filters') ?? '{}'); } catch { return {}; }
}
export function savePrefs(f: Filters): void {
  try { localStorage.setItem('nfl-dash-filters', JSON.stringify(f)); } catch { /* private mode */ }
}

/* ---------------------------------------------------------------- data */
export interface ApiState<T> { data: T | undefined; error: string | undefined; loading: boolean }

/** Fetch JSON from the API. Keeps the previous data while refetching (no layout jump). */
export function useApi<T>(path: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ data: undefined, error: undefined, loading: !!path });
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetch(`/api/${path}`, { credentials: 'same-origin' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        return body as T;
      })
      .then((data) => { if (my === seq.current) setState({ data, error: undefined, loading: false }); })
      .catch((e: Error) => { if (my === seq.current) setState((s) => ({ ...s, error: e.message, loading: false })); });
  }, [path]);
  return state;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  return u.toString();
}

/* ---------------------------------------------------------------- formatting */
export type Num = number | null | undefined;
export const n0 = (v: Num) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString());
export const n1 = (v: Num) => (v === null || v === undefined ? '—' : v.toFixed(1));
export const n2 = (v: Num) => (v === null || v === undefined ? '—' : v.toFixed(2));
export const pct = (v: Num, d = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
export const signed = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);
export const spread = (v: Num) => (v === null || v === undefined ? '—' : v === 0 ? 'PK' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
export const name = (r: { first_name?: string | null; last_name?: string | null }) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
export const shortName = (r: { first_name?: string | null; last_name?: string | null }) =>
  `${(r.first_name ?? '').slice(0, 1)}. ${r.last_name ?? ''}`.trim();
export function dateShort(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function ago(hours: Num): string {
  if (hours === null || hours === undefined) return 'never';
  if (hours < 1) return 'within the hour';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
