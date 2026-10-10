#!/usr/bin/env python3
"""
gen_dev_data.py — deterministic SYNTHETIC warehouse data for local development.

Writes a .sql file that wipes and fills a *dev* database with four seasons of
plausible-but-fake NFL data: 32 teams (real names/abbreviations so the UI looks
familiar), ~350 invented players, full schedules + playoffs, box scores, team
stats, standings, play-by-play with win probability, advanced stats, odds,
player props, injuries, and sync metadata.

Every player name is invented. Nothing here is real football data — it exists
so the dashboard, views, and tests can be exercised without the live warehouse.

    python3 tools/gen_dev_data.py > /tmp/dev_data.sql
    (cd ingestion && npx tsx src/run-sql.ts apply /tmp/dev_data.sql)

Safety: the first batch THROWs unless DB_NAME() ends in "_dev", so pointing
this at production fails before anything is deleted.
"""
import math
import random
import sys
from datetime import datetime, timedelta

SEED = 20261010
R = random.Random(SEED)

SEASONS = [2023, 2024, 2025, 2026]
CURRENT_SEASON = 2026
CURRENT_WEEKS_PLAYED = 5          # 2026 weeks 1-5 final, week 6 scheduled
NOW = datetime(2026, 10, 10, 8, 0, 0)

TEAMS = [
    # id, conf, div, location, name, abbr
    (1, 'AFC', 'EAST', 'Buffalo', 'Bills', 'BUF'), (2, 'AFC', 'EAST', 'Miami', 'Dolphins', 'MIA'),
    (3, 'AFC', 'EAST', 'New England', 'Patriots', 'NE'), (4, 'AFC', 'EAST', 'New York', 'Jets', 'NYJ'),
    (5, 'AFC', 'NORTH', 'Baltimore', 'Ravens', 'BAL'), (6, 'AFC', 'NORTH', 'Cincinnati', 'Bengals', 'CIN'),
    (7, 'AFC', 'NORTH', 'Cleveland', 'Browns', 'CLE'), (8, 'AFC', 'NORTH', 'Pittsburgh', 'Steelers', 'PIT'),
    (9, 'AFC', 'SOUTH', 'Houston', 'Texans', 'HOU'), (10, 'AFC', 'SOUTH', 'Indianapolis', 'Colts', 'IND'),
    (11, 'AFC', 'SOUTH', 'Jacksonville', 'Jaguars', 'JAX'), (12, 'AFC', 'SOUTH', 'Tennessee', 'Titans', 'TEN'),
    (13, 'AFC', 'WEST', 'Denver', 'Broncos', 'DEN'), (14, 'AFC', 'WEST', 'Kansas City', 'Chiefs', 'KC'),
    (15, 'AFC', 'WEST', 'Las Vegas', 'Raiders', 'LV'), (16, 'AFC', 'WEST', 'Los Angeles', 'Chargers', 'LAC'),
    (17, 'NFC', 'EAST', 'Dallas', 'Cowboys', 'DAL'), (18, 'NFC', 'EAST', 'New York', 'Giants', 'NYG'),
    (19, 'NFC', 'EAST', 'Philadelphia', 'Eagles', 'PHI'), (20, 'NFC', 'EAST', 'Washington', 'Commanders', 'WSH'),
    (21, 'NFC', 'NORTH', 'Chicago', 'Bears', 'CHI'), (22, 'NFC', 'NORTH', 'Detroit', 'Lions', 'DET'),
    (23, 'NFC', 'NORTH', 'Green Bay', 'Packers', 'GB'), (24, 'NFC', 'NORTH', 'Minnesota', 'Vikings', 'MIN'),
    (25, 'NFC', 'SOUTH', 'Atlanta', 'Falcons', 'ATL'), (26, 'NFC', 'SOUTH', 'Carolina', 'Panthers', 'CAR'),
    (27, 'NFC', 'SOUTH', 'New Orleans', 'Saints', 'NO'), (28, 'NFC', 'SOUTH', 'Tampa Bay', 'Buccaneers', 'TB'),
    (29, 'NFC', 'WEST', 'Arizona', 'Cardinals', 'ARI'), (30, 'NFC', 'WEST', 'Los Angeles', 'Rams', 'LAR'),
    (31, 'NFC', 'WEST', 'San Francisco', '49ers', 'SF'), (32, 'NFC', 'WEST', 'Seattle', 'Seahawks', 'SEA'),
]
TEAM_BY_ID = {t[0]: t for t in TEAMS}

FIRST = ['Avery', 'Blake', 'Cam', 'Dante', 'Eli', 'Fletcher', 'Gage', 'Hollis', 'Isaiah', 'Jalen', 'Kade',
         'Landon', 'Malik', 'Nico', 'Omar', 'Pierce', 'Quinn', 'Reid', 'Silas', 'Tate', 'Ulysses', 'Vance',
         'Wade', 'Xavier', 'Yusuf', 'Zane', 'Brock', 'Corbin', 'Darius', 'Emmett', 'Grady', 'Hayes', 'Jace',
         'Kellen', 'Marcus', 'Nate', 'Rowan', 'Troy', 'Beau', 'Cyrus']
LAST = ['Ashford', 'Barlow', 'Calloway', 'Draper', 'Ellison', 'Fairchild', 'Garrity', 'Holloway', 'Ingram',
        'Jessup', 'Kincaid', 'Lockhart', 'Merriweather', 'Northcutt', 'Oakley', 'Prescott', 'Quarles',
        'Redding', 'Sterling', 'Thornton', 'Underwood', 'Vickers', 'Whitlock', 'Yardley', 'Ashby', 'Brandt',
        'Coldwell', 'Dunmore', 'Easton', 'Fenwick', 'Galloway', 'Hartigan', 'Kingsley', 'Langford', 'Mercer',
        'Pendleton', 'Radcliffe', 'Stanton', 'Templeton', 'Winslow']

# roster template: (slot, position abbr, position name)
SLOTS = [('QB1', 'QB', 'Quarterback'), ('QB2', 'QB', 'Quarterback'),
         ('RB1', 'RB', 'Running Back'), ('RB2', 'RB', 'Running Back'),
         ('WR1', 'WR', 'Wide Receiver'), ('WR2', 'WR', 'Wide Receiver'), ('WR3', 'WR', 'Wide Receiver'),
         ('TE1', 'TE', 'Tight End'), ('K', 'PK', 'Place Kicker'), ('LB', 'LB', 'Linebacker'),
         ('CB', 'CB', 'Cornerback')]
