// Adaptér: převede raw JSON z API organizátora na jednotný formát.
// Až bude známý přesný tvar dat, stačí upravit jen tento soubor.
//
// Výstup normalize():
// [{ id, status, time, winner: 'blue'|'red'|null,
//    blue: [{ name, avatar, champion, opgg: [{region, url}] }],
//    red:  [...] }]

const pick = (o, ...keys) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v);
  return [];
};

const OPGG_REGIONS = ['euw', 'eune', 'eun', 'na', 'kr'];

function opggUrl(region, riotId) {
  const r = region === 'eun' ? 'eune' : region;
  return `https://op.gg/lol/summoners/${r}/${encodeURIComponent(String(riotId).replace('#', '-'))}`;
}

function normOpgg(p) {
  const out = [];
  const src = pick(p, 'opgg', 'opGG', 'op_gg', 'accounts', 'riotAccounts');
  if (typeof src === 'string') {
    const m = src.match(/op\.gg\/(?:lol\/)?summoners\/([a-z]+)\//i);
    out.push({ region: m ? m[1].toLowerCase() : '?', url: src });
  } else if (Array.isArray(src)) {
    for (const a of src) {
      if (typeof a === 'string') { out.push(...normOpgg({ opgg: a })); continue; }
      const region = String(pick(a, 'region', 'server', 'platform') || '?').toLowerCase();
      const url = pick(a, 'url', 'link', 'opgg');
      const riot = pick(a, 'riotId', 'name', 'summonerName', 'gameName');
      if (url) out.push({ region, url });
      else if (riot) out.push({ region, url: opggUrl(region, riot) });
    }
  } else if (src && typeof src === 'object') {
    // { euw: 'Name#TAG' | url, eune: ... }
    for (const [k, v] of Object.entries(src)) {
      if (!v) continue;
      const region = k.toLowerCase();
      out.push({ region, url: String(v).startsWith('http') ? v : opggUrl(region, v) });
    }
  }
  // Ploché tvary: { euw: 'Name#TAG' } nebo { riotIdEuw: ... }
  for (const r of OPGG_REGIONS) {
    const v = pick(p, r, r.toUpperCase(), `riotId_${r}`, `opgg_${r}`);
    if (typeof v === 'string' && !out.some((o) => o.region === r)) {
      out.push({ region: r, url: v.startsWith('http') ? v : opggUrl(r, v) });
    }
  }
  return out;
}

// relativní cesty ze streamersclash.cz (/api/media/..., /profile/...) → absolutní
export const SC_ORIGIN = 'https://streamersclash.cz';
export const absUrl = (u) => (!u ? null : /^https?:/.test(u) ? u : u.startsWith('/') ? SC_ORIGIN + u : u);

function normPlayer(p) {
  if (typeof p === 'string') return { name: p.trim(), avatar: null, profile: null, champion: null, opgg: [] };
  const name = pick(p, 'name', 'nick', 'nickname', 'displayName', 'username', 'summonerName', 'riotId', 'player');
  if (!name) return null;
  const nameStr = typeof name === 'object' ? pick(name, 'name', 'nick') : name;
  const elo = Number(pick(p, 'elo', 'rating', 'mmr'));
  return {
    id: pick(p, 'id', 'discordId', 'userId') != null ? String(pick(p, 'id', 'discordId', 'userId')) : null,
    name: String(nameStr).trim(),
    elo: Number.isFinite(elo) ? elo : null,
    avatar: absUrl(pick(p, 'avatar', 'avatarUrl', 'image', 'img', 'picture', 'icon')),
    profile: absUrl(pick(p, 'href', 'profile', 'profileUrl')),
    champion: pick(p, 'champion', 'championName', 'champ') || null,
    opgg: normOpgg(p),
  };
}

function normTeam(t) {
  const list = Array.isArray(t) ? t : asArray(pick(t, 'players', 'members', 'roster', 'participants'));
  return list.map(normPlayer).filter(Boolean);
}

function sideOf(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).toLowerCase();
  if (['blue', 'b', 'team1', '1', '100', 'modrý', 'modri', 'modrá'].includes(s)) return 'blue';
  if (['red', 'r', 'team2', '2', '200', 'červený', 'cerveny', 'červená'].includes(s)) return 'red';
  return null;
}

