import { useEffect, useMemo, useState } from 'react';
import { FiltersContext, FORMAT_LABEL, href, loadPrefs, savePrefs, useApi, useRoute, type Filters, type Format } from './lib';
import type { Meta, Row } from './types';
import { Seg } from './components/ui';
import { Overview } from './pages/Overview';
import { Players } from './pages/Players';
import { Player } from './pages/Player';
import { Teams } from './pages/Teams';
import { Team } from './pages/Team';
import { Matchups } from './pages/Matchups';
import { Games } from './pages/Games';
import { Game } from './pages/Game';
import { Betting } from './pages/Betting';
import { Health } from './pages/Health';

const NAV: [string, string][] = [
  ['overview', 'Overview'], ['players', 'Players'], ['teams', 'Teams'], ['matchups', 'Matchups'],
  ['games', 'Games'], ['betting', 'Betting'], ['health', 'Data health'],
];

export function App() {
  const route = useRoute();
  const meta = useApi<Meta>('meta');
  const [filters, setFilters] = useState<Filters | null>(null);

  // initialise filters once meta arrives: saved prefs → latest completed season
  useEffect(() => {
    if (!meta.data || filters) return;
    const saved = loadPrefs();
    const seasons = new Set(meta.data.seasons.map((s) => s.season));
    const fallback = meta.data.latest?.season ?? meta.data.seasons[0]?.season ?? new Date().getFullYear();
    setFilters({
      season: saved.season && seasons.has(saved.season) ? saved.season : fallback,
      seasonType: saved.seasonType === 3 ? 3 : 2,
      format: saved.format ?? 'ppr',
    });
  }, [meta.data, filters]);

  const ctx = useMemo(() => filters && {
    ...filters,
    set: (f: Partial<Filters>) => setFilters((cur) => { const next = { ...cur!, ...f }; savePrefs(next); return next; }),
  }, [filters]);

  if (meta.error) return <div style={{ padding: 32 }}><div className="error">Couldn't reach the warehouse: {meta.error}</div></div>;
  if (!ctx || !meta.data) return <div style={{ padding: 32 }} className="muted">Connecting to the warehouse… (a paused serverless database can take up to a minute)</div>;

  const page = route.path[0];
  const id = Number(route.path[1]);
  const seasons = [...new Set(meta.data.seasons.map((s) => s.season))].sort((a, b) => b - a);

  return (
    <FiltersContext.Provider value={ctx}>
      <div className="app">
        <aside className="side">
          <div className="brand">NFL Analytics<small>Warehouse dashboard</small></div>
          <nav className="nav">
            {NAV.map(([k, label]) => (
              <a key={k} href={href(k)} className={page === k || (page === 'player' && k === 'players') || (page === 'team' && k === 'teams') || (page === 'game' && k === 'games') ? 'on' : ''}>{label}</a>
            ))}
          </nav>
          <div className="foot"><ThemeToggle /></div>
        </aside>
        <main className="main">
          <div className="filters">
            <label htmlFor="f-season">Season</label>
            <select id="f-season" value={ctx.season} onChange={(e) => ctx.set({ season: Number(e.target.value) })}>
              {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Seg value={ctx.seasonType} options={[[2, 'Regular'], [3, 'Postseason']]} onChange={(v) => ctx.set({ seasonType: v })} />
            <Seg<Format> value={ctx.format} options={(['standard', 'half_ppr', 'ppr'] as Format[]).map((f) => [f, FORMAT_LABEL[f]])} onChange={(v) => ctx.set({ format: v })} />
            <span className="grow" />
            <PlayerSearch />
          </div>
          {page === 'overview' && <Overview meta={meta.data} />}
          {page === 'players' && <Players />}
          {page === 'player' && <Player id={id} seasonHint={Number(route.query.get('season')) || undefined} />}
          {page === 'teams' && <Teams />}
          {page === 'team' && <Team id={id} />}
          {page === 'matchups' && <Matchups />}
          {page === 'games' && <Games week={Number(route.query.get('week')) || undefined} />}
          {page === 'game' && <Game id={id} />}
          {page === 'betting' && <Betting />}
          {page === 'health' && <Health />}
          {!NAV.some(([k]) => k === page) && !['player', 'team', 'game'].includes(page) && <p className="muted">Unknown page.</p>}
        </main>
      </div>
    </FiltersContext.Provider>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'auto');
  const cycle = () => {
    const next = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
    if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    try { localStorage.setItem('nfl-dash-theme', next); } catch { /* ignore */ }
    setTheme(next);
  };
  return <button onClick={cycle} title="Theme">Theme: {theme}</button>;
}

function PlayerSearch() {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const res = useApi<Row[]>(text.trim().length >= 2 ? `players/search?q=${encodeURIComponent(text.trim())}` : null);
  return (
    <div className="searchbox">
      <input type="search" placeholder="Find a player…" value={text} aria-label="Find a player"
             onChange={(e) => { setText(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && text.trim().length >= 2 && res.data && (
        <div className="results">
          {res.data.map((p) => (
            <a key={p.player_id} href={href(`player/${p.player_id}`)} onClick={() => { setText(''); setOpen(false); }}>
              <span>{p.first_name} {p.last_name}</span><span className="muted">{p.pos} {p.team ?? ''}</span>
            </a>
          ))}
          {!res.data.length && <div className="muted" style={{ padding: 8 }}>No matches</div>}
        </div>
      )}
    </div>
  );
}