TARGET_W = {'WR1': .26, 'WR2': .20, 'WR3': .13, 'TE1': .17, 'RB1': .11, 'RB2': .06, 'QB2': 0}
CATCH = {'WR1': .67, 'WR2': .64, 'WR3': .62, 'TE1': .70, 'RB1': .78, 'RB2': .76}
YPR = {'WR1': 13.2, 'WR2': 12.4, 'WR3': 11.8, 'TE1': 10.6, 'RB1': 7.6, 'RB2': 7.1}
CARRY_W = {'RB1': .60, 'RB2': .25, 'QB1': .12, 'WR1': .03}


def q(v):
    """SQL literal."""
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, (int,)):
        return str(v)
    if isinstance(v, float):
        return repr(round(v, 4))
    if isinstance(v, datetime):
        return "'" + v.strftime('%Y-%m-%d %H:%M:%S') + "'"
    return "N'" + str(v).replace("'", "''") + "'"


OUT = []


def emit(sql):
    OUT.append(sql)


def insert(table, cols, rows, chunk=800):
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        vals = ',\n'.join('(' + ', '.join(q(v) for v in r) + ')' for r in part)
        emit(f'INSERT INTO dbo.[{table}] ({", ".join("[" + c + "]" for c in cols)}) VALUES\n{vals};')
    emit('GO')


def poisson(lam):
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= R.random()
        if p <= L:
            return k
        k += 1


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ---------------------------------------------------------------------------
# players: each team keeps a core across seasons with some churn
# ---------------------------------------------------------------------------
used_names = set()


def new_name():
    while True:
        n = (R.choice(FIRST), R.choice(LAST))
        if n not in used_names:
            used_names.add(n)
            return n


players = {}          # id -> dict
next_pid = [1000]


def new_player(slot, pos, posname, team_id, rookie_season):
    pid = next_pid[0]; next_pid[0] += 1
    fn, ln = new_name()
    players[pid] = dict(id=pid, first=fn, last=ln, pos=pos, posname=posname, team=team_id,
                        talent=R.gauss(1.0, 0.12), rookie=rookie_season,
                        height=R.randint(70, 77) if pos not in ('WR', 'CB') else R.randint(69, 75),
                        weight={'QB': 220, 'RB': 215, 'WR': 195, 'TE': 250, 'PK': 190, 'LB': 238, 'CB': 190}[pos] + R.randint(-12, 12))
    return pid


rosters = {}   # (season, team) -> {slot: pid}
for t in TEAMS:
    for i, season in enumerate(SEASONS):
        prev = rosters.get((season - 1, t[0]))
        r = {}
        for slot, pos, posname in SLOTS:
            if prev and R.random() > 0.18:
                r[slot] = prev[slot]
            else:
                r[slot] = new_player(slot, pos, posname, t[0], season)
        rosters[(season, t[0])] = r
        for pid in r.values():
            players[pid]['team'] = t[0]  # last team wins = "current team"

# team strength drifts season to season
strength = {}
for t in TEAMS:
    off, de = R.gauss(0, 1), R.gauss(0, 1)
    for season in SEASONS:
        off = clamp(off * 0.6 + R.gauss(0, 0.8), -2.2, 2.2)
        de = clamp(de * 0.6 + R.gauss(0, 0.8), -2.2, 2.2)
        strength[(season, t[0])] = (off, de)

# ---------------------------------------------------------------------------
# schedule
# ---------------------------------------------------------------------------
games = []          # dicts
next_gid = [500000]


def season_start(season):
    d = datetime(season, 9, 1)
    while d.weekday() != 3:      # first Thursday in September
        d += timedelta(days=1)
    return d + timedelta(days=7)


def kickoff(season, week, idx, n):
    base = season_start(season) + timedelta(weeks=week - 1)
    if idx == 0:
        return base.replace(hour=0, minute=20) + timedelta(days=1)            # Thu night (UTC)
    if idx == n - 1:
        return base.replace(hour=0, minute=15) + timedelta(days=5)            # Mon night (UTC)
    slot = [17, 17, 17, 17, 17, 17, 17, 20, 20, 20, 20, 0][idx % 12]
    d = base + timedelta(days=3)
    return d.replace(hour=slot, minute=0 if slot != 20 else 25) + (timedelta(days=1) if slot == 0 else timedelta())


for season in SEASONS:
    weeks = 18
    for week in range(1, weeks + 1):
        ids = [t[0] for t in TEAMS]
        R.shuffle(ids)
        bye = set(ids[:4]) if 5 <= week <= 14 else set()
        playing = [i for i in ids if i not in bye]
        pairs = [(playing[i], playing[i + 1]) for i in range(0, len(playing), 2)]
        for idx, (h, v) in enumerate(pairs):
            games.append(dict(id=next_gid[0], season=season, week=week, st=2, home=h, vis=v,
                              date=kickoff(season, week, idx, len(pairs))))
            next_gid[0] += 1


def sim_score(season, off_team, def_team, home):
    off = strength[(season, off_team)][0]
    de = strength[(season, def_team)][1]
    lam_td = clamp(2.35 + 0.45 * off - 0.4 * de + (0.18 if home else 0), 0.6, 5.0)
    td = poisson(lam_td)
    fg = poisson(clamp(1.6 + 0.2 * off, 0.5, 3.5))
    return td, fg


def quarters(td, fg):
    q = [0, 0, 0, 0]
    events = []
    for _ in range(td):
        k = R.choices(range(4), [.22, .28, .22, .28])[0]; q[k] += 7; events.append((k, 7))
    for _ in range(fg):
        k = R.choices(range(4), [.2, .3, .2, .3])[0]; q[k] += 3; events.append((k, 3))
    return q, events


results = {}   # gid -> details


def play_game(g):
    s = g['season']
    htd, hfg = sim_score(s, g['home'], g['vis'], True)
    vtd, vfg = sim_score(s, g['vis'], g['home'], False)
    hq, hev = quarters(htd, hfg)
    vq, vev = quarters(vtd, vfg)
    hot = vot = 0
    if sum(hq) == sum(vq):
        if R.random() < 0.85:
            if R.random() < 0.55:
                hot = R.choice([3, 6]); hfg += hot == 3; htd += hot == 6
            else:
                vot = R.choice([3, 6]); vfg += vot == 3; vtd += vot == 6
    results[g['id']] = dict(htd=htd, hfg=hfg, vtd=vtd, vfg=vfg, hq=hq, vq=vq, hot=hot, vot=vot,
                            hev=hev, vev=vev, hs=sum(hq) + hot, vs=sum(vq) + vot)


