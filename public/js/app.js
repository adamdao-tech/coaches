import { normalize, normalizeBoard, mergeLobbies, canonicalize } from './adapter.js';
import { computeStats, headToHead, sortedRecords, byLobbyOrder } from './stats.js';
import { loadChampions, champTag } from './champions.js';

const wl = (r) => `<span class="wl"><b class="${r.wins ? 'win' : 'zero'}">${r.wins}W</b> <b class="${r.losses ? 'loss' : 'zero'}">${r.losses}L</b></span>`;
const wrOf = (r) => pct(r.wins / ((r.wins + r.losses) || 1));
const topChamps = (p, n = 3) => sortedRecords(p.champs).slice(0, n);

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const state = {
  lobbies: [], stats: new Map(), source: '', updated: null,
  board: [], sort: { col: 'rank', dir: 1 }, q: '', minGames: 0,
};

/* ---------- načítání dat ---------- */

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function loadData() {
  await loadChampions();
  const custom = LS.get('coaches.url');
  const pasted = LS.get('coaches.pasted');
  const single = [];
  if (pasted) single.push(['vložený JSON', async () => JSON.parse(pasted)]);
  if (custom) single.push([custom, () => fetchJson(custom)]);
  for (const [label, fn] of single) {
    try {
      const lobbies = normalize(await fn());
      if (!lobbies.length) throw new Error('žádná lobby v datech');
      return setData(lobbies, label);
    } catch (e) { console.warn(`Zdroj „${label}“ selhal:`, e.message); }
  }

  // Hlavní zdroj: Streamers Queue API (přes Worker, klíč zůstává na serveru)
  const [sqGames, sqPlayers] = await Promise.allSettled([fetchJson('/api/sq/games'), fetchJson('/api/sq/players')]);
  const got = (r) => (r.status === 'fulfilled' ? r.value : null);
  if (got(sqGames) && got(sqPlayers)) {
    const board = normalizeBoard(got(sqPlayers));
    const lobbies = canonicalize(normalize(got(sqGames)), board);
    if (lobbies.length || board.length) return setData(lobbies, 'Streamers Queue API', board);
  }

  // Záloha: uložená historie z repa + živá lobby + žebříček ze streamersclash.cz
  const [hist, live, board] = await Promise.allSettled([
    fetchJson('data/matches.json'),
    fetchJson('/api/data'),
    fetchJson('/api/board').catch(() => fetchJson('data/board.json')),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  const lobbies = mergeLobbies(ok(hist) ? normalize(ok(hist)) : [], ok(live) ? normalize(ok(live)) : []);
  const boardList = ok(board) ? normalizeBoard(ok(board)) : [];
  if (lobbies.length || boardList.length) {
    return setData(lobbies, ok(live) ? 'živá data · Streamers Clash' : 'Streamers Clash (uložená data)', boardList);
  }
  try { setData(normalize(await fetchJson('sample-lobbies.json')), 'ukázková data'); }
  catch { setData([], 'žádný zdroj'); }
}

function setData(lobbies, source, board = []) {
  state.lobbies = lobbies;
  state.board = board;
  state.stats = computeStats(lobbies, board);
  state.source = source;
  state.updated = new Date();
  renderMeta();
  // při obnově nepřekreslovat celé UI (ztratil by se fokus v hledání)
  if ($('table.players tbody')) renderPlayersTable();
  else if ($('#h2h-out')) runH2H();
  else route();
}

/* ---------- hlavička ---------- */

function renderMeta() {
  const done = state.lobbies.filter((l) => l.winner).length;
  const demo = state.source === 'ukázková data';
  $('#source').innerHTML = `
    <span class="badge ${demo ? 'badge-warn' : 'badge-ok'}">${esc(state.source)}</span>
    <span class="muted">${state.stats.size} hráčů · ${done} uložených zápasů${state.lobbies.length - done ? ` · ${state.lobbies.length - done} živých/čekajících` : ''} · ${state.updated.toLocaleTimeString('cs-CZ')}</span>`;
  const dl = $('#player-list');
  dl.innerHTML = [...state.stats.values()].map((p) => `<option value="${esc(p.name)}">`).join('');
}

/* ---------- routing (#hraci, #zapasy, #h2h, #hrac/Jméno) ---------- */

function route() {
  const [view, ...rest] = decodeURIComponent(location.hash.slice(1) || 'hraci').split('/');
  const arg = rest.join('/');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === (view === 'hrac' ? 'hraci' : view)));
  const main = $('#main');
  if (view === 'zapasy') main.innerHTML = renderMatches(arg || 'vse');
  else if (view === 'h2h') { main.innerHTML = renderH2HShell(arg); runH2H(); }
  else if (view === 'hrac' && arg) main.innerHTML = renderPlayer(arg);
  else { main.innerHTML = renderPlayersShell(); renderPlayersTable(); }
}

