/* UI. Plain JS, no build step. */
(function () {
  'use strict';
  const L = window.VBLogic;
  const CFG = window.VB_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k) { try { return localStorage.getItem('vb:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('vb:' + k, v); } catch (e) { /* ignore */ } },
  };
  const urlT = new URLSearchParams(location.search).get('t');

  const S = {
    store: null, authed: false, site: {}, tid: null, t: null, loaded: false,
    unT: null, unSite: null, tab: ls.get('tab') || 'live', myTeam: ls.get('myTeam') || '',
    scoreId: null, swap: false, manual: false, draft: null, draftDirty: false, list: [],
    showLogin: false, loginErr: '', lastUpdate: null, toast: '',
  };
  let C = null; // per-render computed context

  // ---------------- helpers ----------------
  function fmtTime(hhmm) {
    if (!hhmm) return 'TBA';
    const [h, m] = hhmm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
  }
  const name = (id) => (id && S.t.teams[id] ? S.t.teams[id].name : null);
  const poolOf = (id) => S.t.pools.find((p) => p.id === id);
  const bracketOf = (id) => S.t.brackets.find((b) => b.id === id);
  const bracketForSeed = (n) => S.t.brackets.find((b) => n >= +b.from && n <= +b.to);

  function ctx(t) {
    const st = L.standings(t);
    const si = L.seedList(t, st);
    return { st, seeds: si.seeds, locked: si.locked, poolDone: L.poolPlayDone(t) };
  }

  function sortKey(m) {
    return [(m.time || '99:99'), m.stage === 'pool' ? 0 : 1, m.round || 0, m.order || m.idx || 0];
  }
  function cmpMatch(x, y) {
    const a = sortKey(x), b = sortKey(y);
    for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
    return 0;
  }
  const allMatches = () => Object.values(S.t.matches || {}).sort(cmpMatch);

  function matchLabel(m, short) {
    if (m.stage === 'pool') { const p = poolOf(m.poolId); return p ? p.name : 'Pool'; }
    const br = bracketOf(m.bracketId);
    const same = Object.values(S.t.matches).filter((x) => x.bracketId === m.bracketId && x.round === m.round).length;
    return `${br ? br.name : ''} ${L.roundName(m, short)}${same > 1 ? ' ' + m.idx : ''}`.trim();
  }
  function srcLabel(src) {
    if (!src) return 'TBD';
    if (src.seed) return 'Seed ' + src.seed;
    const m = S.t.matches[src.winnerOf];
    return m ? 'Winner ' + matchLabel(m, true) : 'TBD';
  }
  function sides(m) {
    const [a, b] = L.teamsOf(S.t, m, C.seeds);
    const la = a ? name(a) : srcLabel(m.aSrc), lb = b ? name(b) : srcLabel(m.bSrc);
    return { a, b, la, lb };
  }
  function winnerSide(m) {
    if (m.status !== 'final') return null;
    if (m.stage === 'playoff') return L.finalWinner(S.t, m);
    const st = L.matchState(S.t, m);
    return st.aw > st.bw ? 'a' : st.bw > st.aw ? 'b' : null;
  }
  const seedNum = (id) => { const i = C.seeds.indexOf(id); return i >= 0 ? i + 1 : null; };
  const involves = (m, id) => { if (!id) return false; const s = sides(m); return s.a === id || s.b === id || m.work === id; };

  function toast(msg) {
    S.toast = msg;
    const el = $('#toast');
    if (el) { el.textContent = msg; el.classList.add('show'); }
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { S.toast = ''; const e = $('#toast'); if (e) e.classList.remove('show'); }, 3000);
  }

  // ---------------- writes ----------------
  function writeFields(fields) {
    for (const [p, v] of Object.entries(fields)) L.setPath(S.t, p, v === undefined ? null : L.clone(v));
    return S.store.update(S.t.id, fields).catch((e) => toast('Save failed: ' + (e.message || e)));
  }
  function writeMatch(id, f) {
    const fields = {};
    for (const k of Object.keys(f)) fields[`matches.${id}.${k}`] = f[k];
    fields[`matches.${id}.updatedAt`] = Date.now();
    writeFields(fields);
    render();
  }
  function statusFor(m, sets) {
    if (!sets.length) return 'scheduled';
    return L.matchState(S.t, Object.assign({}, m, { sets })).complete ? 'final' : 'live';
  }

  // ---------------- data subscriptions ----------------
  function subscribe() {
    if (S.unSite) S.unSite();
    if (S.unT) { S.unT(); S.unT = null; }
    S.unSite = S.store.watchSite((site) => {
      S.site = site;
      const id = urlT || site.activeId || null;
      if (id !== S.tid || !S.unT) watchT(id);
    }, S.authed);
  }
  function watchT(id) {
    if (S.unT) { S.unT(); S.unT = null; }
    S.tid = id;
    if (!id) { S.t = null; S.loaded = true; render(); return; }
    S.unT = S.store.watchTournament(id, (t) => {
      S.t = t; S.loaded = true; S.lastUpdate = new Date();
      if (t && (!S.draft || S.draft._tid !== t.id)) { S.draft = makeDraft(t); S.draftDirty = false; }
      const editing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (S.tab === 'setup' && (S.draftDirty || editing)) return;
      if (S.tab === 'score' && editing) return;
      render();
    }, S.authed);
  }

  // ---------------- render ----------------
  function render() {
    const app = $('#app');
    if (!S.loaded) { app.innerHTML = '<div class="empty">Loading…</div>'; return; }
    const t = S.t;
    const tabs = [['live', 'Live'], ['schedule', 'Schedule'], ['pools', 'Pools'], ['brackets', 'Brackets']];
    if (S.authed) tabs.push(['score', 'Score'], ['setup', 'Setup']);
    if (!tabs.find((x) => x[0] === S.tab)) S.tab = 'live';
    let body;
    if (!t) {
      if (S.authed && S.tab !== 'setup') S.tab = 'setup';
      body = S.authed ? viewSetup() : '<div class="empty">No tournament has been published yet. Check back soon.</div>';
    } else {
      C = ctx(t);
      body = VIEWS[S.tab]();
    }
    const updated = S.lastUpdate ? S.lastUpdate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
    app.innerHTML = `
      <header class="top">
        <div class="brand">
          <div class="ball" aria-hidden="true"></div>
          <div>
            <div class="site">${esc(CFG.siteTitle || 'Volleyball')}</div>
            <h1>${esc(t ? t.name : 'Tournament')}</h1>
            ${t && t.date ? `<div class="sub">${esc(new Date(t.date + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}</div>` : ''}
          </div>
        </div>
        ${t && t.announcement ? `<div class="announce">📣 ${esc(t.announcement)}</div>` : ''}
      </header>
      <nav class="tabs" role="tablist">
        ${tabs.map(([k, l]) => `<button role="tab" class="${S.tab === k ? 'on' : ''} ${k === 'score' || k === 'setup' ? 'admin' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}
      </nav>
      <main>${body}</main>
      <footer>
        <div>${updated ? `Updated ${esc(updated)}` : ''}${!S.authed && S.store.mode === 'live' && +CFG.viewerRefreshSeconds ? ` · refreshes every ${+CFG.viewerRefreshSeconds}s` : ''}</div>
        ${S.store.mode === 'demo' ? '<div class="demo">Demo mode — data is saved only in this browser. Scorekeeper code: <b>demo123</b></div>' : ''}
        <div>${S.authed ? '<button class="link" data-act="logout">Log out of scorekeeper mode</button>' : '<button class="link" data-act="showLogin">Scorekeeper login</button>'}</div>
      </footer>
      ${S.showLogin ? loginModal() : ''}
      <div id="toast" class="toast ${S.toast ? 'show' : ''}">${esc(S.toast)}</div>`;
    if (S.showLogin) setTimeout(() => { const i = $('#code'); if (i) i.focus(); }, 0);
  }

  function loginModal() {
    return `<div class="modal" data-act="closeLogin" data-self="1">
      <form class="card login" id="loginForm">
        <h2>Scorekeeper login</h2>
        <p class="muted">Enter the edit code to score matches and change the tournament.</p>
        <input id="code" type="password" autocomplete="current-password" placeholder="Edit code" required>
        ${S.loginErr ? `<div class="err">${esc(S.loginErr)}</div>` : ''}
        <div class="row end"><button type="button" class="btn ghost" data-act="closeLogin">Cancel</button><button class="btn primary" type="submit">Log in</button></div>
      </form></div>`;
  }

  // ---------------- match card ----------------
  function setCells(m, side) {
    const sets = m.sets || [];
    const st = L.matchState(S.t, m);
    if (!sets.length) return '<span class="sc dim">–</span>';
    return sets.map((s, i) => {
      const w = st.winners[i];
      const cur = m.status === 'live' && i === sets.length - 1 && !w;
      return `<span class="sc ${w === side ? 'won' : ''} ${cur ? 'cur' : ''}">${+s[side] || 0}</span>`;
    }).join('');
  }
  function pill(m) {
    if (m.status === 'live') return '<span class="pill live">ON COURT</span>';
    if (m.status === 'final') return '<span class="pill final">Final</span>';
    return '';
  }
  function matchCard(m, opts = {}) {
    const s = sides(m), w = winnerSide(m);
    const mine = involves(m, S.myTeam);
    const seedA = m.stage === 'playoff' && s.a ? seedNum(s.a) : null;
    const seedB = m.stage === 'playoff' && s.b ? seedNum(s.b) : null;
    const teamRow = (id, label, side, seed) => `
      <div class="tr ${w === side ? 'win' : ''} ${id && id === S.myTeam ? 'me' : ''} ${id ? '' : 'tbd'}">
        ${seed ? `<span class="seed">${seed}</span>` : ''}<span class="tn">${esc(label)}</span>
        <span class="scs">${setCells(m, side)}</span>
      </div>`;
    const meta = [];
    if (!opts.noTime) meta.push(esc(fmtTime(m.time)));
    if (!opts.noCourt && m.court) meta.push(esc(m.court));
    if (!opts.noLabel) meta.push(esc(matchLabel(m)));
    return `<div class="match ${m.status} ${mine ? 'mine' : ''}">
      <div class="mh"><span class="meta">${meta.join(' · ')}</span>${pill(m)}</div>
      ${teamRow(s.a, s.la, 'a', seedA)}
      ${teamRow(s.b, s.lb, 'b', seedB)}
      ${m.work ? `<div class="work ${m.work === S.myTeam ? 'me' : ''}">Officiating: ${esc(name(m.work))}</div>` : ''}
    </div>`;
  }

  function teamPicker() {
    const teams = Object.entries(S.t.teams).sort((a, b) => a[1].name.localeCompare(b[1].name));
    return `<label class="picker">My team
      <select data-change="myTeam"><option value="">All teams</option>
      ${teams.map(([id, t]) => `<option value="${id}" ${id === S.myTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select></label>`;
  }

  // ---------------- views ----------------
  const VIEWS = {};

  VIEWS.live = function () {
    const t = S.t, ms = allMatches();
    let html = '';
    if (t.notes) html += `<details class="card info"><summary>Format &amp; info</summary><div class="notes">${esc(t.notes).replace(/\n/g, '<br>')}</div></details>`;
    html += `<div class="bar">${teamPicker()}</div>`;
    if (S.myTeam && t.teams[S.myTeam]) {
      const mine = ms.filter((m) => m.status !== 'final');
      const play = mine.find((m) => { const s = sides(m); return s.a === S.myTeam || s.b === S.myTeam; });
      const work = mine.find((m) => m.work === S.myTeam);
      const sd = seedNum(S.myTeam), br = sd ? bracketForSeed(sd) : null;
      html += `<section class="card mycard"><h3>${esc(name(S.myTeam))}</h3>
        ${play ? `<div><b>Next match:</b> ${esc(fmtTime(play.time))} · ${esc(play.court || 'TBA')} · vs ${esc((() => { const s = sides(play); return s.a === S.myTeam ? s.lb : s.la; })())}${play.status === 'live' ? ' <span class="pill live">ON COURT</span>' : ''}</div>` : '<div>No more scheduled matches.</div>'}
        ${work ? `<div><b>Next officiating:</b> ${esc(fmtTime(work.time))} · ${esc(work.court)}</div>` : ''}
        ${sd ? `<div class="muted">${C.locked ? 'Seed' : 'Projected seed'} ${sd}${br ? ` · ${esc(br.name)} bracket` : ''}</div>` : ''}
      </section>`;
    }
    const courts = {};
    ms.forEach((m) => { const c = m.court || 'Unassigned'; (courts[c] = courts[c] || []).push(m); });
    const names = Object.keys(courts).sort();
    html += '<h2 class="sec">Courts</h2><div class="grid">';
    for (const c of names) {
      const list = courts[c];
      const live = list.filter((m) => m.status === 'live');
      const up = list.filter((m) => m.status === 'scheduled');
      const done = list.filter((m) => m.status === 'final').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      html += `<section class="court card"><h3>${esc(c)}</h3>`;
      if (live.length) html += '<div class="lbl">On court now</div>' + live.map((m) => matchCard(m, { noCourt: true })).join('');
      if (up[0]) html += `<div class="lbl">Up next</div>${matchCard(up[0], { noCourt: true })}`;
      if (up[1]) { const s = sides(up[1]); html += `<div class="then">Then ${esc(fmtTime(up[1].time))}: ${esc(s.la)} vs ${esc(s.lb)}</div>`; }
      if (!live.length && !up.length) html += done[0] ? `<div class="lbl">Last result</div>${matchCard(done[0], { noCourt: true })}` : '<div class="muted">No matches</div>';
      html += '</section>';
    }
    html += '</div>';
    const recent = ms.filter((m) => m.status === 'final').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
    if (recent.length) html += `<h2 class="sec">Latest results</h2><div class="grid">${recent.map((m) => matchCard(m)).join('')}</div>`;
    return html;
  };

  VIEWS.schedule = function () {
    let ms = allMatches();
    if (S.myTeam) ms = ms.filter((m) => involves(m, S.myTeam));
    const byTime = {};
    ms.forEach((m) => { const k = m.time || ''; (byTime[k] = byTime[k] || []).push(m); });
    const keys = Object.keys(byTime).sort((a, b) => (a || '99') < (b || '99') ? -1 : 1);
    let html = `<div class="bar">${teamPicker()}</div>`;
    if (!ms.length) return html + '<div class="empty">No matches.</div>';
    for (const k of keys) {
      html += `<h2 class="sec">${esc(k ? fmtTime(k) : 'Playoffs — time TBA')}</h2><div class="grid">`;
      html += byTime[k].map((m) => {
        let card = matchCard(m, { noTime: true });
        if (S.myTeam && m.work === S.myTeam) card = card.replace('class="match', 'class="match working');
        return card;
      }).join('');
      html += '</div>';
    }
    return html;
  };

  function recStr(r) { return r.t ? `${r.w}-${r.t}-${r.l}` : `${r.w}-${r.l}`; }

  VIEWS.pools = function () {
    const t = S.t, st = C.st;
    let html = '<div class="grid">';
    for (const p of t.pools) {
      const rows = st.byPool[p.id] || [];
      const anyTie = rows.some((r) => r.t);
      html += `<section class="card pool"><h3>${esc(p.name)} <span class="muted small">${esc(p.court || '')}</span></h3>
        <table class="tbl"><thead><tr><th>#</th><th class="l">Team</th><th>${anyTie ? 'W-T-L' : 'W-L'}</th><th>Sets</th><th>PD</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.id === S.myTeam ? 'me' : ''}"><td>${r.poolRank}</td><td class="l">${esc(name(r.id))}</td><td>${recStr(r)}</td><td>${r.sw}-${r.sl}</td><td>${r.pd > 0 ? '+' : ''}${r.pd}</td></tr>`).join('')}
        </tbody></table>
        <details><summary>Matches</summary><div class="stack">${allMatches().filter((m) => m.poolId === p.id).map((m) => matchCard(m, { noLabel: true, noCourt: true })).join('')}</div></details>
      </section>`;
    }
    html += '</div>';
    const tbNames = (t.tiebreakers || L.DEFAULT_TB).map((k) => L.TIEBREAKERS[k]).filter(Boolean);
    html += `<h2 class="sec">${C.locked ? 'Seeding' : 'Projected seeding'}</h2>
      <p class="muted small">${C.locked ? 'Seeds are final.' : 'Updates live as matches finish. Final seeds are confirmed by the tournament directors.'}
      Ranked by: ${esc(t.seedingMethod === 'byFinish' ? 'pool finish, then ' : '')}${esc(tbNames.join(' → '))}.</p>
      <div class="card"><table class="tbl seeds"><thead><tr><th>Seed</th><th class="l">Team</th><th>Pool</th><th>Rec</th><th>Set %</th><th>PD/set</th><th>Bracket</th></tr></thead><tbody>
      ${C.seeds.map((id, i) => {
        const r = st.rows[id]; const br = bracketForSeed(i + 1); const p = poolOf(r.poolId);
        return `<tr class="${id === S.myTeam ? 'me' : ''}"><td>${i + 1}</td><td class="l">${esc(name(id))}</td><td>${esc(p ? p.name.replace(/^Pool\s*/i, 'P') : '')}${r.mp ? ' (' + r.poolRank + ')' : ''}</td><td>${recStr(r)}</td><td>${r.sw + r.sl ? Math.round(r.setPct * 100) + '%' : '–'}</td><td>${r.sw + r.sl ? (r.pointDiffPerSet > 0 ? '+' : '') + r.pointDiffPerSet.toFixed(1) : '–'}</td><td>${br ? `<span class="bk bk-${esc(br.id)}">${esc(br.name)}</span>` : ''}</td></tr>`;
      }).join('')}
      </tbody></table></div>`;
    return html;
  };

  VIEWS.brackets = function () {
    const t = S.t;
    const po = Object.values(t.matches).filter((m) => m.stage === 'playoff');
    let html = '';
    if (!po.length) {
      html += `<div class="card"><p>Playoff brackets are posted after pool play. ${C.poolDone ? '' : 'Here is where teams would land if pool play ended now:'}</p></div><div class="grid">`;
      for (const br of t.brackets) {
        const ids = C.seeds.slice(+br.from - 1, +br.to);
        if (!ids.length) continue;
        html += `<section class="card"><h3><span class="bk bk-${esc(br.id)}">${esc(br.name)}</span> <span class="muted small">${esc(br.location || '')}</span></h3>
          <ol start="${br.from}" class="plain">${ids.map((id) => `<li class="${id === S.myTeam ? 'me' : ''}">${esc(name(id))}</li>`).join('')}</ol></section>`;
      }
      return html + '</div>';
    }
    for (const br of t.brackets) {
      const ms = po.filter((m) => m.bracketId === br.id);
      if (!ms.length) continue;
      const rounds = {};
      ms.forEach((m) => { (rounds[m.round] = rounds[m.round] || []).push(m); });
      const rk = Object.keys(rounds).map(Number).sort((a, b) => a - b);
      const champ = ms.find((m) => m.round === Math.max(...rk));
      const cw = champ && champ.status === 'final' ? (() => { const s = sides(champ); const w = L.finalWinner(t, champ); return w === 'a' ? s.la : w === 'b' ? s.lb : null; })() : null;
      html += `<section class="bracket"><h2 class="sec"><span class="bk bk-${esc(br.id)}">${esc(br.name)}</span> <span class="muted small">${esc(br.location || '')}</span></h2>
        ${cw ? `<div class="champ">🏆 ${esc(br.name)} champion: <b>${esc(cw)}</b></div>` : ''}
        <div class="rounds">${rk.map((r) => `<div class="round"><div class="rname">${esc(L.roundName(rounds[r][0]))}</div>
          ${rounds[r].sort((a, b) => a.idx - b.idx).map((m) => matchCard(m, { noLabel: true })).join('')}</div>`).join('')}
        </div></section>`;
    }
    return html;
  };

  // ---------------- scorekeeper ----------------
  VIEWS.score = function () {
    const t = S.t, ms = allMatches().filter((m) => { const s = sides(m); return m.stage === 'pool' || s.a || s.b; });
    if (!S.scoreId || !t.matches[S.scoreId]) {
      const pick = ms.find((m) => m.status === 'live') || ms.find((m) => m.status === 'scheduled') || ms[0];
      S.scoreId = pick ? pick.id : null;
    }
    const opt = (m) => { const s = sides(m); return `<option value="${m.id}" ${m.id === S.scoreId ? 'selected' : ''}>${esc(fmtTime(m.time))} · ${esc(m.court || '')} · ${esc(s.la)} vs ${esc(s.lb)}</option>`; };
    const grp = (label, arr) => arr.length ? `<optgroup label="${label}">${arr.map(opt).join('')}</optgroup>` : '';
    let html = `<section class="card">
      <form class="row" id="annForm"><input id="ann" placeholder="Announcement shown to everyone (optional)" value="${esc(t.announcement || '')}"><button class="btn">Post</button></form>
    </section>
    <label class="picker block">Match
      <select data-change="scoreId">${grp('Live', ms.filter((m) => m.status === 'live'))}${grp('Upcoming', ms.filter((m) => m.status === 'scheduled'))}${grp('Final', ms.filter((m) => m.status === 'final'))}</select>
    </label>`;
    const m = t.matches[S.scoreId];
    if (!m) return html + '<div class="empty">No matches yet. Set up pools in the Setup tab.</div>';
    return html + scorePanel(m);
  };

  function formatText(m) {
    const f = S.t.format;
    if (m.stage === 'pool') return `${f.pool.sets} sets to ${f.pool.points}, win by 2${+f.pool.cap ? ', cap ' + f.pool.cap : ''}`;
    const p = f.playoff;
    return `Best of ${p.bestOf} to ${p.points}${+p.cap ? ' (cap ' + p.cap + ')' : ''}, win by 2` +
      (+p.decidingPoints ? `; set ${p.bestOf} to ${p.decidingPoints}${+p.decidingCap ? ' (cap ' + p.decidingCap + ')' : ''}` : '');
  }

  function scorePanel(m) {
    const t = S.t, s = sides(m), st = L.matchState(t, m);
    const sets = m.sets || [];
    const ready = !!(s.a && s.b);
    let html = `<section class="card scorer">
      <div class="shead"><span>${esc(matchLabel(m))} · ${esc(fmtTime(m.time))} · ${esc(m.court || '')}</span>${pill(m) || '<span class="pill">Not started</span>'}</div>
      <div class="stitle">${esc(s.la)} <span class="muted">vs</span> ${esc(s.lb)}</div>
      <div class="muted small center">${esc(formatText(m))}</div>
      ${m.work ? `<div class="muted small center">Officiating: ${esc(name(m.work))}</div>` : ''}`;
    if (!ready) return html + '<p class="center warn">Teams for this match aren\'t decided yet.</p></section>';
    html += `<form id="manualForm" class="manual"><div class="mgrid"><span></span><span class="hd">${esc(s.la)}</span><span class="hd">${esc(s.lb)}</span>
        ${Array.from({ length: st.max }, (_, i) => `<span>Set ${i + 1}</span><input type="number" min="0" inputmode="numeric" name="a${i}" value="${sets[i] ? sets[i].a : ''}" aria-label="Set ${i + 1} ${esc(s.la)}"><input type="number" min="0" inputmode="numeric" name="b${i}" value="${sets[i] ? sets[i].b : ''}" aria-label="Set ${i + 1} ${esc(s.lb)}">`).join('')}
        </div>
        ${m.stage === 'playoff' ? `<p class="muted small">Leave set ${st.max} blank if it wasn't needed.</p>` : ''}
        <button class="btn primary wide">${m.status === 'final' ? 'Update final score' : 'Save final score'}</button></form>
      <div class="row wrap">
        ${m.status === 'scheduled' ? '<button class="btn ghost" data-act="startMatch">Mark as on court now</button>' : ''}
        ${m.status === 'live' ? '<button class="btn ghost" data-act="unstart">Not started yet</button>' : ''}
        ${sets.length || m.status !== 'scheduled' ? '<button class="btn danger" data-act="resetMatch">Clear result</button>' : ''}
      </div>`;
    return html + '</section>';
  }

  // ---------------- setup ----------------
  function makeDraft(t) {
    return {
      _tid: t.id, name: t.name || '', date: t.date || '', notes: t.notes || '',
      format: L.clone(t.format), tiebreakers: (t.tiebreakers || L.DEFAULT_TB).slice(), seedingMethod: t.seedingMethod || 'overall',
      brackets: L.clone(t.brackets || []), newName: '',
      pools: (t.pools || []).map((p) => ({ id: p.id, name: p.name, court: p.court || '', start: p.start || '09:30', interval: p.interval || 60, teamsText: p.teamIds.map((id) => (t.teams[id] || {}).name || '').join('\n') })),
    };
  }
  const inp = (path, val, attrs = '') => `<input data-bind="${path}" value="${esc(val)}" ${attrs}>`;

  function viewSetup() {
    const t = S.t;
    const listOpts = S.list.map((x) => `<option value="${esc(x.id)}" ${t && x.id === t.id ? 'selected' : ''}>${esc(x.name || x.id)}${x.date ? ' — ' + esc(x.date) : ''}${S.site.activeId === x.id ? ' (live)' : ''}</option>`).join('');
    let html = `<section class="card"><h3>Tournaments</h3>
      ${S.list.length ? `<div class="row wrap"><select id="tSel">${listOpts}</select><button class="btn" data-act="makeActive">Show this one to everyone</button><button class="btn danger" data-act="deleteT">Delete</button></div>` : ''}
      <div class="row wrap"><input id="newName" placeholder="New tournament name">
        <button class="btn" data-act="newBlank">Create blank</button>
        ${t ? '<button class="btn" data-act="newCopy">Create from this setup</button>' : ''}
        <button class="btn ghost" data-act="loadSample">Load Duke sample</button></div>
      <div class="row wrap">${t ? '<button class="btn ghost" data-act="export">Download backup (.json)</button>' : ''}
        <label class="btn ghost">Restore backup<input type="file" id="importFile" accept=".json,application/json" hidden></label></div>
      ${t && S.site.activeId !== t.id ? '<p class="warn">You are editing a tournament that is not the one shown to spectators.</p>' : ''}
    </section>`;
    if (!t) return html;
    const d = S.draft;
    const tbOn = d.tiebreakers, tbOff = Object.keys(L.TIEBREAKERS).filter((k) => !tbOn.includes(k));
    html += `<section class="card"><h3>Basics</h3>
      <div class="form">
        <label>Name ${inp('name', d.name)}</label>
        <label>Date ${inp('date', d.date, 'type="date"')}</label>
        <label class="full">Info shown to spectators<textarea data-bind="notes" rows="4">${esc(d.notes)}</textarea></label>
      </div></section>
    <section class="card"><h3>Match format</h3>
      <div class="form">
        <div class="full muted small">Pool play</div>
        <label>Sets played ${inp('format.pool.sets', d.format.pool.sets, 'type="number" min="1"')}</label>
        <label>Points per set ${inp('format.pool.points', d.format.pool.points, 'type="number" min="1"')}</label>
        <label>Cap (0 = none) ${inp('format.pool.cap', d.format.pool.cap, 'type="number" min="0"')}</label>
        <div class="full muted small">Playoffs</div>
        <label>Best of ${inp('format.playoff.bestOf', d.format.playoff.bestOf, 'type="number" min="1" step="2"')}</label>
        <label>Points per set ${inp('format.playoff.points', d.format.playoff.points, 'type="number" min="1"')}</label>
        <label>Cap (0 = none) ${inp('format.playoff.cap', d.format.playoff.cap, 'type="number" min="0"')}</label>
        <label>Deciding set to ${inp('format.playoff.decidingPoints', d.format.playoff.decidingPoints, 'type="number" min="0"')}</label>
        <label>Deciding set cap ${inp('format.playoff.decidingCap', d.format.playoff.decidingCap, 'type="number" min="0"')}</label>
      </div></section>
    <section class="card"><h3>Ranking</h3>
      <label>Seeding method <select data-bind="seedingMethod">
        <option value="overall" ${d.seedingMethod === 'overall' ? 'selected' : ''}>Overall stats across all pools</option>
        <option value="byFinish" ${d.seedingMethod === 'byFinish' ? 'selected' : ''}>Pool finish first (all 1st places, then 2nds…), then stats</option>
      </select></label>
      <ol class="tb">${tbOn.map((k, i) => `<li><span>${esc(L.TIEBREAKERS[k])}</span>
        <button class="ib" data-act="tb" data-k="${k}" data-op="up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="ib" data-act="tb" data-k="${k}" data-op="down" ${i === tbOn.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="ib" data-act="tb" data-k="${k}" data-op="rm">✕</button></li>`).join('')}</ol>
      ${tbOff.length ? `<div class="row wrap">${tbOff.map((k) => `<button class="btn ghost small" data-act="tb" data-k="${k}" data-op="add">+ ${esc(L.TIEBREAKERS[k])}</button>`).join('')}</div>` : ''}
    </section>
    <section class="card"><h3>Pools &amp; teams</h3>
      <p class="muted small">One team per line. Line order = team number in the schedule (1v2, 3v4…). Renaming a line keeps that team's results.</p>
      <div class="grid">${d.pools.map((p, i) => `<div class="pooled">
        <div class="form">
          <label>Name ${inp(`pools.${i}.name`, p.name)}</label>
          <label>Court ${inp(`pools.${i}.court`, p.court)}</label>
          <label>First match ${inp(`pools.${i}.start`, p.start, 'type="time"')}</label>
          <label>Minutes per match ${inp(`pools.${i}.interval`, p.interval, 'type="number" min="10" step="5"')}</label>
          <label class="full">Teams (${String(p.teamsText || '').split('\n').filter((x) => x.trim()).length})<textarea data-bind="pools.${i}.teamsText" rows="5">${esc(p.teamsText)}</textarea></label>
        </div>
        <button class="btn danger small" data-act="rmPool" data-i="${i}">Remove pool</button></div>`).join('')}</div>
      <button class="btn ghost" data-act="addPool">+ Add pool</button>
    </section>
    <section class="card"><h3>Playoff brackets</h3>
      ${(() => { const n = Object.keys(t.teams).length; const top = Math.max(0, ...d.brackets.map((b) => +b.to || 0)); return `<p class="muted small">${n} teams in pools (saved). Brackets cover seeds 1–${top}.${n > top ? ` <span class="warn">Seeds ${top + 1}–${n} aren't in any bracket.</span>` : ''}</p>`; })()}
      <table class="tbl edit"><thead><tr><th class="l">Name</th><th>Seeds from</th><th>to</th><th class="l">Location</th><th></th></tr></thead><tbody>
      ${d.brackets.map((b, i) => `<tr><td>${inp(`brackets.${i}.name`, b.name)}</td><td>${inp(`brackets.${i}.from`, b.from, 'type="number" min="1"')}</td><td>${inp(`brackets.${i}.to`, b.to, 'type="number" min="1"')}</td><td>${inp(`brackets.${i}.location`, b.location)}</td><td><button class="ib" data-act="rmBracket" data-i="${i}">✕</button></td></tr>`).join('')}
      </tbody></table>
      <button class="btn ghost" data-act="addBracket">+ Add bracket</button>
    </section>
    <div class="savebar"><button id="saveBtn" class="btn primary ${S.draftDirty ? 'dirty' : ''}" data-act="saveSetup">Save setup</button><button class="btn ghost" data-act="discard">Discard changes</button></div>`;

    // Pool schedule (writes immediately)
    html += `<section class="card"><h3>Pool schedule</h3>
      <p class="muted small">Edits here save immediately. Regenerating replaces that pool's matches and clears their scores.</p>
      <button class="btn" data-act="genAll">Regenerate all pool schedules</button>`;
    for (const p of t.pools) {
      const ms = allMatches().filter((m) => m.poolId === p.id);
      const teamOpts = (sel) => `<option value="">—</option>` + p.teamIds.map((id) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(name(id))}</option>`).join('');
      html += `<h4>${esc(p.name)} <button class="btn ghost small" data-act="genPool" data-p="${p.id}">Regenerate</button></h4>
        <div class="scroll"><table class="tbl edit"><thead><tr><th>Time</th><th class="l">Court</th><th class="l">Team</th><th class="l">vs</th><th class="l">Officiating</th><th>Score</th></tr></thead><tbody>
        ${ms.map((m) => `<tr>
          <td><input type="time" data-mf="time" data-mid="${m.id}" value="${esc(m.time)}"></td>
          <td><input data-mf="court" data-mid="${m.id}" value="${esc(m.court)}"></td>
          <td><select data-mf="a" data-mid="${m.id}">${teamOpts(m.a)}</select></td>
          <td><select data-mf="b" data-mid="${m.id}">${teamOpts(m.b)}</select></td>
          <td><select data-mf="work" data-mid="${m.id}">${teamOpts(m.work)}</select></td>
          <td class="small">${(m.sets || []).map((x) => x.a + '-' + x.b).join(', ') || '—'} ${m.status !== 'scheduled' ? esc(m.status) : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    html += '</section>';

    // Seeding + playoffs
    const bOrder = (id) => t.brackets.findIndex((b) => b.id === id);
    const po = allMatches().filter((m) => m.stage === 'playoff').sort((x, y) => (bOrder(x.bracketId) - bOrder(y.bracketId)) || (x.round - y.round) || (x.idx - y.idx));
    html += `<section class="card"><h3>Seeding &amp; playoffs</h3>
      <p class="muted small">${C.locked ? 'Seeds are <b>locked</b>. Use the arrows to adjust.' : 'Seeds are <b>automatic</b> (from live standings). Use the arrows to lock and adjust.'} ${C.poolDone ? '' : '<span class="warn">Pool play is not finished.</span>'}</p>
      <ol class="seedlist">${C.seeds.map((id, i) => { const br = bracketForSeed(i + 1); return `<li><span class="sn">${i + 1}</span><span class="grow">${esc(name(id))}</span>${br ? `<span class="bk bk-${esc(br.id)}">${esc(br.name)}</span>` : ''}
        <button class="ib" data-act="seed" data-i="${i}" data-op="up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="ib" data-act="seed" data-i="${i}" data-op="down" ${i === C.seeds.length - 1 ? 'disabled' : ''}>↓</button></li>`; }).join('')}</ol>
      <div class="row wrap">${C.locked ? '<button class="btn ghost" data-act="unlockSeeds">Back to automatic seeds</button>' : '<button class="btn ghost" data-act="lockSeeds">Lock seeds</button>'}
        <button class="btn primary" data-act="buildBrackets">${po.length ? 'Rebuild' : 'Build'} playoff brackets</button></div>`;
    if (po.length) {
      html += `<div class="scroll"><table class="tbl edit"><thead><tr><th class="l">Match</th><th class="l">Teams</th><th>Time</th><th class="l">Court</th></tr></thead><tbody>
        ${po.map((m) => { const s = sides(m); return `<tr><td>${esc(matchLabel(m, true))}</td><td class="small">${esc(s.la)} vs ${esc(s.lb)}</td>
          <td><input type="time" data-mf="time" data-mid="${m.id}" value="${esc(m.time)}"></td><td><input data-mf="court" data-mid="${m.id}" value="${esc(m.court)}"></td></tr>`; }).join('')}
        </tbody></table></div>`;
    }
    return html + '</section>';
  }
  VIEWS.setup = viewSetup;

  function saveSetup() {
    const d = S.draft, t = S.t;
    const teams = {}, used = new Set();
    const pools = d.pools.map((p) => {
      const old = t.pools.find((o) => o.id === p.id);
      const names = String(p.teamsText || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const teamIds = names.map((n, i) => {
        let id = old && old.teamIds[i];
        if (!id || used.has(id)) id = L.uid('tm');
        used.add(id);
        teams[id] = { name: n };
        return id;
      });
      return { id: p.id, name: p.name || 'Pool', court: p.court || '', start: p.start || '09:30', interval: +p.interval || 60, teamIds };
    });
    const brackets = d.brackets.map((b) => ({ id: b.id, name: b.name || 'Bracket', from: Math.max(1, +b.from || 1), to: Math.max(1, +b.to || 1), location: b.location || '' }));
    const num = (o) => { const r = {}; for (const k of Object.keys(o)) r[k] = +o[k] || 0; return r; };
    const fields = {
      name: d.name || 'Tournament', date: d.date || '', notes: d.notes || '',
      format: { pool: num(d.format.pool), playoff: num(d.format.playoff) },
      tiebreakers: d.tiebreakers.slice(), seedingMethod: d.seedingMethod, brackets, pools, teams,
    };
    // New pools (or pools with no matches yet) get a schedule automatically
    const matches = L.clone(t.matches || {});
    let added = false;
    for (const p of pools) {
      const has = Object.values(matches).some((m) => m.poolId === p.id);
      const old = t.pools.find((o) => o.id === p.id);
      if (!has || (old && old.teamIds.length !== p.teamIds.length)) {
        for (const k of Object.keys(matches)) if (matches[k].poolId === p.id) delete matches[k];
        Object.assign(matches, L.generatePoolMatches(p));
        added = true;
      }
    }
    for (const k of Object.keys(matches)) if (matches[k].stage === 'pool' && !pools.find((p) => p.id === matches[k].poolId)) { delete matches[k]; added = true; }
    if (added) fields.matches = matches;
    writeFields(fields).then(() => { S.draft = makeDraft(S.t); S.draftDirty = false; render(); toast('Setup saved'); });
  }

  async function refreshList() {
    try { S.list = await S.store.list(); } catch (e) { S.list = []; }
    S.list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }
  async function createT(t) {
    await S.store.save(t);
    await S.store.setActive(t.id);
    await refreshList();
    S.draft = null;
    if (!urlT) watchT(t.id);
    toast('Created and published: ' + t.name);
  }

  // ---------------- actions ----------------
  const ACT = {
    tab(el) {
      S.tab = el.dataset.tab; ls.set('tab', S.tab);
      if (S.tab === 'setup') { refreshList().then(render); if (S.t && !S.draftDirty) S.draft = makeDraft(S.t); }
      render(); window.scrollTo(0, 0);
    },
    showLogin() { S.showLogin = true; S.loginErr = ''; render(); },
    closeLogin(el, e) { if (el.dataset.self && e.target !== el) return; S.showLogin = false; render(); },
    logout() { S.store.logout(); S.tab = 'live'; },
    startMatch() { writeMatch(S.scoreId, { status: 'live' }); toast('Shown as on court now'); },
    unstart() { writeMatch(S.scoreId, { status: 'scheduled' }); },
    resetMatch() { if (confirm('Clear the result for this match?')) writeMatch(S.scoreId, { sets: [], status: 'scheduled' }); },
    tb(el) {
      const k = el.dataset.k, a = S.draft.tiebreakers, i = a.indexOf(k);
      if (el.dataset.op === 'add') a.push(k);
      else if (el.dataset.op === 'rm') a.splice(i, 1);
      else { const j = el.dataset.op === 'up' ? i - 1 : i + 1; [a[i], a[j]] = [a[j], a[i]]; }
      S.draftDirty = true; render();
    },
    addPool() {
      const n = S.draft.pools.length + 1;
      S.draft.pools.push({ id: L.uid('p'), name: 'Pool ' + n, court: '', start: '09:30', interval: 60, teamsText: '' });
      S.draftDirty = true; render();
    },
    rmPool(el) { if (confirm('Remove this pool? Its matches are deleted when you save.')) { S.draft.pools.splice(+el.dataset.i, 1); S.draftDirty = true; render(); } },
    addBracket() { const last = S.draft.brackets[S.draft.brackets.length - 1]; const from = last ? +last.to + 1 : 1; S.draft.brackets.push({ id: L.uid('b'), name: 'New', from, to: from + 3, location: '' }); S.draftDirty = true; render(); },
    rmBracket(el) { S.draft.brackets.splice(+el.dataset.i, 1); S.draftDirty = true; render(); },
    saveSetup,
    discard() { S.draft = makeDraft(S.t); S.draftDirty = false; render(); },
    genAll() {
      if (!confirm('Regenerate every pool schedule? All pool scores will be cleared.')) return;
      const matches = {};
      for (const m of Object.values(S.t.matches)) if (m.stage !== 'pool') matches[m.id] = m;
      S.t.pools.forEach((p) => Object.assign(matches, L.generatePoolMatches(p)));
      writeFields({ matches }); render(); toast('Pool schedules regenerated');
    },
    genPool(el) {
      const p = poolOf(el.dataset.p);
      if (!confirm(`Regenerate ${p.name}? Its scores will be cleared.`)) return;
      const matches = L.clone(S.t.matches);
      for (const k of Object.keys(matches)) if (matches[k].poolId === p.id) delete matches[k];
      Object.assign(matches, L.generatePoolMatches(p));
      writeFields({ matches }); render();
    },
    seed(el) {
      const a = C.seeds.slice(), i = +el.dataset.i, j = el.dataset.op === 'up' ? i - 1 : i + 1;
      [a[i], a[j]] = [a[j], a[i]];
      writeFields({ seedOrder: a }); render();
    },
    lockSeeds() { writeFields({ seedOrder: C.seeds.slice() }); render(); toast('Seeds locked'); },
    unlockSeeds() { writeFields({ seedOrder: null }); render(); },
    buildBrackets() {
      const po = Object.values(S.t.matches).filter((m) => m.stage === 'playoff');
      if (po.some((m) => (m.sets || []).length) && !confirm('Rebuilding clears all playoff scores. Continue?')) return;
      if (!C.poolDone && !confirm('Pool play is not finished. Build brackets anyway?')) return;
      const matches = {};
      for (const m of Object.values(S.t.matches)) if (m.stage === 'pool') matches[m.id] = m;
      for (const br of S.t.brackets) Object.assign(matches, L.buildBracket(br, C.seeds.length));
      writeFields({ matches, seedOrder: C.seeds.slice(), bracketsBuilt: true }); render(); toast('Brackets built — seeds locked');
    },
    makeActive() { const id = $('#tSel').value; S.store.setActive(id).then(() => { toast('Now showing to everyone'); refreshList().then(render); }); if (!urlT) watchT(id); },
    deleteT() {
      const id = $('#tSel').value; const x = S.list.find((y) => y.id === id);
      if (!confirm(`Permanently delete "${x ? x.name : id}"?`)) return;
      S.store.remove(id).then(async () => {
        await refreshList();
        if (S.site.activeId === id) await S.store.setActive(S.list[0] ? S.list[0].id : null);
        if (S.tid === id) watchT(S.list[0] ? S.list[0].id : null);
        render();
      });
    },
    newBlank() { createT(L.blankTournament(($('#newName').value || '').trim() || 'New Tournament')); },
    newCopy() { createT(L.copySetup(S.t, ($('#newName').value || '').trim() || S.t.name + ' (copy)')); },
    loadSample() { createT(L.sampleTournament()); },
    export() {
      const blob = new Blob([JSON.stringify(S.t, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (S.t.name || 'tournament').replace(/[^\w-]+/g, '_') + '.json';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (fn) { if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.bind && S.draft) {
      L.setPath(S.draft, el.dataset.bind, el.value);
      S.draftDirty = true;
      const b = $('#saveBtn'); if (b) b.classList.add('dirty');
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change === 'myTeam') { S.myTeam = el.value; ls.set('myTeam', el.value); render(); }
    else if (el.dataset.change === 'scoreId') { S.scoreId = el.value; render(); }
    else if (el.dataset.mf) {
      const v = el.value || null;
      const fields = { [`matches.${el.dataset.mid}.${el.dataset.mf}`]: el.dataset.mf === 'time' || el.dataset.mf === 'court' ? (el.value || '') : v };
      writeFields(fields); toast('Saved');
    } else if (el.id === 'importFile' && el.files[0]) {
      el.files[0].text().then((txt) => {
        const t = JSON.parse(txt);
        if (!t || !t.id || !t.pools) throw new Error('Not a tournament backup');
        return createT(t);
      }).catch((err) => toast('Import failed: ' + err.message));
    }
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'loginForm') {
      const code = $('#code').value;
      S.store.login(code).then(() => { S.showLogin = false; S.tab = 'score'; ls.set('tab', 'score'); render(); })
        .catch((err) => { S.loginErr = /wrong|invalid|password|credential/i.test(err.code || err.message) ? 'Wrong code.' : (err.message || 'Login failed'); render(); });
    } else if (e.target.id === 'annForm') {
      writeFields({ announcement: $('#ann').value.trim() }); render(); toast('Announcement posted');
    } else if (e.target.id === 'manualForm') {
      const f = e.target, m = S.t.matches[S.scoreId], max = L.maxSets(S.t, m), sets = [];
      for (let i = 0; i < max; i++) {
        const a = f['a' + i].value, b = f['b' + i].value;
        if (a === '' && b === '') continue;
        if (+a === 0 && +b === 0) continue;
        sets.push({ a: +a || 0, b: +b || 0 });
      }
      if (!sets.length) return toast('Enter the set scores first');
      const st = L.matchState(S.t, Object.assign({}, m, { sets }));
      const problems = [];
      st.winners.forEach((w, i) => { if (!w) problems.push(`Set ${i + 1} (${sets[i].a}-${sets[i].b}) isn't a finished set`); });
      if (!st.complete) problems.push('the match isn\'t complete under the rules');
      if (m.stage === 'playoff' && st.complete && sets.length > st.aw + st.bw) problems.push('there is an extra set after the match was decided');
      if (problems.length && !confirm('Check the scores: ' + problems.join('; ') + '.\n\nSave as final anyway?')) return;
      writeMatch(m.id, { sets, status: 'final' });
      toast('Final score saved');
    }
  });

  // ---------------- boot ----------------
  async function boot() {
    try {
      S.store = await window.VBStore.createStore();
    } catch (e) {
      $('#app').innerHTML = `<div class="empty">Could not connect to the database. Check config.js.<br><small>${esc(e.message)}</small></div>`;
      return;
    }
    if (S.store.mode === 'demo') {
      const list = await S.store.list();
      if (!list.length) { const t = L.sampleTournament(); await S.store.save(t); await S.store.setActive(t.id); }
    }
    let first = true;
    S.store.onAuth((a) => {
      const changed = a !== S.authed;
      S.authed = a;
      if (first || changed) { first = false; subscribe(); }
      render();
    });
    render();
  }
  boot();
})();