def is_played(g):
    if g['season'] < CURRENT_SEASON:
        return True
    return g['st'] == 2 and g['week'] <= CURRENT_WEEKS_PLAYED


for g in games:
    if is_played(g):
        play_game(g)

# playoffs for completed seasons: top 7 per conference by wins (simplified seeding)
def standings_for(season):
    rec = {t[0]: dict(w=0, l=0, t=0, pf=0, pa=0, hw=0, hl=0, rw=0, rl=0, dw=0, dl=0, cw=0, cl=0, streak=0)
           for t in TEAMS}
    for g in sorted([g for g in games if g['season'] == season and g['st'] == 2 and g['id'] in results],
                    key=lambda x: x['date']):
        r = results[g['id']]
        for team, opp, pf, pa, home in ((g['home'], g['vis'], r['hs'], r['vs'], True),
                                        (g['vis'], g['home'], r['vs'], r['hs'], False)):
            x = rec[team]; x['pf'] += pf; x['pa'] += pa
            same_div = TEAM_BY_ID[team][1:3] == TEAM_BY_ID[opp][1:3]
            same_conf = TEAM_BY_ID[team][1] == TEAM_BY_ID[opp][1]
            if pf > pa:
                x['w'] += 1; x['hw' if home else 'rw'] += 1; x['streak'] = max(1, x['streak'] + 1)
                if same_div: x['dw'] += 1
                if same_conf: x['cw'] += 1
            elif pf < pa:
                x['l'] += 1; x['hl' if home else 'rl'] += 1; x['streak'] = min(-1, x['streak'] - 1)
                if same_div: x['dl'] += 1
                if same_conf: x['cl'] += 1
            else:
                x['t'] += 1
    return rec


playoff_seeds = {}
for season in SEASONS:
    if season == CURRENT_SEASON:
        continue
    rec = standings_for(season)
    for conf in ('AFC', 'NFC'):
        teams = [t[0] for t in TEAMS if t[1] == conf]
        teams.sort(key=lambda i: (rec[i]['w'] + 0.5 * rec[i]['t'], rec[i]['pf'] - rec[i]['pa']), reverse=True)
        seeds = teams[:7]
        for n, tid in enumerate(seeds):
            playoff_seeds[(season, tid)] = n + 1
        alive = list(seeds)
        start = season_start(season) + timedelta(weeks=18)
        rounds = [(1, [(alive[1], alive[6]), (alive[2], alive[5]), (alive[3], alive[4])])]
        playoff_seeds[('alive', season, conf)] = alive
    # simulate rounds across both conferences
    for conf in ('AFC', 'NFC'):
        alive = playoff_seeds[('alive', season, conf)]
        bracket = alive[:]  # seeds 1..7
        wc = [(bracket[1], bracket[6]), (bracket[2], bracket[5]), (bracket[3], bracket[4])]
        winners = []
        start = season_start(season) + timedelta(weeks=18)
        for idx, (h, v) in enumerate(wc):
            g = dict(id=next_gid[0], season=season, week=1, st=3, home=h, vis=v,
                     date=(start + timedelta(days=2 + idx % 2)).replace(hour=18 + idx, minute=0))
            next_gid[0] += 1; games.append(g); play_game(g)
            r = results[g['id']]; winners.append(h if r['hs'] >= r['vs'] else v)
        playoff_seeds[('wc', season, conf)] = [bracket[0]] + sorted(winners, key=lambda t: bracket.index(t))
    for conf in ('AFC', 'NFC'):
        rem = playoff_seeds[('wc', season, conf)]
        start = season_start(season) + timedelta(weeks=19)
        div = [(rem[0], rem[3]), (rem[1], rem[2])]
        win = []
        for idx, (h, v) in enumerate(div):
            g = dict(id=next_gid[0], season=season, week=2, st=3, home=h, vis=v,
                     date=(start + timedelta(days=2 + idx)).replace(hour=20, minute=15))
            next_gid[0] += 1; games.append(g); play_game(g)
            r = results[g['id']]; win.append(h if r['hs'] >= r['vs'] else v)
        bracket = playoff_seeds[('alive', season, conf)]
        win.sort(key=lambda t: bracket.index(t))
        start = season_start(season) + timedelta(weeks=20)
        g = dict(id=next_gid[0], season=season, week=3, st=3, home=win[0], vis=win[1],
                 date=(start + timedelta(days=3)).replace(hour=20 if conf == 'AFC' else 23, minute=30))
        next_gid[0] += 1; games.append(g); play_game(g)
        r = results[g['id']]
        playoff_seeds[('champ', season, conf)] = win[0] if r['hs'] >= r['vs'] else win[1]
    start = season_start(season) + timedelta(weeks=22)
    g = dict(id=next_gid[0], season=season, week=5, st=3,
             home=playoff_seeds[('champ', season, 'AFC' if season % 2 else 'NFC')],
             vis=playoff_seeds[('champ', season, 'NFC' if season % 2 else 'AFC')],
             date=(start + timedelta(days=3)).replace(hour=23, minute=30))
    next_gid[0] += 1; games.append(g); play_game(g)

# ---------------------------------------------------------------------------
# box scores
# ---------------------------------------------------------------------------
pgs_rows, tgs_rows = [], []
pgs_by_game = {}


def split(total, weights):
    """Multinomial-ish split of an integer total by weights dict -> dict."""
    keys = list(weights)
    out = {k: 0 for k in keys}
    w = [max(weights[k], 0.0001) for k in keys]
    for _ in range(total):
        out[R.choices(keys, w)[0]] += 1
    return out