/* ---------- tabulka hráčů ---------- */

const COLS = [
  ['rank', '#', (p, i) => `<span class="muted">${p.rank ?? i + 1}</span>`],
  ['name', 'Hráč', (p) => `${playerCell(p)}${p.tier ? ` <span class="tier tier-${esc(p.tier)}">${esc(p.tier)}</span>` : ''}`],
  ['elo', 'ELO', (p) => (p.elo == null ? '<span class="muted">–</span>' : `<b>${p.elo}</b>`)],
  ['games', 'Zápasy', (p) => `${p.games}${p.pending ? `<span class="muted small" title="právě hraje / čeká"> +${p.pending}</span>` : ''}`],
  ['wins', 'W', (p) => `<span class="win">${p.wins}</span>`],
  ['losses', 'L', (p) => `<span class="loss">${p.losses}</span>`],
  ['wr', 'Winrate', (p) => wrBar(p.wr)],
  ['form', 'Forma', (p) => formDots(p.form)],
  ['streak', 'Série', (p) => `<span class="${p.streak[0] === 'W' ? 'win' : 'loss'}">${esc(p.streak)}</span>`],
  ['champs', 'Championi', (p) => `<span class="champ-row">${topChamps(p).map((c) => `<span title="${esc(c.name)} ${c.wins}W ${c.losses}L">${champTag(c.name, { label: false })}</span>`).join('') || '<span class="muted">–</span>'}</span>`],
  ['opgg', 'OP.GG', (p) => opggLinks(p.opgg)],
];
const TEXT_COLS = ['name', 'form', 'opgg', 'champs'];

// sloupce bez dat (championi, OP.GG) skryj
function visibleCols() {
  const ps = [...state.stats.values()];
  return COLS.filter(([c]) => (c === 'champs' ? ps.some((p) => p.champs.size) : c === 'opgg' ? ps.some((p) => p.opgg.length) : c === 'elo' ? ps.some((p) => p.elo != null) : true));
}

function renderPlayersShell() {
  return `
    <div class="toolbar">
      <input id="q" type="search" placeholder="Hledat hráče…" value="${esc(state.q)}">
      <label class="muted">Min. zápasů <input id="min" type="number" min="0" value="${state.minGames}"></label>
      <button class="btn ghost" id="csv">Export CSV</button>
    </div>
    <div class="table-wrap"><table class="players">
      <thead><tr>${visibleCols().map(([c, l]) => `<th data-col="${c}" class="${TEXT_COLS.includes(c) ? '' : 'num'}">${l}</th>`).join('')}</tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="muted small">${state.source === 'Streamers Queue API'
      ? 'Pořadí je podle počtu výher (jako oficiální žebříček), ELO a W/L jsou ze Streamers Queue API. Forma, série a soupeři/spoluhráči se počítají z celé historie zápasů. Živé zápasy se obnovují každou minutu.'
      : 'W/L a pořadí jsou z oficiálního žebříčku. Forma, série a detail (soupeři, spoluhráči) se počítají z uložených zápasů.'}</p>`;
}