function findTeams(l) {
  let blue = pick(l, 'blue', 'blueTeam', 'teamBlue', 'team1', 'teamA');
  let red = pick(l, 'red', 'redTeam', 'teamRed', 'team2', 'teamB');
  const teams = pick(l, 'teams');
  if ((!blue || !red) && teams) {
    if (Array.isArray(teams)) {
      blue = blue || teams.find((t) => sideOf(pick(t, 'side', 'color', 'team', 'name')) === 'blue') || teams[0];
      red = red || teams.find((t) => sideOf(pick(t, 'side', 'color', 'team', 'name')) === 'red') || teams[1];
    } else {
      blue = blue || pick(teams, 'blue', 'BLUE');
      red = red || pick(teams, 'red', 'RED');
    }
  }
  // Varianta: ploché pole hráčů s polem side/team (i když týmy existují, ale jsou prázdné)
  const players = pick(l, 'players', 'participants');
  const emptyTeam = (t) => !t || normTeam(t).length === 0;
  if ((emptyTeam(blue) || emptyTeam(red)) && Array.isArray(players) && players.length) {
    blue = players.filter((p) => sideOf(pick(p, 'side', 'team', 'color')) === 'blue');
    red = players.filter((p) => sideOf(pick(p, 'side', 'team', 'color')) === 'red');
  }
  return { blue, red };
}

function findWinner(l, blueRaw, redRaw) {
  const w = pick(l, 'winner', 'winnerSide', 'winningTeam', 'winningSide', 'result', 'win');
  if (w !== undefined) {
    const s = sideOf(typeof w === 'object' ? pick(w, 'side', 'color', 'name') : w);
    if (s) return s;
    // vítěz jako id/název týmu (Streamers Queue: teams.blue.id)
    const wid = String(typeof w === 'object' ? pick(w, 'id', 'teamId', 'name') : w).toLowerCase();
    const tid = (t) => (t && !Array.isArray(t) ? [pick(t, 'id', 'teamId'), pick(t, 'name')].filter(Boolean).map((x) => String(x).toLowerCase()) : []);
    if (tid(blueRaw).includes(wid)) return 'blue';
    if (tid(redRaw).includes(wid)) return 'red';
  }
  const won = (t) => t && !Array.isArray(t) && (pick(t, 'win', 'won', 'winner', 'isWinner') === true || String(pick(t, 'result') || '').toLowerCase() === 'win');
  if (won(blueRaw)) return 'blue';
  if (won(redRaw)) return 'red';
  return null;
}

const STATUS = { live: 'hraje se', in_progress: 'hraje se', waiting: 'čeká na start', ended: 'odehráno', cancelled: 'zrušeno' };
const statusLabel = (s) => (s ? STATUS[String(s).toLowerCase()] || String(s) : '');