def team_box(g, team, opp, td, fg, pts):
    s = g['season']
    roster = rosters[(s, team)]
    off, _ = strength[(s, team)]
    _, opp_def = strength[(s, opp)]
    qb = roster['QB1'] if R.random() > 0.04 else roster['QB2']
    att = clamp(int(R.gauss(34 + 1.5 * off, 6)), 18, 55)
    comp_pct = clamp(R.gauss(0.645 + 0.02 * off - 0.015 * opp_def, 0.06), 0.45, 0.82)
    comp = int(round(att * comp_pct))
    pass_td = sum(1 for _ in range(td) if R.random() < 0.62)
    rush_td = td - pass_td
    ints = poisson(clamp(0.85 - 0.12 * off + 0.12 * opp_def, 0.2, 2.0))
    sacks = poisson(2.4)
    rush_att = clamp(int(R.gauss(26 + 1.0 * off, 5)), 12, 45)

    stats = {pid: {} for pid in roster.values()}
    # targets & receptions
    tgt = split(att, {k: TARGET_W[k] * players[roster[k]]['talent'] for k in TARGET_W if k != 'QB2'})
    rec = {k: sum(1 for _ in range(tgt[k]) if R.random() < CATCH[k]) for k in tgt}
    # make receptions sum match completions
    diff = comp - sum(rec.values())
    keys = [k for k in tgt if tgt[k] > rec[k]] if diff > 0 else [k for k in rec if rec[k] > 0]
    while diff != 0 and keys:
        k = R.choice(keys)
        if diff > 0 and tgt[k] > rec[k]:
            rec[k] += 1; diff -= 1
        elif diff < 0 and rec[k] > 0:
            rec[k] -= 1; diff += 1
        keys = [k for k in tgt if tgt[k] > rec[k]] if diff > 0 else [k for k in rec if rec[k] > 0]
    pass_yds = 0
    rec_td = split(pass_td, {k: rec[k] * (1.6 if k == 'TE1' else 1) + 0.01 for k in rec})
    for k in tgt:
        yds = sum(max(-3, int(R.gauss(YPR[k] * players[roster[k]]['talent'], 7))) for _ in range(rec[k]))
        lng = max([0] + [int(R.gauss(YPR[k] * 1.9, 9)) for _ in range(min(rec[k], 3))])
        pid = roster[k]
        stats[pid].update(receiving_targets=tgt[k], receptions=rec[k], receiving_yards=yds,
                          receiving_touchdowns=rec_td[k], long_reception=max(lng, 0) if rec[k] else 0,
                          yards_per_reception=round(yds / rec[k], 1) if rec[k] else 0)
        pass_yds += yds
    carries = split(rush_att, CARRY_W)
    rtd = split(rush_td, {k: CARRY_W[k] * (0.6 if k == 'QB1' else 1) for k in CARRY_W})
    rush_yds = 0
    for k, n in carries.items():
        pid = roster[k] if k != 'QB1' else qb
        ypc = 4.3 * players[pid]['talent'] + 0.15 * off - 0.15 * opp_def
        yds = sum(int(R.gauss(ypc, 4.5)) for _ in range(n))
        stats.setdefault(pid, {})
        stats[pid].update(rushing_attempts=n, rushing_yards=yds, rushing_touchdowns=rtd[k],
                          yards_per_rush_attempt=round(yds / n, 1) if n else 0,
                          long_rushing=max([0] + [int(R.gauss(ypc * 2.4, 6)) for _ in range(min(n, 4))]))
        rush_yds += yds
    stats.setdefault(qb, {})
    stats[qb].update(passing_attempts=att, passing_completions=comp, passing_yards=pass_yds,
                     passing_touchdowns=pass_td, passing_interceptions=ints, sacks=sacks,
                     sacks_loss=sacks * R.randint(5, 8),
                     yards_per_pass_attempt=round(pass_yds / att, 1),
                     qbr=round(clamp(R.gauss(55 + 8 * off, 18), 2, 99), 1),
                     qb_rating=None)
    fum_lost = poisson(0.35)
    ball = [roster['RB1'], roster['RB2'], roster['WR1'], qb]
    for _ in range(fum_lost):
        pid = R.choice(ball)
        stats[pid]['fumbles_lost'] = stats[pid].get('fumbles_lost', 0) + 1
        stats[pid]['fumbles'] = stats[pid].get('fumbles', 0) + 1
    k = roster['K']
    fga = fg + poisson(0.35)
    stats[k] = dict(field_goal_attempts=fga, field_goals_made=fg, extra_points_made=td - (1 if td and R.random() < 0.05 else 0),
                    field_goal_pct=round(100 * fg / fga, 1) if fga else None,
                    long_field_goal_made=R.randint(28, 56) if fg else None)
    stats[k]['total_points'] = fg * 3 + stats[k]['extra_points_made']
    stats[roster['LB']] = dict(total_tackles=R.randint(4, 13), solo_tackles=R.randint(2, 8),
                               defensive_sacks=float(poisson(0.4)), tackles_for_loss=float(poisson(0.8)),
                               qb_hits=poisson(0.9), passes_defended=poisson(0.4))
    stats[roster['CB']] = dict(total_tackles=R.randint(2, 8), solo_tackles=R.randint(1, 6),
                               passes_defended=poisson(1.1), defensive_interceptions=poisson(0.15))
    # drop backup QB unless he played
    if qb == roster['QB1']:
        stats.pop(roster['QB2'], None)
    plays_total = att + rush_att + sacks
    yards = pass_yds - stats[qb]['sacks_loss'] + rush_yds
    third_att = R.randint(10, 16)
    rz_att = max(td, int(td + R.choice([0, 0, 1, 1, 2])))
    team = dict(first_downs=int(yards / 15) + R.randint(2, 6), third_down_attempts=third_att,
                third_down_conversions=clamp(int(third_att * R.gauss(0.40 + 0.03 * off, 0.1)), 0, third_att),
                fourth_down_attempts=R.randint(0, 3), total_offensive_plays=plays_total, total_yards=yards,
                yards_per_play=round(yards / plays_total, 1), total_drives=R.randint(9, 13),
                net_passing_yards=pass_yds - stats[qb]['sacks_loss'], passing_completions=comp,
                passing_attempts=att, yards_per_pass=round((pass_yds - stats[qb]['sacks_loss']) / (att + sacks), 1),
                sacks=sacks, sack_yards_lost=stats[qb]['sacks_loss'], rushing_yards=rush_yds,
                rushing_attempts=rush_att, yards_per_rush_attempt=round(rush_yds / rush_att, 1),
                red_zone_scores=min(rz_att, td + (1 if fg else 0)), red_zone_attempts=rz_att,
                penalties=R.randint(3, 10), turnovers=ints + fum_lost, fumbles_lost=fum_lost,
                interceptions_thrown=ints, defensive_touchdowns=1 if R.random() < 0.04 else 0,
                possession_time_seconds=int(clamp(R.gauss(1800 + 60 * off, 180), 1380, 2220)))
    team['fourth_down_conversions'] = R.randint(0, team['fourth_down_attempts'])
    team['penalty_yards'] = team['penalties'] * R.randint(6, 9)
    team['first_downs_passing'] = int(team['first_downs'] * 0.58)
    team['first_downs_rushing'] = team['first_downs'] - team['first_downs_passing'] - 1
    team['first_downs_penalty'] = 1
    m, s_ = divmod(team['possession_time_seconds'], 60)
    team['possession_time'] = f'{m}:{s_:02d}'
    team['third_down_efficiency'] = f"{team['third_down_conversions']}-{third_att}"
    team['fourth_down_efficiency'] = f"{team['fourth_down_conversions']}-{team['fourth_down_attempts']}"
    return stats, team, qb