function filteredPlayers() {
  const q = state.q.toLowerCase();
  const { col, dir } = state.sort;
  const val = (p) => (col === 'name' ? p.name.toLowerCase() : col === 'rank' ? (p.rank ?? 1e9) : col === 'wr' ? (p.wr ?? -1) : col === 'streak' ? streakVal(p.streak) : col === 'form' ? p.form.filter((f) => f === 'W').length : col === 'champs' ? p.champs.size : col === 'opgg' ? p.opgg.length : col === 'elo' ? (p.elo ?? -1e9) : p[col]);
  return [...state.stats.values()]
    .filter((p) => (!q || p.name.toLowerCase().includes(q)) && p.games >= state.minGames)
    .sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return c * dir || b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name);
    });
}
const streakVal = (s) => (!s ? 0 : (s[0] === 'W' ? 1 : -1) * parseInt(s.slice(1), 10));

function renderPlayersTable() {
  const rows = filteredPlayers();
  const cols = visibleCols();
  $('table.players tbody').innerHTML = rows.length ? rows.map((p, i) => `
    <tr data-name="${esc(p.name)}">${cols.map(([c, , fn]) => `<td class="${TEXT_COLS.includes(c) ? '' : 'num'}">${fn(p, i)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="empty">Nic nenalezeno</td></tr>`;
  document.querySelectorAll('th[data-col]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.col === state.sort.col);
    th.dataset.dir = state.sort.dir;
  });
}

const avatar = (p, size = 26) => p.avatar
  ? `<img class="av" src="${esc(p.avatar)}" width="${size}" height="${size}" alt="" loading="lazy" referrerpolicy="no-referrer">`
  : `<span class="av av-fallback" style="width:${size}px;height:${size}px">${esc(p.name[0] || '?')}</span>`;

const playerCell = (p) => `<a class="pl" href="#hrac/${encodeURIComponent(p.name)}">${avatar(p)}<span>${esc(p.name)}</span></a>`;
const wrBar = (wr) => wr == null ? '<span class="muted">–</span>' :
  `<span class="wr"><span class="wr-bar"><i style="width:${Math.round(wr * 100)}%" class="${wr >= 0.5 ? 'hi' : 'lo'}"></i></span>${pct(wr)}</span>`;
const formDots = (f) => f.length ? `<span class="form">${f.map((r) => `<i class="${r === 'W' ? 'w' : 'l'}" title="${r}"></i>`).join('')}</span>` : '<span class="muted">–</span>';
const opggLinks = (list) => list.length
  ? list.map((o) => `<a class="opgg" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.region.toUpperCase())}</a>`).join(' ')
  : '<span class="muted">–</span>';

/* ---------- detail hráče ---------- */

function renderPlayer(name) {
  const p = state.stats.get(name.toLowerCase());
  if (!p) return `<p class="empty">Hráč „${esc(name)}“ v datech není. <a href="#hraci">Zpět</a></p>`;

  const vs = sortedRecords(p.vs);
  const beat = vs.filter((r) => r.wins > 0).sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 10);
  const lost = vs.filter((r) => r.losses > 0).sort((a, b) => b.losses - a.losses || a.wins - b.wins).slice(0, 10);
  const mates = sortedRecords(p.with).slice(0, 12);
  const champs = sortedRecords(p.champs);

  const recList = (list, mode) => list.length ? `<ul class="rec">${list.map((r) => `
    <li><a href="#h2h/${encodeURIComponent(p.name)}/${encodeURIComponent(r.name)}">${esc(r.name)}</a>
      ${wl(r)}</li>`).join('')}</ul>` : '<p class="muted">Zatím nic</p>';

  return `
    <a href="#hraci" class="back">← Všichni hráči</a>
    <section class="hero">
      ${avatar(p, 64)}
      <div>
        <h2>${esc(p.name)}</h2>
        <div class="hero-meta">
          ${p.rank ? `<span class="badge">#${p.rank} v žebříčku</span>` : ''}
          ${p.lastPlayedAt ? `<span class="muted small">naposledy hrál ${esc(fmtTime(p.lastPlayedAt))}</span>` : ''}
          ${p.tier ? `<span class="tier tier-${esc(p.tier)}">${esc(p.tier)}</span>` : ''}
          ${p.profile ? `<a class="badge" href="${esc(p.profile)}" target="_blank" rel="noopener">profil na SC ↗</a>` : ''}
          ${p.opgg.length ? opggLinks(p.opgg) : ''}
        </div>
        <div class="muted small">Detail níže je z ${p.tracked.games} uložených zápasů${p.board ? ` (celkem ${p.games})` : ''}.</div>
      </div>
      <div class="kpis">
        ${p.elo != null ? `<div><b>${p.elo}</b><span>ELO</span></div>` : ''}
        <div><b>${p.games}</b><span>zápasů</span></div>
        <div><b class="win">${p.wins}</b><span>W</span></div>
        <div><b class="loss">${p.losses}</b><span>L</span></div>
        <div><b>${pct(p.wr)}</b><span>winrate</span></div>
        <div><b>${formDots(p.form)}</b><span>forma</span></div>
      </div>
    </section>
    <div class="grid3">
      <section class="card"><h3>Porazil</h3>${recList(beat, 'beat')}</section>
      <section class="card"><h3>Prohrál proti</h3>${recList(lost, 'lost')}</section>
      <section class="card"><h3>Spoluhráči</h3>${mates.length ? `<ul class="rec">${mates.map((r) => `
        <li><a href="#hrac/${encodeURIComponent(r.name)}">${esc(r.name)}</a>
        ${wl(r)}<span class="muted small pc">${wrOf(r)}</span></li>`).join('')}</ul>` : '<p class="muted">Zatím nic</p>'}</section>
    </div>
    ${champs.length ? `<section class="card"><h3>Championi</h3><ul class="rec">${champs.map((r) => `<li>${champTag(r.name, { size: 28 })}${wl(r)}<span class="muted small pc">${wrOf(r)}</span></li>`).join('')}</ul></section>` : ''}
    <section class="card">
      <h3>Historie zápasů</h3>
      <table class="hist"><thead><tr><th>Lobby</th><th>Strana</th><th>Výsledek</th>${p.history.some((h) => h.champion) ? '<th>Champion</th>' : ''}<th>Spoluhráči</th><th>Soupeři</th></tr></thead>
      <tbody>${[...p.history].reverse().map((h) => `
        <tr><td>#${esc(h.lobbyId)}</td>
          <td><span class="side ${h.side}">${h.side === 'blue' ? 'BLUE' : 'RED'}</span></td>
          <td>${h.result ? `<b class="${h.result === 'W' ? 'win' : 'loss'}">${h.result}</b>` : '<span class="muted">čeká</span>'}</td>
          ${p.history.some((x) => x.champion) ? `<td>${champTag(h.champion)}</td>` : ''}
          <td class="names">${h.allies.map(nameLink).join(', ')}</td>
          <td class="names">${h.enemies.map(nameLink).join(', ')}</td></tr>`).join('')}</tbody></table>
    </section>`;
}
const nameLink = (n) => `<a href="#hrac/${encodeURIComponent(n)}">${esc(n)}</a>`;

/* ---------- zápasy ---------- */

const MATCH_FILTERS = [['vse', 'Vše'], ['zive', 'Živé a čekající'], ['odehrane', 'Odehrané']];
const MATCH_LIMIT = 60;

function renderMatches(filter = 'vse') {
  let list = [...state.lobbies].sort(byLobbyOrder).reverse();
  if (filter === 'zive') list = list.filter((l) => !l.winner);
  if (filter === 'odehrane') list = list.filter((l) => l.winner);
  const total = list.length;
  list = list.slice(0, MATCH_LIMIT);
  const opgg = (l, side) => (l.opgg?.[side] || []).map((o) => `<a class="opgg" href="${esc(o.url)}" target="_blank" rel="noopener" title="OP.GG multisearch (${o.players} hráčů)">${esc(String(o.server).toUpperCase())} ${o.players}/5</a>`).join(' ');
  const team = (l, side) => `
    <div class="team ${side} ${l.winner === side ? 'won' : l.winner ? 'lost' : ''}">
      <h4>${side === 'blue' ? 'BLUE' : 'RED'}${l.winner === side ? ' <span class="tag">W</span>' : ''}
        ${l.teamInfo?.[side]?.avgElo ? `<span class="muted small" title="Průměrné ELO týmu">Ø ${l.teamInfo[side].avgElo}</span>` : ''}
        ${l.odds ? `<span class="odds ${l.odds[side] >= 50 ? 'fav' : ''}" title="Předpověď výhry podle ELO">${Math.round(l.odds[side])} %</span>` : ''}</h4>
      ${l[side].map((p) => { const s = state.stats.get(p.name.toLowerCase()); return `
        <a class="pl" href="#hrac/${encodeURIComponent(p.name)}">${p.champion ? champTag(p.champion, { label: false }) : avatar(p, 22)}<span>${esc(p.name)}</span>
        <span class="muted small">${s && s.games ? `${s.wins}W ${s.losses}L` : ''}</span></a>`; }).join('')}
      ${l.opgg?.[side]?.length ? `<div class="team-opgg">${opgg(l, side)}</div>` : ''}
    </div>`;
  return `
    <div class="toolbar">${MATCH_FILTERS.map(([k, label]) => `<a class="chip ${k === filter ? 'active' : ''}" href="#zapasy/${k}">${label}</a>`).join('')}
      <span class="muted small">${total > MATCH_LIMIT ? `zobrazeno ${MATCH_LIMIT} z ${total}` : `${total} lobby`}</span></div>
    ${list.length ? `<div class="lobbies">${list.map((l) => `
    <article class="lobby">
      <header><b>#${esc(l.id)}</b><span class="badge ${l.status === 'hraje se' ? 'badge-live' : ''}">${esc(l.winner ? 'odehráno' : (l.status || 'čeká'))}</span>
      <span class="muted">${l.time ? esc(fmtTime(l.time)) : ''}${l.timeTo ? `–${esc(l.timeTo)}` : ''}</span></header>
      <div class="teams">${team(l, 'blue')}${team(l, 'red')}</div>
    </article>`).join('')}</div>` : '<p class="empty">Žádná lobby</p>'}`;
}
function fmtTime(t) {
  const d = new Date(t);
  return isNaN(d) ? String(t) : d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ---------- head to head ---------- */

function renderH2HShell(arg) {
  const [a = '', b = ''] = arg.split('/');
  return `
    <div class="toolbar">
      <input id="h2h-a" list="player-list" placeholder="Hráč A" value="${esc(a)}">
      <span class="muted">vs</span>
      <input id="h2h-b" list="player-list" placeholder="Hráč B" value="${esc(b)}">
    </div>
    <div id="h2h-out"></div>`;
}

function runH2H() {
  const a = $('#h2h-a').value.trim(), b = $('#h2h-b').value.trim();
  const out = $('#h2h-out');
  if (!a || !b) { out.innerHTML = '<p class="muted">Vyber dva hráče – uvidíš bilanci proti sobě i spolu v týmu.</p>'; return; }
  const r = headToHead(state.lobbies, a, b);
  const gameRow = (l, note) => `<li><a href="#zapasy">#${esc(l.id)}</a> ${note}</li>`;
  out.innerHTML = `
    <div class="grid2">
      <section class="card"><h3>Proti sobě</h3>
        <div class="score"><span>${esc(a)}</span><b class="win">${r.against.aWins}</b>:<b class="loss">${r.against.bWins}</b><span>${esc(b)}</span></div>
        <ul class="rec">${r.against.games.map((g) => gameRow(g.lobby, g.lobby.winner ? `vyhrál <b>${esc(g.lobby.winner === g.aSide ? a : b)}</b>` : '<span class="muted">čeká</span>')).join('') || '<li class="muted">Ještě proti sobě nehráli</li>'}</ul>
      </section>
      <section class="card"><h3>Spolu v týmu</h3>
        <div class="score"><b class="win">${r.together.wins}</b>:<b class="loss">${r.together.losses}</b></div>
        <ul class="rec">${r.together.games.map((g) => gameRow(g.lobby, g.lobby.winner ? (g.lobby.winner === g.side ? '<b class="win">W</b>' : '<b class="loss">L</b>') : '<span class="muted">čeká</span>')).join('') || '<li class="muted">Ještě spolu nehráli</li>'}</ul>
      </section>
    </div>`;
}

