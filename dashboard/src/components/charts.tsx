/**
 * charts.tsx — small SVG chart kit following the dataviz method:
 * 2px lines, ≤24px bars with 4px rounded data-ends, hairline solid grid,
 * crosshair tooltip on lines, per-mark tooltip on bars/dots, legend for ≥2
 * series, text in ink tokens (never series colors), one y-axis only.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Clean axis ticks: ~`count` round numbers whose range fully covers [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (hi === lo) { hi = lo + 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}K` : `${+v.toFixed(2)}`);

interface Tip { x: number; y: number; content: ReactNode }
function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = tip.x > width - 180 ? tip.x - 170 : tip.x + 14;
  return <div className="tip" style={{ left, top: Math.max(0, tip.y - 10) }}>{tip.content}</div>;
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'line' | 'rect'; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i className={it.kind ?? 'line'} style={{ background: it.dashed ? `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)` : it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- line chart */
export interface LineSeries { name: string; color: string; values: (number | null)[]; dashed?: boolean; dots?: boolean }

export function LineChart({
  x, series, height = 240, yFormat = (v: number) => compact(v), xTitle, refLine, yDomain, tipTitle, xTicks,
}: {
  x: string[]; series: LineSeries[]; height?: number; yFormat?: (v: number) => string; xTitle?: string;
  refLine?: { value: number; label: string }; yDomain?: [number, number];
  tipTitle?: (i: number) => ReactNode;
  /** label only these x indices (e.g. the first play of each quarter) */
  xTicks?: number[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 10, r: 16, b: xTitle ? 38 : 24, l: 44 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (refLine) all.push(refLine.value);
  const lo = yDomain?.[0] ?? Math.min(0, ...all), hi = yDomain?.[1] ?? Math.max(1, ...all);
  const yt = ticks(lo, hi);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const sx = (i: number) => (x.length <= 1 ? iw / 2 : (i / (x.length - 1)) * iw);
  const sy = (v: number) => ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const path = (vals: (number | null)[]) => {
    let d = ''; let pen = false;
    vals.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`; pen = true;
    });
    return d;
  };
  const xEvery = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor(iw / 48))));
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / iw) * (x.length - 1));
    setHover(Math.max(0, Math.min(x.length - 1, i)));
  };
  return (
    <div className="chart" ref={ref}>
      {series.length >= 2 && <Legend items={series.map((s) => ({ label: s.name, color: s.color, dashed: s.dashed }))} />}
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        <g transform={`translate(${m.l},${m.t})`}>
          {yt.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'baseline' : 'gridline'} x1={0} x2={iw} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={-8} y={sy(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          {x.map((lab, i) => (xTicks ? xTicks.includes(i) : (i % xEvery === 0 || i === x.length - 1)) && (
            <text key={i} className="tick" x={sx(i)} y={ih + 16} textAnchor={xTicks ? 'start' : 'middle'}>{lab}</text>
          ))}
          {xTitle && <text className="tick" x={iw / 2} y={ih + 32} textAnchor="middle">{xTitle}</text>}
          {refLine && (
            <g>
              <line x1={0} x2={iw} y1={sy(refLine.value)} y2={sy(refLine.value)} stroke="var(--axis)" strokeWidth={1} />
              <text className="dlabel" x={iw} y={sy(refLine.value) - 5} textAnchor="end">{refLine.label}</text>
            </g>
          )}
          {series.map((s) => (
            <g key={s.name}>
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                    strokeDasharray={s.dashed ? '5 4' : undefined} />
              {s.dots && s.values.map((v, i) => v !== null && (
                <circle key={i} cx={sx(i)} cy={sy(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={sx(hover)} x2={sx(hover)} y1={0} y2={ih} stroke="var(--axis)" strokeWidth={1} />
              {series.map((s) => s.values[hover] !== null && (
                <circle key={s.name} cx={sx(hover)} cy={sy(s.values[hover] as number)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={-8} y={0} width={iw + 16} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      <Tooltip width={width} tip={hover === null ? null : {
        x: m.l + sx(hover), y: m.t,
        content: (
          <>
            <div className="t">{tipTitle ? tipTitle(hover) : x[hover]}</div>
            {series.map((s) => (
              <div className="row" key={s.name}><i className="key" style={{ background: s.color }} /><b>{s.values[hover] === null ? '—' : yFormat(s.values[hover] as number)}</b><span>{s.name}</span></div>
            ))}
          </>
        ),
      }} />
    </div>
  );
}

/* ---------------------------------------------------------------- column chart */
export interface Column { label: string; value: number | null; tip?: ReactNode; onClick?: () => void }

/** Vertical columns from a zero baseline. diverging=true colors by sign (blue +, red −). */
export function ColumnChart({ data, height = 200, diverging = false, color = 'var(--s1)', yFormat = (v: number) => compact(v), showValues = false }: {
  data: Column[]; height?: number; diverging?: boolean; color?: string; yFormat?: (v: number) => string; showValues?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const m = { t: showValues ? 16 : 8, r: 8, b: 22, l: 40 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const vals = data.map((d) => d.value ?? 0);
  const yt = ticks(Math.min(0, ...vals), Math.max(0.001, ...vals));
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const sy = (v: number) => ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(3, band - 2));
  const xEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 34))));
  const bar = (x: number, v: number) => {
    const top = sy(Math.max(v, 0)), bot = sy(Math.min(v, 0));
    const h = Math.max(1, bot - top), r = Math.min(4, h / 2, bw / 2);
    // round only the data end; square at the baseline
    return v >= 0
      ? `M${x},${bot} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${bot} Z`
      : `M${x},${top} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + bw - r} Q${x + bw},${bot} ${x + bw},${bot - r} V${top} Z`;
  };
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height}>
        <g transform={`translate(${m.l},${m.t})`}>
          {yt.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'baseline' : 'gridline'} x1={0} x2={iw} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={-8} y={sy(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * band + (band - bw) / 2;
            const v = d.value;
            return (
              <g key={i}>
                {v !== null && (
                  <path d={bar(x, v)} fill={diverging ? (v >= 0 ? 'var(--pos)' : 'var(--neg)') : color}
                        opacity={hot === i ? 0.75 : 1} />
                )}
                {showValues && v !== null && (
                  <text className="dlabel" x={x + bw / 2} y={v >= 0 ? sy(v) - 4 : sy(v) + 12} textAnchor="middle">{yFormat(v)}</text>
                )}
                {(i % xEvery === 0) && <text className="tick" x={x + bw / 2} y={ih + 15} textAnchor="middle">{d.label}</text>}
                <rect x={i * band} y={0} width={band} height={ih} fill="transparent" style={{ cursor: d.onClick ? 'pointer' : undefined }}
                      onClick={d.onClick}
                      onPointerMove={() => {
                        setHot(i);
                        setTip({ x: m.l + x + bw, y: m.t + sy(Math.max(v ?? 0, 0)), content: d.tip ?? <><div className="t">{d.label}</div><div className="row"><b>{v === null ? '—' : yFormat(v)}</b></div></> });
                      }}
                      onPointerLeave={() => { setHot(null); setTip(null); }} />
              </g>
            );
          })}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* ---------------------------------------------------------------- horizontal bars */
export function BarList({ data, format = (v: number) => compact(v), diverging = false, max }: {
  data: { label: ReactNode; value: number | null; key: string | number; tip?: string }[];
  format?: (v: number) => string; diverging?: boolean; max?: number;
}) {
  const m = max ?? Math.max(0.0001, ...data.map((d) => Math.abs(d.value ?? 0)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 10px', alignItems: 'center' }}>
      {data.map((d) => {
        const v = d.value ?? 0;
        const w = `${(Math.abs(v) / m) * (diverging ? 50 : 100)}%`;
        return (
          <div key={d.key} style={{ display: 'contents' }} title={d.tip}>
            <div style={{ whiteSpace: 'nowrap' }}>{d.label}</div>
            <div style={{ position: 'relative', height: 12 }}>
              {diverging && <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--axis)' }} />}
              <div style={{
                position: 'absolute', top: 1, height: 10,
                ...(diverging
                  ? (v >= 0 ? { left: '50%', width: w, borderRadius: '0 4px 4px 0', background: 'var(--pos)' }
                            : { right: '50%', width: w, borderRadius: '4px 0 0 4px', background: 'var(--neg)' })
                  : { left: 0, width: w, borderRadius: '0 4px 4px 0', background: 'var(--s1)' }),
              }} />
            </div>
            <div style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: 'var(--text-2)' }}>{d.value === null ? '—' : format(d.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- scatter */
export interface Pt { x: number; y: number; label: string; tip: ReactNode; onClick?: () => void }

/** Labeled scatter with league-average crosshairs. invertY puts lower values at the top. */
export function Scatter({ points, height = 380, xLabel, yLabel, invertY = false, fmt = (v: number) => v.toFixed(1) }: {
  points: Pt[]; height?: number; xLabel: string; yLabel: string; invertY?: boolean; fmt?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const m = { t: 12, r: 24, b: 40, l: 50 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  if (!points.length) return <div ref={ref} className="muted">No data.</div>;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const pad = (a: number[]) => { const lo = Math.min(...a), hi = Math.max(...a), d = (hi - lo) * 0.08 || 0.5; return [lo - d, hi + d]; };
  const [xl, xh] = pad(xs), [yl, yh] = pad(ys);
  const sx = (v: number) => ((v - xl) / (xh - xl)) * iw;
  const sy = (v: number) => (invertY ? ((v - yl) / (yh - yl)) * ih : ih - ((v - yl) / (yh - yl)) * ih);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  // place each label at the first candidate spot that doesn't overlap a placed label or another dot
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const hit = (b: { x: number; y: number; w: number; h: number }) =>
    placed.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    || points.some((q) => sx(q.x) > b.x - 4 && sx(q.x) < b.x + b.w + 4 && sy(q.y) > b.y - 4 && sy(q.y) < b.y + b.h + 4);
  const labelPos = [...points].sort((a, b) => sx(a.x) - sx(b.x)).reduce<Record<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>>((acc, p) => {
    const px = sx(p.x), py = sy(p.y), w = p.label.length * 6.6 + 2, h = 12;
    const cands = [
      { x: px + 7, y: py - h / 2, anchor: 'start' as const, tx: px + 7, ty: py },
      { x: px - 7 - w, y: py - h / 2, anchor: 'end' as const, tx: px - 7, ty: py },
      { x: px - w / 2, y: py - 8 - h, anchor: 'middle' as const, tx: px, ty: py - 13 },
      { x: px - w / 2, y: py + 8, anchor: 'middle' as const, tx: px, ty: py + 14 },
    ];
    const c = cands.find((b) => !hit({ x: b.x, y: b.y, w, h })) ?? cands[0];
    placed.push({ x: c.x, y: c.y, w, h });
    acc[p.label] = { x: c.tx, y: c.ty, anchor: c.anchor };
    return acc;
  }, {});
  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks(xl, xh, 6).filter((t) => t >= xl && t <= xh).map((t) => (
            <g key={`x${t}`}><line className="gridline" x1={sx(t)} x2={sx(t)} y1={0} y2={ih} /><text className="tick" x={sx(t)} y={ih + 16} textAnchor="middle">{fmt(t)}</text></g>
          ))}
          {ticks(yl, yh, 5).filter((t) => t >= yl && t <= yh).map((t) => (
            <g key={`y${t}`}><line className="gridline" x1={0} x2={iw} y1={sy(t)} y2={sy(t)} /><text className="tick" x={-8} y={sy(t)} dy="0.32em" textAnchor="end">{fmt(t)}</text></g>
          ))}
          <line className="baseline" x1={sx(mx)} x2={sx(mx)} y1={0} y2={ih} />
          <line className="baseline" x1={0} x2={iw} y1={sy(my)} y2={sy(my)} />
          <text className="tick" x={iw / 2} y={ih + 34} textAnchor="middle">{xLabel}</text>
          <text className="tick" transform={`translate(${-38},${ih / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
          {points.map((p) => (
            <g key={p.label} style={{ cursor: p.onClick ? 'pointer' : undefined }} onClick={p.onClick}
               onPointerMove={() => setTip({ x: m.l + sx(p.x), y: m.t + sy(p.y), content: p.tip })} onPointerLeave={() => setTip(null)}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" />
              <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
              <text className="dlabel" x={labelPos[p.label].x} y={labelPos[p.label].y} dy="0.32em" textAnchor={labelPos[p.label].anchor}>{p.label}</text>
            </g>
          ))}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/* ---------------------------------------------------------------- diverging cell color */
/** Background for a heat cell: t in [-1, 1] → red arm … neutral … blue arm. */
export function divergingFill(t: number): { background: string; strong: boolean } {
  const c = Math.max(-1, Math.min(1, t));
  const pctMix = Math.round(Math.abs(c) * 85);
  const arm = c >= 0 ? 'var(--neg)' : 'var(--pos)';
  return { background: `color-mix(in oklab, ${arm} ${pctMix}%, var(--mid))`, strong: Math.abs(c) > 0.6 };
}

/* ---------------------------------------------------------------- grouped columns */
/** Categories on x, up to 4 series side by side per category (fixed slot order). */
export function GroupedColumns({ x, series, height = 240, yFormat = (v: number) => compact(v) }: {
  x: string[]; series: { name: string; values: (number | null)[] }[]; height?: number; yFormat?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const m = { t: 8, r: 8, b: 22, l: 40 };
  const iw = width - m.l - m.r, ih = height - m.t - m.b;
  const vals = series.flatMap((s) => s.values.map((v) => v ?? 0));
  const yt = ticks(Math.min(0, ...vals), Math.max(0.001, ...vals));
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const sy = (v: number) => ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  const band = iw / Math.max(1, x.length);
  const bw = Math.min(24, Math.max(3, (band - 8) / series.length - 2));
  const groupW = series.length * (bw + 2) - 2;
  const xEvery = Math.max(1, Math.ceil(x.length / Math.max(2, Math.floor(iw / 40))));
  return (
    <div className="chart" ref={ref}>
      {series.length >= 2 && <Legend items={series.map((s, i) => ({ label: s.name, color: SERIES[i], kind: 'rect' as const }))} />}
      <svg width={width} height={height}>
        <g transform={`translate(${m.l},${m.t})`}>
          {yt.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'baseline' : 'gridline'} x1={0} x2={iw} y1={sy(t)} y2={sy(t)} />
              <text className="tick" x={-8} y={sy(t)} dy="0.32em" textAnchor="end">{yFormat(t)}</text>
            </g>
          ))}
          {x.map((lab, i) => {
            const gx = i * band + (band - groupW) / 2;
            return (
              <g key={i}>
                {series.map((s, j) => {
                  const v = s.values[i];
                  if (v === null || v === undefined) return null;
                  const top = sy(Math.max(v, 0)), bot = sy(Math.min(v, 0));
                  const h = Math.max(1, bot - top), r = Math.min(4, h / 2, bw / 2), bx = gx + j * (bw + 2);
                  const d = v >= 0
                    ? `M${bx},${bot} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${bot} Z`
                    : `M${bx},${top} V${bot - r} Q${bx},${bot} ${bx + r},${bot} H${bx + bw - r} Q${bx + bw},${bot} ${bx + bw},${bot - r} V${top} Z`;
                  return <path key={j} d={d} fill={SERIES[j]} opacity={hot === i ? 0.8 : 1} />;
                })}
                {i % xEvery === 0 && <text className="tick" x={i * band + band / 2} y={ih + 15} textAnchor="middle">{lab}</text>}
                <rect x={i * band} y={0} width={band} height={ih} fill="transparent"
                  onPointerMove={() => { setHot(i); setTip({ x: m.l + gx + groupW, y: m.t + 10, content: (
                    <><div className="t">{lab}</div>{series.map((s, j) => (
                      <div className="row" key={s.name}><i className="key" style={{ background: SERIES[j] }} /><b>{s.values[i] === null ? '—' : yFormat(s.values[i] as number)}</b><span>{s.name}</span></div>
                    ))}</>) }); }}
                  onPointerLeave={() => { setHot(null); setTip(null); }} />
              </g>
            );
          })}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