PGS_COLS = ['game_id', 'player_id', 'team_id', 'season', 'week', 'season_type',
            'passing_completions', 'passing_attempts', 'passing_yards', 'yards_per_pass_attempt',
            'passing_touchdowns', 'passing_interceptions', 'sacks', 'sacks_loss', 'qbr', 'qb_rating',
            'rushing_attempts', 'rushing_yards', 'yards_per_rush_attempt', 'rushing_touchdowns', 'long_rushing',
            'receptions', 'receiving_yards', 'yards_per_reception', 'receiving_touchdowns', 'long_reception',
            'receiving_targets', 'fumbles', 'fumbles_lost', 'total_tackles', 'defensive_sacks', 'solo_tackles',
            'tackles_for_loss', 'passes_defended', 'qb_hits', 'defensive_interceptions',
            'field_goal_attempts', 'field_goals_made', 'field_goal_pct', 'long_field_goal_made',
            'extra_points_made', 'total_points']
TGS_COLS = ['game_id', 'team_id', 'season', 'week', 'season_type', 'home_away', 'first_downs',
            'first_downs_passing', 'first_downs_rushing', 'first_downs_penalty', 'third_down_efficiency',
            'third_down_conversions', 'third_down_attempts', 'fourth_down_efficiency', 'fourth_down_conversions',
            'fourth_down_attempts', 'total_offensive_plays', 'total_yards', 'yards_per_play', 'total_drives',
            'net_passing_yards', 'passing_completions', 'passing_attempts', 'yards_per_pass', 'sacks',
            'sack_yards_lost', 'rushing_yards', 'rushing_attempts', 'yards_per_rush_attempt', 'red_zone_scores',
            'red_zone_attempts', 'penalties', 'penalty_yards', 'turnovers', 'fumbles_lost',
            'interceptions_thrown', 'defensive_touchdowns', 'possession_time', 'possession_time_seconds']

box = {}
for g in games:
    if g['id'] not in results:
        continue
    r = results[g['id']]
    out = {}
    for team, opp, td, fg, pts, ha in ((g['home'], g['vis'], r['htd'], r['hfg'], r['hs'], 'home'),
                                       (g['vis'], g['home'], r['vtd'], r['vfg'], r['vs'], 'away')):
        stats, tstats, qb = team_box(g, team, opp, td, fg, pts)
        out[team] = (stats, qb)
        for pid, st in stats.items():
            row = [g['id'], pid, team, g['season'], g['week'], g['st']] + [st.get(c) for c in PGS_COLS[6:]]
            pgs_rows.append(row)
        tgs_rows.append([g['id'], team, g['season'], g['week'], g['st'], ha] + [tstats.get(c) for c in TGS_COLS[6:]])
    box[g['id']] = out

# ---------------------------------------------------------------------------
# play-by-play (2025 + 2026 only, to keep the file reasonable)
# ---------------------------------------------------------------------------
PLAY_COLS = ['id', 'game_id', 'season', 'week', 'season_type', 'type_text', 'text', 'away_score', 'home_score',
             'scoring_play', 'period', 'clock_display', 'team_id', 'start_down', 'start_distance',
             'start_yards_to_endzone', 'stat_yardage', 'home_win_probability', 'wallclock']
play_rows = []


def wp(home_lead, secs_left):
    t = max(secs_left, 1) / 3600
    return clamp(1 / (1 + math.exp(-(home_lead + 1.5) / (13.5 * math.sqrt(t) + 0.6))), 0.005, 0.995)


for g in games:
    if g['id'] not in results or g['season'] < 2025:
        continue
    r = results[g['id']]
    hr, vr = rosters[(g['season'], g['home'])], rosters[(g['season'], g['vis'])]
    events = [(k, pts, g['home']) for k, pts in r['hev']] + [(k, pts, g['vis']) for k, pts in r['vev']]
    by_q = {k: sorted([e for e in events if e[0] == k], key=lambda _: R.random()) for k in range(4)}
    hs = vs = 0
    n = 0
    wall = g['date']
    for period in range(1, 5):
        evs = by_q[period - 1]
        nplays = R.randint(30, 40)
        score_at = sorted(R.sample(range(3, nplays), min(len(evs), nplays - 3)))
        ei = 0
        poss = g['home'] if period % 2 else g['vis']
        down, dist, ytg = 1, 10, 75
        for i in range(nplays):
            secs = int(900 * (1 - i / nplays))
            clock = f'{secs // 60}:{secs % 60:02d}'
            wall += timedelta(seconds=R.randint(25, 45))
            n += 1
            if ei < len(score_at) and i == score_at[ei]:
                _, pts, team = evs[ei]; ei += 1
                ro = hr if team == g['home'] else vr
                if team == g['home']:
                    hs += pts
                else:
                    vs += pts
                if pts == 7:
                    if R.random() < 0.62:
                        qb, wr = players[ro['QB1']], players[ro[R.choice(['WR1', 'WR2', 'TE1', 'RB1'])]]
                        y = R.randint(3, 45)
                        txt = f"{qb['first'][0]}.{qb['last']} pass short right to {wr['first'][0]}.{wr['last']} for {y} yards, TOUCHDOWN."
                        ttype = 'Passing Touchdown'
                    else:
                        rb = players[ro['RB1']]; y = R.randint(1, 30)
                        txt = f"{rb['first'][0]}.{rb['last']} up the middle for {y} yards, TOUCHDOWN."
                        ttype = 'Rushing Touchdown'
                else:
                    kk = players[ro['K']]; y = R.randint(22, 55)
                    txt = f"{kk['first'][0]}.{kk['last']} {y} yard field goal is GOOD."
                    ttype = 'Field Goal Good'
                play_rows.append([f"{g['id']}{n:04d}", g['id'], g['season'], g['week'], g['st'], ttype, txt,
                                  vs, hs, 1, period, clock, team, None, None, None, y,
                                  round(wp(hs - vs, (4 - period) * 900 + secs), 4), wall])
                poss = g['vis'] if team == g['home'] else g['home']
                down, dist, ytg = 1, 10, 75
                continue
            ro = hr if poss == g['home'] else vr
            if R.random() < 0.56:
                qb, wr = players[ro['QB1']], players[ro[R.choice(['WR1', 'WR2', 'WR3', 'TE1', 'RB1'])]]
                y = max(0, int(R.gauss(6.5, 8))) if R.random() < 0.65 else 0
                txt = (f"{qb['first'][0]}.{qb['last']} pass deep left to {wr['first'][0]}.{wr['last']} to the {max(1, ytg - y)} for {y} yards."
                       if y else f"{qb['first'][0]}.{qb['last']} pass incomplete short middle intended for {wr['first'][0]}.{wr['last']}.")
                ttype = 'Pass Reception' if y else 'Pass Incompletion'
            else:
                rb = players[ro['RB1'] if R.random() < 0.7 else ro['RB2']]
                y = int(R.gauss(4.2, 4))
                txt = f"{rb['first'][0]}.{rb['last']} left tackle to the {max(1, ytg - y)} for {y} yards."
                ttype = 'Rush'
            play_rows.append([f"{g['id']}{n:04d}", g['id'], g['season'], g['week'], g['st'], ttype, txt,
                              vs, hs, 0, period, clock, poss, down, dist, ytg, y,
                              round(wp(hs - vs, (4 - period) * 900 + secs), 4), wall])
            ytg = clamp(ytg - y, 1, 99)
            if y >= dist:
                down, dist = 1, 10
            elif down == 4:
                poss = g['vis'] if poss == g['home'] else g['home']; down, dist, ytg = 1, 10, 100 - ytg
            else:
                down, dist = down + 1, dist - y
        # quarter scores might not all be placed if nplays small; reconcile by forcing quarter totals
    # final row: end of game
    play_rows.append([f"{g['id']}9999", g['id'], g['season'], g['week'], g['st'], 'End of Game', 'END GAME',
                      r['vs'], r['hs'], 0, 4, '0:00', None, None, None, None, None,
                      1.0 if r['hs'] > r['vs'] else (0.0 if r['hs'] < r['vs'] else 0.5), wall + timedelta(minutes=1)])

