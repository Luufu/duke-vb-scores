/* Tournament logic: schedules, scoring rules, standings, seeding, brackets.
   No DOM code here, so it can be tested with Node. */
(function (root) {
  'use strict';

  const uid = (p = 'x') => p + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- Pool schedule templates ----------
  // Each row: [team position A, team position B, work team position]
  const TEMPLATES = {
    3: [[1, 2, 3], [2, 3, 1], [1, 3, 2], [1, 2, 3], [2, 3, 1], [1, 3, 2]],
    4: [[1, 2, 4], [3, 4, 2], [1, 4, 3], [2, 3, 1], [3, 1, 2], [2, 4, 1]],
  };

  function roundRobinPairs(n) {
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    if (n % 2) ids.push(0);
    const m = ids.length, out = [];
    let arr = ids.slice();
    for (let r = 0; r < m - 1; r++) {
      for (let i = 0; i < m / 2; i++) {
        const a = arr[i], b = arr[m - 1 - i];
        if (a && b) out.push([a, b]);
      }
      arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
    }
    return out;
  }

  function poolTemplate(n) {
    if (TEMPLATES[n]) return TEMPLATES[n];
    const work = {};
    return roundRobinPairs(n).map(([a, b]) => {
      let w = null;
      for (let k = 1; k <= n; k++) {
        if (k === a || k === b) continue;
        if (w === null || (work[k] || 0) < (work[w] || 0)) w = k;
      }
      if (w) work[w] = (work[w] || 0) + 1;
      return [a, b, w];
    });
  }

  function addMinutes(hhmm, mins) {
    const [h, m] = String(hhmm || '09:00').split(':').map(Number);
    const t = (h * 60 + (m || 0) + mins) % (24 * 60);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  function generatePoolMatches(pool) {
    const out = {};
    poolTemplate(pool.teamIds.length).forEach(([a, b, w], i) => {
      const id = `${pool.id}m${i + 1}`;
      out[id] = {
        id, stage: 'pool', poolId: pool.id, order: i,
        time: addMinutes(pool.start || '09:00', i * (+pool.interval || 60)),
        court: pool.court || '',
        a: pool.teamIds[a - 1] || null,
        b: pool.teamIds[b - 1] || null,
        work: w ? pool.teamIds[w - 1] || null : null,
        sets: [], status: 'scheduled', updatedAt: 0,
      };
    });
    return out;
  }

  // ---------- Scoring rules ----------
  function setRule(t, m, idx) {
    const f = t.format;
    if (m.stage === 'pool') return { to: +f.pool.points, cap: +f.pool.cap || 0 };
    const p = f.playoff;
    if (idx === +p.bestOf - 1 && +p.decidingPoints) return { to: +p.decidingPoints, cap: +p.decidingCap || 0 };
    return { to: +p.points, cap: +p.cap || 0 };
  }

  function setWinner(s, rule) {
    const a = +s.a || 0, b = +s.b || 0;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi === lo) return null;
    const w = a > b ? 'a' : 'b';
    if (hi >= rule.to && hi - lo >= 2) return w;
    if (rule.cap && hi >= rule.cap) return w;
    return null;
  }

  function maxSets(t, m) {
    return m.stage === 'pool' ? +t.format.pool.sets : +t.format.playoff.bestOf;
  }

  function matchState(t, m) {
    const sets = m.sets || [];
    let aw = 0, bw = 0;
    const winners = sets.map((s, i) => {
      const w = setWinner(s, setRule(t, m, i));
      if (w === 'a') aw++;
      if (w === 'b') bw++;
      return w;
    });
    const max = maxSets(t, m);
    const need = Math.floor(max / 2) + 1;
    let complete, winner = null;
    if (m.stage === 'pool') {
      complete = winners.filter(Boolean).length >= max;
      if (complete) winner = aw > bw ? 'a' : bw > aw ? 'b' : 'tie';
    } else {
      complete = aw >= need || bw >= need;
      if (complete) winner = aw > bw ? 'a' : 'b';
    }
    let cur = null;
    if (!complete) {
      const last = sets.length - 1;
      cur = last >= 0 && !winners[last] ? last : sets.length;
      if (cur >= max) cur = null;
    }
    return { aw, bw, winners, complete, winner, cur, max };
  }

  // Winner of a match marked final (also handles a match ended early by time)
  function finalWinner(t, m) {
    const st = matchState(t, m);
    if (st.winner && st.winner !== 'tie') return st.winner;
    if (st.aw !== st.bw) return st.aw > st.bw ? 'a' : 'b';
    const last = (m.sets || [])[m.sets.length - 1];
    if (last && +last.a !== +last.b) return +last.a > +last.b ? 'a' : 'b';
    return null;
  }

  // ---------- Standings ----------
  const TIEBREAKERS = {
    matchPct: 'Match record (win %)',
    setPct: 'Set win %',
    pointDiffPerSet: 'Point differential per set',
    pointDiff: 'Point differential (total)',
    pointPct: 'Points won %',
    headToHead: 'Head-to-head (same pool only)',
  };
  const DEFAULT_TB = ['matchPct', 'setPct', 'pointDiffPerSet', 'headToHead'];

  function makeComparator(keys, h2h) {
    return (x, y) => {
      for (const k of keys) {
        if (k === 'headToHead') {
          if (x.poolId !== y.poolId) continue;
          const r = h2h[x.id + '|' + y.id];
          if (!r) continue;
          if (r.s) return -r.s;
          if (r.p) return -r.p;
          continue;
        }
        const d = (y[k] || 0) - (x[k] || 0);
        if (Math.abs(d) > 1e-9) return d;
      }
      return (x.pos - y.pos) || String(x.id).localeCompare(String(y.id));
    };
  }

  function standings(t) {
    const rows = {};
    (t.pools || []).forEach((p) => p.teamIds.forEach((id, i) => {
      rows[id] = { id, poolId: p.id, pos: i, mp: 0, w: 0, l: 0, t: 0, sw: 0, sl: 0, pf: 0, pa: 0 };
    }));
    const h2h = {};
    for (const m of Object.values(t.matches || {})) {
      if (m.stage !== 'pool' || m.status !== 'final') continue;
      const A = rows[m.a], B = rows[m.b];
      if (!A || !B) continue;
      const st = matchState(t, m);
      let pa = 0, pb = 0;
      (m.sets || []).forEach((s) => { pa += +s.a || 0; pb += +s.b || 0; });
      A.mp++; B.mp++;
      A.sw += st.aw; A.sl += st.bw; B.sw += st.bw; B.sl += st.aw;
      A.pf += pa; A.pa += pb; B.pf += pb; B.pa += pa;
      if (st.aw > st.bw) { A.w++; B.l++; } else if (st.bw > st.aw) { B.w++; A.l++; } else { A.t++; B.t++; }
      const k1 = m.a + '|' + m.b, k2 = m.b + '|' + m.a;
      h2h[k1] = h2h[k1] || { s: 0, p: 0 };
      h2h[k2] = h2h[k2] || { s: 0, p: 0 };
      h2h[k1].s += st.aw - st.bw; h2h[k1].p += pa - pb;
      h2h[k2].s += st.bw - st.aw; h2h[k2].p += pb - pa;
    }
    for (const r of Object.values(rows)) {
      const sp = r.sw + r.sl;
      r.matchPct = r.mp ? (r.w + 0.5 * r.t) / r.mp : 0;
      r.setPct = sp ? r.sw / sp : 0;
      r.pd = r.pf - r.pa;
      r.pointDiff = r.pd;
      r.pointDiffPerSet = sp ? r.pd / sp : 0;
      r.pointPct = r.pf + r.pa ? r.pf / (r.pf + r.pa) : 0;
    }
    const keys = (t.tiebreakers && t.tiebreakers.length) ? t.tiebreakers : DEFAULT_TB;
    const cmp = makeComparator(keys, h2h);
    const byPool = {};
    (t.pools || []).forEach((p) => {
      const list = p.teamIds.map((id) => rows[id]).sort(cmp);
      list.forEach((r, i) => { r.poolRank = i + 1; });
      byPool[p.id] = list;
    });
    const overall = Object.values(rows);
    if (t.seedingMethod === 'byFinish') overall.sort((x, y) => (x.poolRank - y.poolRank) || cmp(x, y));
    else overall.sort(cmp);
    return { rows, byPool, overall };
  }

  function seedList(t, st) {
    const auto = st.overall.map((r) => r.id);
    if (Array.isArray(t.seedOrder) && t.seedOrder.length) {
      const valid = t.seedOrder.filter((id) => st.rows[id]);
      const rest = auto.filter((id) => !valid.includes(id));
      return { seeds: valid.concat(rest), locked: true };
    }
    return { seeds: auto, locked: false };
  }

  function poolPlayDone(t) {
    const pm = Object.values(t.matches || {}).filter((m) => m.stage === 'pool');
    return pm.length > 0 && pm.every((m) => m.status === 'final');
  }

  // ---------- Brackets ----------
  function seedPositions(P) {
    let o = [1];
    while (o.length < P) {
      const n = o.length * 2;
      o = o.flatMap((s) => [s, n + 1 - s]);
    }
    return o;
  }

  function buildBracket(br, totalTeams) {
    const from = +br.from, to = Math.min(+br.to, totalTeams);
    const N = to - from + 1;
    const matches = {};
    if (N < 2) return matches;
    let P = 1;
    while (P < N) P *= 2;
    let entries = seedPositions(P).map((s) => (s <= N ? { seed: from + s - 1 } : null));
    const totalRounds = Math.log2(P);
    let round = 1;
    while (entries.length > 1) {
      const next = [];
      let k = 0;
      for (let i = 0; i < entries.length; i += 2) {
        const x = entries[i], y = entries[i + 1];
        if (!x || !y) { next.push(x || y); continue; }
        k++;
        const id = `${br.id}r${round}m${k}`;
        matches[id] = {
          id, stage: 'playoff', bracketId: br.id, round, idx: k, roundsTotal: totalRounds,
          aSrc: x, bSrc: y, time: '', court: br.location || '', sets: [], status: 'scheduled', updatedAt: 0,
        };
        next.push({ winnerOf: id });
      }
      entries = next;
      round++;
    }
    return matches;
  }

  function roundName(m, short) {
    const fromEnd = m.roundsTotal - m.round;
    const names = short ? ['F', 'SF', 'QF', 'R16'] : ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16'];
    return names[fromEnd] || (short ? 'R' + m.round : 'Round ' + m.round);
  }

  function resolveSrc(t, src, seeds, depth) {
    if (!src || depth > 12) return null;
    if (src.seed) return seeds[src.seed - 1] || null;
    if (src.winnerOf) {
      const m = (t.matches || {})[src.winnerOf];
      if (!m || m.status !== 'final') return null;
      const w = finalWinner(t, m);
      const [a, b] = teamsOf(t, m, seeds, depth + 1);
      return w === 'a' ? a : w === 'b' ? b : null;
    }
    return null;
  }

  function teamsOf(t, m, seeds, depth = 0) {
    if (m.stage === 'pool') return [m.a, m.b];
    return [resolveSrc(t, m.aSrc, seeds, depth), resolveSrc(t, m.bSrc, seeds, depth)];
  }

  // ---------- Tournament factories ----------
  function defaultFormat() {
    return {
      pool: { sets: 2, points: 25, cap: 27 },
      playoff: { bestOf: 3, points: 25, cap: 27, decidingPoints: 15, decidingCap: 17 },
    };
  }

  function blankTournament(name) {
    return {
      id: uid('t'), name: name || 'New Tournament', date: '', announcement: '', notes: '',
      format: defaultFormat(), tiebreakers: DEFAULT_TB.slice(), seedingMethod: 'overall',
      brackets: [
        { id: 'gold', name: 'Gold', from: 1, to: 8, location: '' },
        { id: 'silver', name: 'Silver', from: 9, to: 16, location: '' },
        { id: 'bronze', name: 'Bronze', from: 17, to: 20, location: '' },
      ],
      teams: {}, pools: [], matches: {}, seedOrder: null, bracketsBuilt: false, createdAt: Date.now(),
    };
  }

  function makePools(t, defs) {
    defs.forEach((d, i) => {
      const id = 'p' + (i + 1);
      const teamIds = d.teams.map((name) => {
        const tid = uid('tm');
        t.teams[tid] = { name };
        return tid;
      });
      t.pools.push({ id, name: d.name, court: d.court, start: d.start || '09:30', interval: d.interval || 60, teamIds });
    });
    t.pools.forEach((p) => Object.assign(t.matches, generatePoolMatches(p)));
    return t;
  }

  function sampleTournament() {
    const t = blankTournament('Duke Club Volleyball Tournament');
    t.notes = [
      'Pool play: 2 sets to 25 (win by 2, cap 27). No third set. 4-minute warm-up per team before each match.',
      'Work teams officiate with the electronic whistle provided. Call captains promptly between matches.',
      'Playoffs begin 30 minutes after the last pool match ends, or at 4:00. Best 2 of 3 to 25; third set to 15. Single elimination.',
      'Top 8 seeds play in Gold, seeds 9–16 in Silver, 17–20 in Bronze. Each bracket is in a different gym.',
    ].join('\n');
    t.brackets[0].location = 'Wilson Gym';
    t.brackets[1].location = 'Brodie Gym';
    t.brackets[2].location = 'TBD';
    return makePools(t, [
      { name: 'Pool 1', court: 'Wilson · Court 1', teams: ['Duke A', 'Greensboro Alumni', 'Furman', 'Davidson'] },
      { name: 'Pool 2', court: 'Wilson · Court 2', teams: ['Wake A', 'Clemson A', 'App State B', 'ECU B'] },
      { name: 'Pool 3', court: 'Wilson · Court 3', teams: ['App State A', 'ECU A', 'Clemson B', 'NC State'] },
      { name: 'Pool 4', court: 'Brodie · Court 1', teams: ['UNCC A', 'Duke B', 'Charleston B'] },
      { name: 'Pool 5', court: 'Brodie · Court 2', teams: ['Charleston A', 'UNC W', 'UNCC B', 'High Point'] },
    ]);
  }

  // New tournament that reuses another's setup (teams, pools, format) with no scores
  function copySetup(src, name) {
    const t = clone(src);
    t.id = uid('t');
    t.name = name || src.name + ' (copy)';
    t.announcement = '';
    t.matches = {};
    t.pools.forEach((p) => Object.assign(t.matches, generatePoolMatches(p)));
    t.seedOrder = null;
    t.bracketsBuilt = false;
    t.createdAt = Date.now();
    return t;
  }

  function setPath(obj, path, val) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  const api = {
    uid, clone, TEMPLATES, poolTemplate, roundRobinPairs, addMinutes, generatePoolMatches,
    setRule, setWinner, maxSets, matchState, finalWinner,
    TIEBREAKERS, DEFAULT_TB, standings, seedList, poolPlayDone,
    seedPositions, buildBracket, roundName, teamsOf,
    defaultFormat, blankTournament, sampleTournament, copySetup, setPath,
  };
  root.VBLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
