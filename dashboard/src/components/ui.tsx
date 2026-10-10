import { useMemo, useState, type ReactNode } from 'react';
import { href, name as fullName, type Num } from '../lib';

export function Card({ title, children, className = '', right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          {title ? <h2>{title}</h2> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Tile({ label, value, delta, deltaGood }: { label: string; value: ReactNode; delta?: ReactNode; deltaGood?: boolean | null }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta !== undefined && (
        <div className={`delta ${deltaGood === true ? 'up' : deltaGood === false ? 'down' : ''}`}>{delta}</div>
      )}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

export function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="error section">Couldn't load data: {error}</div>;
}

export function Loading({ show }: { show: boolean }) {
  return show ? <p className="muted">Loading…</p> : null;
}

export function PlayerLink({ id, first_name, last_name, season }: { id: number; first_name?: string | null; last_name?: string | null; season?: number }) {
  return <a className="link" href={href(`player/${id}`, { season })}>{fullName({ first_name, last_name })}</a>;
}

export function TeamLink({ id, abbr, season }: { id: number; abbr: string; season?: number }) {
  return <a className="link" href={href(`team/${id}`, { season })}>{abbr}</a>;
}

export function Pos({ pos }: { pos?: string | null }) {
  return <span className="pos">{pos ?? ''}</span>;
}

/* ---------------------------------------------------------------- sortable table */
export interface Col<R> {
  key: string;
  label: ReactNode;
  left?: boolean;
  render?: (r: R) => ReactNode;
  value?: (r: R) => Num | string;      // sort value; defaults to r[key]
  title?: string;                      // header tooltip (definition)
}

export function DataTable<R extends Record<string, any>>({
  rows, cols, sort: initialSort, desc: initialDesc = true, maxHeight, rowKey, onSort,
}: {
  rows: R[]; cols: Col<R>[]; sort?: string; desc?: boolean; maxHeight?: number;
  rowKey?: (r: R, i: number) => string | number;
  /** server-side sorting: when provided, clicks call this instead of sorting locally */
  onSort?: (key: string, desc: boolean) => void;
}) {
  const [sort, setSort] = useState(initialSort);
  const [desc, setDesc] = useState(initialDesc);
  const sorted = useMemo(() => {
    if (!sort || onSort) return rows;
    const col = cols.find((c) => c.key === sort);
    const val = (r: R) => (col?.value ? col.value(r) : r[sort]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x as number) - (y as number);
      return desc ? -c : c;
    });
  }, [rows, cols, sort, desc, onSort]);
  const click = (k: string) => {
    const nd = k === sort ? !desc : true;
    setSort(k); setDesc(nd);
    onSort?.(k, nd);
  };
  return (
    <div className="scroll" style={maxHeight ? { maxHeight } : { maxHeight: 'none' }}>
      <table className="dt">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`${c.left ? 'l' : ''} ${c.key === sort ? 'on' : ''}`} title={c.title}
                  onClick={() => click(c.key)} aria-sort={c.key === sort ? (desc ? 'descending' : 'ascending') : 'none'}>
                {c.label}{c.key === sort ? (desc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {cols.map((c) => (
                <td key={c.key} className={c.left ? 'l' : ''}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
          {!sorted.length && <tr><td className="l muted" colSpan={cols.length}>No rows.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Inline magnitude bar for table cells (single hue, scaled to the column max). */
export function CellBar({ value, max, text }: { value: Num; max: number; text: ReactNode }) {
  const w = value && max > 0 ? Math.max(2, Math.round(56 * value / max)) : 0;
  return <span><span className="bar-cell" style={{ width: w }} />{text}</span>;
}