# ---------------------------------------------------------------------------
# season stats (from box scores, with injected endpoint defects to mirror the
# real season_stats problems the data-health page is meant to surface)
# ---------------------------------------------------------------------------
agg = {}
for row in pgs_rows:
    d = dict(zip(PGS_COLS, row))
    key = (d['player_id'], d['season'], d['season_type'])
    a = agg.setdefault(key, dict(games=0))
    a['games'] += 1
    for c in ('passing_completions', 'passing_attempts', 'passing_yards', 'passing_touchdowns',
              'passing_interceptions', 'rushing_attempts', 'rushing_yards', 'rushing_touchdowns',
              'receptions', 'receiving_yards', 'receiving_touchdowns', 'receiving_targets',
              'field_goal_attempts', 'field_goals_made'):
        a[c] = a.get(c, 0) + (d[c] or 0)
PSS_COLS = ['player_id', 'season', 'season_type', 'games_played', 'postseason', 'passing_completions',
            'passing_attempts', 'passing_yards', 'passing_touchdowns', 'passing_interceptions', 'qbr', 'qb_rating',
            'rushing_attempts', 'rushing_yards', 'rushing_touchdowns', 'receptions', 'receiving_yards',
            'receiving_touchdowns', 'receiving_targets', 'field_goal_attempts', 'field_goals_made']
pss_rows = []
for (pid, season, st), a in agg.items():
    if st != 2 and st != 3:
        continue
    ints = a['passing_interceptions'] if a['passing_attempts'] else None
    if ints is not None and R.random() < 0.6:
        ints = None                          # the real endpoint's NULL-INT defect
    elif ints is not None and R.random() < 0.08:
        ints = max(0, ints - R.randint(1, 6))  # and its occasional wrong value
    pss_rows.append([pid, season, st, a['games'], st == 3, a['passing_completions'], a['passing_attempts'],
                     a['passing_yards'], a['passing_touchdowns'], ints,
                     round(R.uniform(35, 75), 1) if a['passing_attempts'] else None, None,
                     a['rushing_attempts'], a['rushing_yards'], a['rushing_touchdowns'], a['receptions'],
                     a['receiving_yards'], a['receiving_touchdowns'], a['receiving_targets'],
                     a['field_goal_attempts'], a['field_goals_made']])

# standings
ST_COLS = ['team_id', 'season', 'win_streak', 'points_for', 'points_against', 'playoff_seed', 'point_differential',
           'overall_record', 'conference_record', 'division_record', 'wins', 'losses', 'ties', 'home_record', 'road_record']
st_rows = []
for season in SEASONS:
    rec = standings_for(season)
    for tid, x in rec.items():
        st_rows.append([tid, season, x['streak'], x['pf'], x['pa'], playoff_seeds.get((season, tid)),
                        x['pf'] - x['pa'], f"{x['w']}-{x['l']}" + (f"-{x['t']}" if x['t'] else ''),
                        f"{x['cw']}-{x['cl']}", f"{x['dw']}-{x['dl']}", x['w'], x['l'], x['t'],
                        f"{x['hw']}-{x['hl']}", f"{x['rw']}-{x['rl']}"])

# advanced stats (season aggregate week 0 + weekly for current season)
ADVP = ['player_id', 'season', 'week', 'season_type', 'postseason', 'attempts', 'completions', 'pass_yards',
        'pass_touchdowns', 'interceptions', 'avg_time_to_throw', 'avg_intended_air_yards',
        'avg_completed_air_yards', 'aggressiveness', 'completion_percentage',
        'expected_completion_percentage', 'completion_percentage_above_expectation', 'passer_rating', 'games_played']
ADVR = ['player_id', 'season', 'week', 'season_type', 'postseason', 'rush_attempts', 'rush_yards', 'rush_touchdowns',
        'avg_rush_yards', 'expected_rush_yards', 'rush_yards_over_expected', 'rush_yards_over_expected_per_att',
        'rush_pct_over_expected', 'efficiency', 'avg_time_to_los', 'percent_attempts_gte_eight_defenders']
ADVC = ['player_id', 'season', 'week', 'season_type', 'postseason', 'targets', 'receptions', 'yards', 'rec_touchdowns',
        'avg_separation', 'avg_cushion', 'avg_intended_air_yards', 'avg_yac', 'avg_expected_yac',
        'avg_yac_above_expectation', 'catch_percentage', 'percent_share_of_intended_air_yards']
