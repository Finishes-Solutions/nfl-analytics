import { useMemo, useState } from 'react';
import { FORMAT_LABEL, href, n1, qs, signed, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { divergingFill } from '../components/charts';
import { Card, ErrorBox } from '../components/ui';

const POS = ['QB', 'RB', 'WR', 'TE', 'PK'];

export function Matchups() {
  const f = useFilters();
  const { data, error, loading } = useApi<{ rows: Row[]; league: Row[] }>(`matchups?${qs({ season: f.season, season_type: f.seasonType, format: f.format })}`);
  const [sortPos, setSortPos] = useState('WR');
  const avg = useMemo(() => Object.fromEntries((data?.league ?? []).map((l) => [l.pos, Number(l.league_avg)])), [data]);
  const defenses = useMemo(() => {
    const m = new Map<number, { id: number; team: string; cells: Record<string, Row> }>();
    for (const r of data?.rows ?? []) {
      if (!m.has(r.defense_team_id)) m.set(r.defense_team_id, { id: r.defense_team_id, team: r.defense, cells: {} });
      m.get(r.defense_team_id)!.cells[r.pos] = r;
    }
    return [...m.values()].sort((a, b) => (b.cells[sortPos]?.fp_allowed_pg ?? -1) - (a.cells[sortPos]?.fp_allowed_pg ?? -1));
  }, [data, sortPos]);
  // scale each position by its own spread so QB and PK columns are comparable
  const spread = useMemo(() => Object.fromEntries(POS.map((p) => {
    const d = defenses.map((x) => x.cells[p]?.fp_allowed_pg).filter((v): v is number => typeof v === 'number').map((v) => Math.abs(v - avg[p]));
    return [p, Math.max(0.5, ...d)];
  })), [defenses, avg]);

  return (
    <div className={loading ? 'loading' : ''}>
      <h1>Matchups</h1>
      <p className="sub">{FORMAT_LABEL[f.format]} points allowed per game by each defense to each position. Click a column header to sort.</p>
      <ErrorBox error={error} />
      <Card className="flush">
        <div style={{ display: 'flex', gap: 18, padding: '12px 18px', alignItems: 'center', fontSize: 12, color: 'var(--text-2)' }}>
          <span>Tougher matchup</span>
          <span style={{ display: 'inline-flex' }}>
            {[-1, -0.5, 0, 0.5, 1].map((t) => <i key={t} style={{ width: 28, height: 10, background: divergingFill(t).background, display: 'inline-block' }} />)}
          </span>
          <span>Softer matchup (allows more than league average)</span>
        </div>
        <div className="scroll" style={{ maxHeight: 820 }}>
          <table className="dt heat">
            <thead>
              <tr>
                <th className="l">Defense</th>
                {POS.map((p) => (
                  <th key={p} className={p === sortPos ? 'on' : ''} onClick={() => setSortPos(p)} style={{ textAlign: 'center' }}>
                    {p}{p === sortPos ? ' ↓' : ''}<div className="muted" style={{ fontWeight: 400 }}>avg {n1(avg[p])}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {defenses.map((d) => (
                <tr key={d.id}>
                  <td className="l"><a className="link" href={href(`team/${d.id}`)}>{d.team}</a></td>
                  {POS.map((p) => {
                    const c = d.cells[p];
                    if (!c) return <td key={p} className="cell muted">—</td>;
                    const delta = c.fp_allowed_pg - avg[p];
                    const fill = divergingFill(delta / spread[p]);
                    return (
                      <td key={p} className={`cell ${fill.strong ? 'dark-ink' : ''}`} style={{ background: fill.background }}
                          title={`${d.team} vs ${p}: ${n1(c.fp_allowed_pg)}/game (${signed(delta)} vs avg) over ${c.games} games`}>
                        {n1(c.fp_allowed_pg)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="note">Each column is colored against its own league average and spread. Small samples early in a season swing hard — check the games count in the hover.</p>
    </div>
  );
}
