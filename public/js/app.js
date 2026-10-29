import { normalize } from './adapter.js';
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
  sort: { col: 'wins', dir: -1 }, q: '', minGames: 0,
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
  const attempts = [];
  if (pasted) attempts.push(['vložený JSON', async () => JSON.parse(pasted)]);
  if (custom) attempts.push([custom, () => fetchJson(custom)]);
  attempts.push(['API organizátora', () => fetchJson('/api/data')]);
  attempts.push(['ukázková data', () => fetchJson('sample-lobbies.json')]);

  for (const [label, fn] of attempts) {
    try {
      const raw = await fn();
      const lobbies = normalize(raw);
      if (!lobbies.length) throw new Error('žádná lobby v datech');
      setData(lobbies, label);
      return;
    } catch (e) {
      console.warn(`Zdroj „${label}“ selhal:`, e.message);
    }
  }
  setData([], 'žádný zdroj');
}

function setData(lobbies, source) {
  state.lobbies = lobbies;
  state.stats = computeStats(lobbies);
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
    <span class="muted">${state.lobbies.length} lobby · ${done} odehraných · ${state.stats.size} hráčů · ${state.updated.toLocaleTimeString('cs-CZ')}</span>`;
  const dl = $('#player-list');
  dl.innerHTML = [...state.stats.values()].map((p) => `<option value="${esc(p.name)}">`).join('');
}

/* ---------- routing (#hraci, #zapasy, #h2h, #hrac/Jméno) ---------- */

function route() {
  const [view, ...rest] = decodeURIComponent(location.hash.slice(1) || 'hraci').split('/');
  const arg = rest.join('/');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === (view === 'hrac' ? 'hraci' : view)));
  const main = $('#main');
  if (view === 'zapasy') main.innerHTML = renderMatches();
  else if (view === 'h2h') { main.innerHTML = renderH2HShell(arg); runH2H(); }
  else if (view === 'hrac' && arg) main.innerHTML = renderPlayer(arg);
  else { main.innerHTML = renderPlayersShell(); renderPlayersTable(); }
}

/* ---------- tabulka hráčů ---------- */

const COLS = [
  ['name', 'Hráč'], ['games', 'Zápasy'], ['wins', 'W'], ['losses', 'L'], ['wr', 'Winrate'],
  ['form', 'Forma'], ['streak', 'Série'], ['champs', 'Championi'], ['opgg', 'OP.GG'],
];

function renderPlayersShell() {
  return `
    <div class="toolbar">
      <input id="q" type="search" placeholder="Hledat hráče…" value="${esc(state.q)}">
      <label class="muted">Min. zápasů <input id="min" type="number" min="0" value="${state.minGames}"></label>
      <button class="btn ghost" id="csv">Export CSV</button>
    </div>
    <div class="table-wrap"><table class="players">
      <thead><tr><th>#</th>${COLS.map(([c, l]) => `<th data-col="${c}" class="${['name', 'form', 'opgg', 'champs'].includes(c) ? '' : 'num'}">${l}</th>`).join('')}</tr></thead>
      <tbody></tbody>
    </table></div>
    <p class="muted small">Klikni na hráče pro detail: proti komu vyhrál/prohrál, s kým hraje, historie.</p>`;
}

function filteredPlayers() {
  const q = state.q.toLowerCase();
  const { col, dir } = state.sort;
  const val = (p) => (col === 'name' ? p.name.toLowerCase() : col === 'wr' ? (p.wr ?? -1) : col === 'streak' ? streakVal(p.streak) : col === 'form' ? p.form.filter((f) => f === 'W').length : col === 'champs' ? p.champs.size : p[col]);
  return [...state.stats.values()]
    .filter((p) => (!q || p.name.toLowerCase().includes(q)) && p.games >= state.minGames)
    .sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return c * dir || b.wins - a.wins || a.name.localeCompare(b.name);
    });
}
const streakVal = (s) => (!s ? 0 : (s[0] === 'W' ? 1 : -1) * parseInt(s.slice(1), 10));

function renderPlayersTable() {
  const rows = filteredPlayers();
  $('table.players tbody').innerHTML = rows.length ? rows.map((p, i) => `
    <tr data-name="${esc(p.name)}">
      <td class="muted">${i + 1}</td>
      <td>${playerCell(p)}</td>
      <td class="num">${p.games}${p.pending ? `<span class="muted small"> +${p.pending}</span>` : ''}</td>
      <td class="num win">${p.wins}</td>
      <td class="num loss">${p.losses}</td>
      <td class="num">${wrBar(p.wr)}</td>
      <td>${formDots(p.form)}</td>
      <td class="num ${p.streak[0] === 'W' ? 'win' : 'loss'}">${esc(p.streak)}</td>
      <td><span class="champ-row">${topChamps(p).map((c) => `<span title="${esc(c.name)} ${c.wins}W ${c.losses}L">${champTag(c.name, { label: false })}</span>`).join('') || '<span class="muted">–</span>'}</span></td>
      <td>${opggLinks(p.opgg)}</td>
    </tr>`).join('') : `<tr><td colspan="10" class="empty">Nic nenalezeno</td></tr>`;
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
        <div class="muted">${opggLinks(p.opgg)}</div>
      </div>
      <div class="kpis">
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

function renderMatches() {
  const list = [...state.lobbies].sort(byLobbyOrder).reverse();
  if (!list.length) return '<p class="empty">Žádná data</p>';
  const team = (l, side) => `
    <div class="team ${side} ${l.winner === side ? 'won' : l.winner ? 'lost' : ''}">
      <h4>${side === 'blue' ? 'BLUE' : 'RED'}${l.winner === side ? ' <span class="tag">VÝHRA</span>' : ''}</h4>
      ${l[side].map((p) => { const s = state.stats.get(p.name.toLowerCase()); return `
        <a class="pl" href="#hrac/${encodeURIComponent(p.name)}">${p.champion ? champTag(p.champion, { label: false }) : avatar(p, 22)}<span>${esc(p.name)}</span>
        <span class="muted small">${s && s.games ? `${s.wins}W ${s.losses}L` : ''}</span></a>`; }).join('')}
    </div>`;
  return `<div class="lobbies">${list.map((l) => `
    <article class="lobby">
      <header><b>#${esc(l.id)}</b><span class="badge">${esc(l.winner ? 'odehráno' : (l.status || 'čeká'))}</span>
      <span class="muted">${l.time ? esc(fmtTime(l.time)) : ''}</span></header>
      <div class="teams">${team(l, 'blue')}${team(l, 'red')}</div>
    </article>`).join('')}</div>`;
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
    state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : (c === 'name' ? 1 : -1) };
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
// živá data: obnova každou minutu (vložený JSON se nemění, takže jen u URL/API)
setInterval(() => { if (!LS.get('coaches.pasted') && state.source !== 'ukázková data') loadData(); }, 60_000);