advp, advr, advc = [], [], []
for (pid, season, st), a in agg.items():
    if st != 2:
        continue
    p = players[pid]; tal = p['talent']
    if p['pos'] == 'QB' and a['passing_attempts'] >= 100:
        cp = 100 * a['passing_completions'] / a['passing_attempts']
        xcp = clamp(R.gauss(64.5, 2.5), 58, 70)
        advp.append([pid, season, 0, 2, False, a['passing_attempts'], a['passing_completions'], a['passing_yards'],
                     a['passing_touchdowns'], a['passing_interceptions'], round(R.gauss(2.8, 0.15), 2),
                     round(R.gauss(7.8, 1.0), 2), round(R.gauss(5.9, 0.7), 2), round(R.gauss(16, 4), 1),
                     round(cp, 1), round(xcp, 1), round(cp - xcp, 1), round(R.gauss(92, 10), 1), a['games']])
    if p['pos'] in ('RB', 'QB') and a['rushing_attempts'] >= 50:
        exp = a['rushing_yards'] / tal * R.uniform(0.95, 1.05)
        advr.append([pid, season, 0, 2, False, a['rushing_attempts'], a['rushing_yards'], a['rushing_touchdowns'],
                     round(a['rushing_yards'] / a['rushing_attempts'], 2), round(exp, 0),
                     round(a['rushing_yards'] - exp, 0), round((a['rushing_yards'] - exp) / a['rushing_attempts'], 2),
                     round(clamp(R.gauss(0.40 + (tal - 1), 0.06), 0.15, 0.7), 3), round(R.gauss(3.9, 0.5), 2),
                     round(R.gauss(2.8, 0.15), 2), round(R.gauss(22, 7), 1)])
    if p['pos'] in ('WR', 'TE', 'RB') and a['receiving_targets'] >= 30:
        advc.append([pid, season, 0, 2, False, a['receiving_targets'], a['receptions'], a['receiving_yards'],
                     a['receiving_touchdowns'], round(R.gauss(3.0 + (tal - 1) * 2, 0.4), 2),
                     round(R.gauss(6.0, 0.9), 2), round(R.gauss(9.5 if p['pos'] == 'WR' else 6.5, 2.0), 2),
                     round(R.gauss(5.0, 1.0), 2), round(R.gauss(4.8, 0.8), 2), round(R.gauss(0.2, 0.8), 2),
                     round(100 * a['receptions'] / a['receiving_targets'], 1), round(R.gauss(18, 8), 1)])

# odds + props: 2025 week 8+ and 2026 (opening, snapshots with movement)
VENDORS = ['draftkings', 'fanduel', 'caesars', 'betmgm']
odds_open, odds_snap, prop_open, prop_snap = [], [], [], []
api_odds = [900000]
for g in games:
    if not ((g['season'] == 2025 and (g['st'] == 3 or g['week'] >= 8)) or g['season'] == 2026):
        continue
    if g['season'] == 2026 and g['week'] > CURRENT_WEEKS_PLAYED + 1:
        continue
    ho, hd = strength[(g['season'], g['home'])]
    vo, vd = strength[(g['season'], g['vis'])]
    fair = -((ho - vd) - (vo - hd)) * 3.2 - 1.5
    total = 44 + 2.4 * (ho + vo) - 2.0 * (hd + vd)
    open_t = g['date'] - timedelta(days=6)
    move_s = R.gauss(0, 1.2)
    move_t = R.gauss(0, 1.3)
    for v in VENDORS:
        api_odds[0] += 1
        o_spread = round((fair + R.gauss(0, 0.6)) * 2) / 2
        o_total = round((total + R.gauss(0, 0.8)) * 2) / 2
        odds_open.append([api_odds[0], g['id'], v, f'{o_spread:+.1f}', o_spread, -110, f'{-o_spread:+.1f}', -o_spread,
                          -110, None, None, f'{o_total:.1f}', o_total, -110, -110, open_t])
        nsnap = 6 if g['id'] in results or g['date'] < NOW + timedelta(days=3) else 3
        for i in range(nsnap):
            frac = (i + 1) / nsnap
            s = round((o_spread + move_s * frac + R.gauss(0, 0.25)) * 2) / 2
            t = round((o_total + move_t * frac + R.gauss(0, 0.25)) * 2) / 2
            ml_h = int(-110 - 20 * abs(s)) if s < 0 else int(100 + 18 * abs(s))
            ml_a = int(100 + 18 * abs(s)) if s < 0 else int(-110 - 20 * abs(s))
            cap = open_t + (g['date'] - timedelta(minutes=15) - open_t) * frac
            if cap > NOW:
                break
            odds_snap.append([api_odds[0], g['id'], v, f'{s:+.1f}', s, R.choice([-115, -110, -105]),
                              f'{-s:+.1f}', -s, R.choice([-115, -110, -105]), ml_h, ml_a, f'{t:.1f}', t,
                              -110, -110, cap, cap])
    # props for skill players
    api_prop = [api_odds[0] * 10]
    for team in (g['home'], g['vis']):
        ro = rosters[(g['season'], team)]
        for slot, ptype, base in (('QB1', 'passing_yards', 235), ('QB1', 'passing_tds', 1.5),
                                  ('RB1', 'rushing_yards', 62), ('RB1', 'anytime_td', 0.5),
                                  ('WR1', 'receiving_yards', 66), ('WR1', 'receptions', 5.5),
                                  ('TE1', 'receiving_yards', 41), ('WR1', 'anytime_td', 0.5)):
            pid = ro[slot]
            tal = players[pid]['talent']
            line = 0.5 if ptype == 'anytime_td' else (round(base * tal * 2) / 2 if base > 3 else base)
            line = line if line % 1 else line + 0.5
            for vend in VENDORS[:2]:
                api_prop[0] += 1
                mt = 'milestone' if ptype == 'anytime_td' else 'over_under'
                prop_open.append([api_prop[0], g['id'], pid, vend, ptype, str(line), line, mt,
                                  None if mt == 'milestone' else -115, None if mt == 'milestone' else -115,
                                  R.choice([110, 140, 175, 210]) if mt == 'milestone' else None, open_t, open_t])
                for i in range(3):
                    cap = open_t + (g['date'] - timedelta(minutes=30) - open_t) * (i + 1) / 3
                    if cap > NOW:
                        break
                    l2 = line if mt == 'milestone' else line + R.choice([-1, -0.5, 0, 0, 0.5, 1]) * (5 if line > 20 else 0.5)
                    prop_snap.append([api_prop[0], g['id'], pid, vend, ptype, str(l2), l2, mt,
                                      None if mt == 'milestone' else R.choice([-120, -115, -110]),
                                      None if mt == 'milestone' else R.choice([-110, -105, -100]),
                                      R.choice([110, 140, 175, 210]) if mt == 'milestone' else None, cap, cap])

# injuries (two weekly captures for the current season)
inj_rows = []
STATUSES = [('Questionable', 'Limited in practice — {p}.'), ('Out', 'Did not practice — {p}; ruled out.'),
            ('Doubtful', 'Not expected to play — {p}.'), ('Injured Reserve', 'Placed on IR — {p}.')]