// Streamers Clash: day "27. 10." + from "22:00"
function dayTime(day, from) {
  const m = String(day || '').match(/(\d{1,2})\.\s*(\d{1,2})\./);
  if (!m) return null;
  const now = new Date();
  let y = now.getFullYear();
  if (+m[2] > now.getMonth() + 2) y--;
  const [hh = '00', mm = '00'] = String(from || '').split(':');
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00`;
}

// "2026-10-28T20:55:00.000Z" → "21:55" (místní čas); "22:39" nechá být
function clock(t) {
  if (!t) return null;
  if (/^\d{1,2}:\d{2}$/.test(String(t))) return String(t);
  const d = new Date(t);
  return isNaN(d) ? String(t) : d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function teamInfo(t) {
  if (!t || Array.isArray(t)) return null;
  const avg = Number(pick(t, 'averageElo', 'avgElo'));
  return Number.isFinite(avg) ? { avgElo: Math.round(avg) } : null;
}

function normLobby(l, i) {
  if (!l || typeof l !== 'object') return null;
  if (String(pick(l, 'status', 'state') || '').toLowerCase() === 'cancelled') return null;
  const { blue, red } = findTeams(l);
  if (!blue && !red) return null;
  const pred = pick(l, 'predictions', 'prediction');
  const bp = Number(pick(pred, 'blueWinProbability', 'blue')), rp = Number(pick(pred, 'redWinProbability', 'red'));
  return {
    id: String(pick(l, 'gameNumber', 'number', 'lobbyNumber', 'id', 'lobbyId', 'matchId', 'gameId') ?? i),
    uid: pick(l, 'id', 'uuid') || null,
    status: statusLabel(pick(l, 'status', 'state')),
    time: pick(l, 'startedAt', 'createdAt', 'time', 'date', 'since', 'start') || dayTime(l.day, l.from),
    timeTo: clock(pick(l, 'endedAt', 'to')),
    opgg: l.opgg || null,
    winner: findWinner(l, blue, red),
    blue: normTeam(blue || []),
    red: normTeam(red || []),
    // Streamers Queue: předpověď výhry a průměrné ELO týmů
    odds: Number.isFinite(bp) && Number.isFinite(rp) ? { blue: bp, red: rp } : null,
    teamInfo: { blue: teamInfo(blue), red: teamInfo(red) },
  };
}

// Hráči v zápasech mají jméno z doby zápasu; podle Discord ID je sjednotí na aktuální jméno ze žebříčku
export function canonicalize(lobbies, board) {
  const names = new Map(board.filter((b) => b.id).map((b) => [b.id, b.name]));
  if (!names.size) return lobbies;
  for (const l of lobbies) for (const side of ['blue', 'red']) for (const p of l[side]) {
    if (p.id && names.has(p.id)) p.name = names.get(p.id);
  }
  return lobbies;
}

// Spojí víc zdrojů lobby, duplicitní (stejné číslo/uuid) nahradí novějším stavem
export function mergeLobbies(...lists) {
  const m = new Map();
  for (const list of lists) for (const l of list || []) {
    const k = l.uid || l.id;
    const prev = m.get(k);
    if (!prev || (!prev.winner && l.winner) || !l.winner === !prev.winner) m.set(k, l);
  }
  return [...m.values()];
}

// Žebříček: Streamers Clash board { entries: [{ rank, nickname, wins, losses, games, … }] }
// nebo Streamers Queue API /api/players [{ id, displayName, username, elo, wins, losses, totalGames, winrate, … }]
export function normalizeBoard(raw) {
  // pozor: u pole by pick(raw, 'entries') vrátil Array.prototype.entries
  const list = Array.isArray(raw) ? raw : asArray(pick(raw, 'entries', 'players', 'board') || raw);
  const out = list.map((e) => {
    const elo = Number(e.elo);
    return {
      id: e.id != null ? String(e.id) : null,
      name: String(pick(e, 'nickname', 'displayName', 'name', 'nick', 'username') || '').trim(),
      rank: e.rank ?? null, wins: +e.wins || 0, losses: +e.losses || 0,
      games: +(e.games ?? e.totalGames) || (+e.wins || 0) + (+e.losses || 0),
      elo: Number.isFinite(elo) ? elo : null,
      lastPlayedAt: e.lastPlayedAt || null,
      tier: e.tier || null, qualified: !!e.qualified,
      avatar: absUrl(e.avatar), profile: absUrl(e.href),
    };
  }).filter((e) => e.name);
  // Streamers Queue nemá pořadí – dopočítá se podle ELO (stejné ELO = stejné místo)
  if (out.length && out.every((e) => e.rank == null) && out.some((e) => e.elo != null)) {
    out.sort((a, b) => (b.elo ?? -1e9) - (a.elo ?? -1e9));
    out.forEach((e, i) => { e.rank = i && e.elo === out[i - 1].elo ? out[i - 1].rank : i + 1; });
  }
  return out;
}

export function normalize(raw) {
  // Streamers Clash lobby endpoint: { live: [...], recent: [...] }
  if (raw && !Array.isArray(raw) && (Array.isArray(raw.live) || Array.isArray(raw.recent))) {
    return [...(raw.recent || []), ...(raw.live || [])].map(normLobby).filter(Boolean);
  }
  let lobbies = Array.isArray(raw) ? raw : pick(raw, 'lobbies', 'lobby', 'matches', 'games', 'data', 'items', 'results');
  if (lobbies && !Array.isArray(lobbies) && typeof lobbies === 'object') {
    // { data: { lobbies: [...] } }
    lobbies = pick(lobbies, 'lobbies', 'matches', 'games', 'items') || Object.values(lobbies);
  }
  return asArray(lobbies).map(normLobby).filter(Boolean);
}
