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
  const name = pick(p, 'name', 'nick', 'nickname', 'username', 'displayName', 'summonerName', 'riotId', 'player');
  if (!name) return null;
  const nameStr = typeof name === 'object' ? pick(name, 'name', 'nick') : name;
  return {
    name: String(nameStr).trim(),
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
  // Varianta: ploché pole hráčů s polem side/team
  const players = pick(l, 'players', 'participants');
  if ((!blue || !red) && Array.isArray(players)) {
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
  }
  const won = (t) => t && !Array.isArray(t) && (pick(t, 'win', 'won', 'winner', 'isWinner') === true || String(pick(t, 'result') || '').toLowerCase() === 'win');
  if (won(blueRaw)) return 'blue';
  if (won(redRaw)) return 'red';
  return null;
}

const STATUS = { live: 'hraje se', waiting: 'čeká na start', ended: 'odehráno' };
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

function normLobby(l, i) {
  if (!l || typeof l !== 'object') return null;
  const { blue, red } = findTeams(l);
  if (!blue && !red) return null;
  return {
    id: String(pick(l, 'number', 'lobbyNumber', 'id', 'lobbyId', 'matchId', 'gameId') ?? i),
    uid: pick(l, 'id', 'uuid') || null,
    status: statusLabel(pick(l, 'status', 'state')),
    time: pick(l, 'startedAt', 'createdAt', 'time', 'date', 'since', 'start') || dayTime(l.day, l.from),
    timeTo: l.to || null,
    opgg: l.opgg || null,
    winner: findWinner(l, blue, red),
    blue: normTeam(blue || []),
    red: normTeam(red || []),
  };
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

// Streamers Clash board: { entries: [{ rank, nickname, wins, losses, games, avatar, href, tier }] }
export function normalizeBoard(raw) {
  const list = asArray(pick(raw, 'entries', 'players', 'board') || raw);
  return list.map((e) => ({
    name: String(pick(e, 'nickname', 'name', 'nick') || '').trim(),
    rank: e.rank ?? null, wins: +e.wins || 0, losses: +e.losses || 0, games: +e.games || 0,
    tier: e.tier || null, qualified: !!e.qualified,
    avatar: absUrl(e.avatar), profile: absUrl(e.href),
  })).filter((e) => e.name);
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