PARTS = ['hamstring', 'ankle', 'knee', 'shoulder', 'concussion protocol', 'groin', 'calf', 'back']
cur_players = [pid for (s, t), ro in rosters.items() if s == CURRENT_SEASON for pid in ro.values()]
for cap in (NOW - timedelta(days=7), NOW - timedelta(hours=6)):
    for pid in R.sample(cur_players, 28):
        st, tpl = R.choice(STATUSES)
        inj_rows.append([pid, players[pid]['team'], st, tpl.format(p=R.choice(PARTS)), cap - timedelta(days=R.randint(1, 20)), cap])

# ---------------------------------------------------------------------------
# write SQL
# ---------------------------------------------------------------------------
emit("""/* SYNTHETIC DEV DATA — generated by tools/gen_dev_data.py. Not real football data. */
IF DB_NAME() NOT LIKE '%[_]dev'
  THROW 50000, 'gen_dev_data: refusing to run — database name must end in _dev', 1;""")
emit('GO')
for t in ['plays', 'player_game_stats', 'team_game_stats', 'player_season_stats', 'team_season_stats',
          'standings', 'adv_passing_stats', 'adv_rushing_stats', 'adv_receiving_stats', 'injury_snapshots',
          'roster_snapshots', 'odds_snapshots', 'odds_opening', 'prop_snapshots', 'prop_opening',
          'coverage_map', 'sync_state', 'games', 'players', 'teams']:
    emit(f'DELETE FROM dbo.[{t}];')
emit('GO')

insert('teams', ['id', 'conference', 'division', 'location', 'name', 'full_name', 'abbreviation'],
       [[t[0], t[1], t[2], t[3], t[4], f'{t[3]} {t[4]}', t[5]] for t in TEAMS])
insert('players', ['id', 'first_name', 'last_name', 'position', 'position_abbreviation', 'height', 'weight',
                   'height_inches', 'weight_lbs', 'jersey_number', 'college', 'experience', 'age', 'team_id', 'is_active'],
       [[p['id'], p['first'], p['last'], p['posname'], p['pos'], f"{p['height'] // 12}' {p['height'] % 12}\"",
         f"{p['weight']} lbs", p['height'], p['weight'], str(R.randint(1, 99)),
         R.choice(['Alabama', 'Ohio State', 'Georgia', 'LSU', 'Michigan', 'Oregon', 'Texas', 'Clemson', 'USC', 'Iowa']),
         f"{CURRENT_SEASON - p['rookie'] + 1} season(s)", 22 + CURRENT_SEASON - p['rookie'], p['team'],
         any(pid == p['id'] for (s, _), ro in rosters.items() if s == CURRENT_SEASON for pid in ro.values())]
        for p in players.values()])
insert('games', ['id', 'season', 'week', 'season_type', 'postseason', 'game_date', 'status', 'venue',
                 'home_team_id', 'visitor_team_id', 'home_team_score', 'home_team_q1', 'home_team_q2', 'home_team_q3',
                 'home_team_q4', 'home_team_ot', 'visitor_team_score', 'visitor_team_q1', 'visitor_team_q2',
                 'visitor_team_q3', 'visitor_team_q4', 'visitor_team_ot'],
       [[g['id'], g['season'], g['week'], g['st'], g['st'] == 3, g['date'],
         'Final' + ('/OT' if results.get(g['id'], {}).get('hot') or results.get(g['id'], {}).get('vot') else '')
         if g['id'] in results else 'Scheduled',
         f"{TEAM_BY_ID[g['home']][3]} Stadium", g['home'], g['vis']] +
        ([results[g['id']]['hs']] + results[g['id']]['hq'] + [results[g['id']]['hot'] or None,
          results[g['id']]['vs']] + results[g['id']]['vq'] + [results[g['id']]['vot'] or None]
         if g['id'] in results else [None] * 12)
        for g in games
        if g['id'] in results or (g['season'] == CURRENT_SEASON and g['week'] <= CURRENT_WEEKS_PLAYED + 3)])
insert('player_game_stats', PGS_COLS, pgs_rows)
insert('team_game_stats', TGS_COLS, tgs_rows)
insert('player_season_stats', PSS_COLS, pss_rows)
insert('standings', ST_COLS, st_rows)
insert('adv_passing_stats', ADVP, advp)
insert('adv_rushing_stats', ADVR, advr)
insert('adv_receiving_stats', ADVC, advc)
insert('plays', PLAY_COLS, play_rows)
OC = ['api_odds_id', 'game_id', 'vendor', 'spread_home_value', 'spread_home', 'spread_home_odds',
      'spread_away_value', 'spread_away', 'spread_away_odds', 'moneyline_home_odds', 'moneyline_away_odds',
      'total_value', 'total_points', 'total_over_odds', 'total_under_odds']
insert('odds_opening', OC + ['opened_at'], odds_open)
insert('odds_snapshots', OC + ['api_updated_at', 'captured_at'], odds_snap)
PC = ['api_prop_id', 'game_id', 'player_id', 'vendor', 'prop_type', 'line_value', 'line', 'market_type',
      'over_odds', 'under_odds', 'milestone_odds']
insert('prop_opening', PC + ['opened_at', 'captured_at'], prop_open)
insert('prop_snapshots', PC + ['api_updated_at', 'captured_at'], prop_snap)
insert('injury_snapshots', ['player_id', 'team_id', 'status', 'comment', 'injury_date', 'captured_at'], inj_rows)
cov = []
for season in SEASONS:
    for ep in ('stats', 'team_stats', 'season_stats', 'plays', 'advanced_passing'):
        for st in (2, 3):
            cov.append([ep, season, st, not (ep == 'plays' and season < 2025), R.randint(50, 300), NOW - timedelta(days=40)])
insert('coverage_map', ['endpoint', 'season', 'season_type', 'has_data', 'sample_count', 'checked_at'], cov)
insert('sync_state', ['scope', 'watermark', 'last_run', 'note'],
       [['sync:nightly', 'done', NOW - timedelta(hours=7), 'synthetic'],
        ['sync:gameday', 'done', NOW - timedelta(days=4), 'synthetic'],
        [f'backfill:games:{CURRENT_SEASON}:2', 'done', NOW - timedelta(days=40), 'synthetic']])

sys.stdout.write('\n'.join(OUT) + '\n')
sys.stderr.write(f'players={len(players)} games={len(games)} pgs={len(pgs_rows)} plays={len(play_rows)} '
                 f'odds={len(odds_snap)} props={len(prop_snap)}\n')
