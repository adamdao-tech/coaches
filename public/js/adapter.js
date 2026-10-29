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

function normPlayer(p) {
  if (typeof p === 'string') return { name: p.trim(), avatar: null, champion: null, opgg: [] };
  const name = pick(p, 'name', 'nick', 'nickname', 'username', 'displayName', 'summonerName', 'riotId', 'player');
  if (!name) return null;
  const nameStr = typeof name === 'object' ? pick(name, 'name', 'nick') : name;
  return {
    name: String(nameStr).trim(),
    avatar: pick(p, 'avatar', 'avatarUrl', 'image', 'img', 'picture', 'icon') || null,
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

function normLobby(l, i) {
  if (!l || typeof l !== 'object') return null;
  const { blue, red } = findTeams(l);
  if (!blue && !red) return null;
  return {
    id: String(pick(l, 'id', 'lobbyId', 'number', 'matchId', 'gameId') ?? i),
    status: String(pick(l, 'status', 'state') || ''),
    time: pick(l, 'startedAt', 'createdAt', 'time', 'date', 'since', 'start') || null,
    winner: findWinner(l, blue, red),
    blue: normTeam(blue || []),
    red: normTeam(red || []),
  };
}

export function normalize(raw) {
  let lobbies = Array.isArray(raw) ? raw : pick(raw, 'lobbies', 'lobby', 'matches', 'games', 'data', 'items', 'results');
  if (lobbies && !Array.isArray(lobbies) && typeof lobbies === 'object') {
    // { data: { lobbies: [...] } }
    lobbies = pick(lobbies, 'lobbies', 'matches', 'games', 'items') || Object.values(lobbies);
  }
  return asArray(lobbies).map(normLobby).filter(Boolean);
}