/* ---------- export ---------- */

function exportCsv() {
  const rows = [['hrac', 'zapasy', 'vyhry', 'prohry', 'winrate', 'forma', 'serie', 'porazil', 'prohral_proti', 'championi', 'opgg']];
  for (const p of filteredPlayers()) {
    const vs = sortedRecords(p.vs);
    rows.push([
      p.name, p.games, p.wins, p.losses, p.wr == null ? '' : (p.wr * 100).toFixed(1), p.form.join(''), p.streak,
      vs.filter((r) => r.wins).map((r) => `${r.name} ${r.wins}W`).join('; '),
      vs.filter((r) => r.losses).map((r) => `${r.name} ${r.losses}L`).join('; '),
      sortedRecords(p.champs).map((c) => `${c.name} ${c.wins}W ${c.losses}L`).join('; '),
      p.opgg.map((o) => o.url).join(' '),
    ]);
  }
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `scouting-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- dialog se zdrojem dat ---------- */

function openSourceDialog() {
  const d = $('#src-dialog');
  $('#src-url').value = LS.get('coaches.url') || '';
  $('#src-json').value = '';
  d.showModal();
}

async function applySource(e) {
  e.preventDefault();
  const url = $('#src-url').value.trim();
  const txt = $('#src-json').value.trim();
  const err = $('#src-err');
  err.textContent = '';
  try {
    if (txt) {
      const lobbies = normalize(JSON.parse(txt));
      if (!lobbies.length) throw new Error('V JSONu jsem nenašel žádná lobby.');
      LS.set('coaches.pasted', txt);
    } else LS.set('coaches.pasted', null);
    LS.set('coaches.url', url || null);
    $('#src-dialog').close();
    await loadData();
  } catch (ex) { err.textContent = ex.message; }
}

/* ---------- události ---------- */

document.addEventListener('click', (e) => {
  const th = e.target.closest('th[data-col]');
  if (th) {
    const c = th.dataset.col;
    state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : (['name', 'rank'].includes(c) ? 1 : -1) };
    renderPlayersTable();
    return;
  }
  const tr = e.target.closest('table.players tbody tr[data-name]');
  if (tr && !e.target.closest('a')) location.hash = `hrac/${encodeURIComponent(tr.dataset.name)}`;
  if (e.target.id === 'csv') exportCsv();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; renderPlayersTable(); }
  if (e.target.id === 'min') { state.minGames = +e.target.value || 0; renderPlayersTable(); }
  if (e.target.id === 'h2h-a' || e.target.id === 'h2h-b') runH2H();
});
$('#src-btn').addEventListener('click', openSourceDialog);
$('#src-form').addEventListener('submit', applySource);
$('#src-cancel').addEventListener('click', () => $('#src-dialog').close());
$('#src-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('#src-json').value = await f.text();
});
$('#src-reset').addEventListener('click', async () => {
  LS.set('coaches.url', null); LS.set('coaches.pasted', null);
  $('#src-dialog').close(); await loadData();
});
$('#reload').addEventListener('click', loadData);
window.addEventListener('hashchange', route);

loadData();

// Obnova: živé zápasy každou minutu (malá data), celá historie jednou za 10 minut
async function refreshLive() {
  if (state.source !== 'Streamers Queue API' || document.hidden) return;
  try {
    const live = canonicalize(normalize(await fetchJson('/api/sq/live')), state.board);
    // odehrané nech, živé/čekající nahraď aktuálními; co skončilo, se objeví při další plné obnově
    const done = state.lobbies.filter((l) => l.winner);
    setData(mergeLobbies(done, live), state.source, state.board);
  } catch (e) { console.warn('obnova živých zápasů selhala', e.message); }
}
setInterval(refreshLive, 60_000);
setInterval(() => { if (!LS.get('coaches.pasted') && state.source !== 'ukázková data' && !document.hidden) loadData(); }, 10 * 60_000);
