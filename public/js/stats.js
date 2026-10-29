// Výpočet statistik z normalizovaných lobby.

const key = (name) => name.toLowerCase();

export function computeStats(lobbies, board = []) {
  const players = new Map();

  const get = (p) => {
    const k = key(p.name);
    if (!players.has(k)) {
      players.set(k, {
        key: k, name: p.name, avatar: p.avatar, profile: p.profile || null, opgg: [], board: null,
        games: 0, wins: 0, losses: 0, pending: 0,
        history: [],            // { lobbyId, side, result, time, champion, allies, enemies }
        vs: new Map(),          // soupeř -> { name, wins, losses }
        with: new Map(),        // spoluhráč -> { name, wins, losses }
        champs: new Map(),      // champion -> { wins, losses }
      });
    }
    const s = players.get(k);
    if (!s.avatar && p.avatar) s.avatar = p.avatar;
    if (!s.profile && p.profile) s.profile = p.profile;
    for (const o of p.opgg || []) if (!s.opgg.some((x) => x.url === o.url)) s.opgg.push(o);
    return s;
  };

  const bump = (map, other, won) => {
    const k = key(other);
    const r = map.get(k) || { name: other, wins: 0, losses: 0 };
    won ? r.wins++ : r.losses++;
    map.set(k, r);
  };

  // žebříček organizátora = oficiální celková bilance všech hráčů
  for (const e of board) get(e).board = e;

  // řazení od nejstaršího, ať forma (posledních 5) dává smysl
  const ordered = [...lobbies].sort(byLobbyOrder);

  for (const l of ordered) {
    for (const side of ['blue', 'red']) {
      const team = l[side];
      const enemy = l[side === 'blue' ? 'red' : 'blue'];
      for (const p of team) {
        const s = get(p);
        const result = l.winner ? (l.winner === side ? 'W' : 'L') : null;
        s.history.push({
          lobbyId: l.id, side, result, time: l.time, champion: p.champion,
          allies: team.filter((x) => x !== p).map((x) => x.name),
          enemies: enemy.map((x) => x.name),
        });
        if (!result) { s.pending++; continue; }
        const won = result === 'W';
        s.games++;
        won ? s.wins++ : s.losses++;
        for (const e of enemy) bump(s.vs, e.name, won);
        for (const a of team) if (a !== p) bump(s.with, a.name, won);
        if (p.champion) bump(s.champs, p.champion, won);
      }
    }
  }

  for (const s of players.values()) {
    // z uložených zápasů (pro soupeře/spoluhráče)
    s.tracked = { games: s.games, wins: s.wins, losses: s.losses };
    // celkem: z žebříčku, pokud je
    if (s.board) { s.games = s.board.games; s.wins = s.board.wins; s.losses = s.board.losses; }
    s.rank = s.board?.rank ?? null;
    s.tier = s.board?.tier ?? null;
    s.wr = s.games ? s.wins / s.games : null;
    const done = s.history.filter((h) => h.result);
    s.form = done.slice(-5).map((h) => h.result);
    s.streak = streakOf(done);
  }
  return players;
}

function streakOf(done) {
  if (!done.length) return '';
  const last = done[done.length - 1].result;
  let n = 0;
  for (let i = done.length - 1; i >= 0 && done[i].result === last; i--) n++;
  return `${last}${n}`;
}

export function byLobbyOrder(a, b) {
  const ta = a.time ? Date.parse(a.time) : NaN;
  const tb = b.time ? Date.parse(b.time) : NaN;
  if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta - tb;
  const na = parseInt(a.id, 10), nb = parseInt(b.id, 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a.id).localeCompare(String(b.id));
}

// Head-to-head dvou hráčů
export function headToHead(lobbies, nameA, nameB) {
  const a = key(nameA), b = key(nameB);
  const res = { against: { aWins: 0, bWins: 0, games: [] }, together: { wins: 0, losses: 0, games: [] } };
  for (const l of [...lobbies].sort(byLobbyOrder)) {
    const sideOfP = (k) => (l.blue.some((p) => key(p.name) === k) ? 'blue' : l.red.some((p) => key(p.name) === k) ? 'red' : null);
    const sa = sideOfP(a), sb = sideOfP(b);
    if (!sa || !sb) continue;
    if (sa !== sb) {
      res.against.games.push({ lobby: l, aSide: sa });
      if (l.winner) l.winner === sa ? res.against.aWins++ : res.against.bWins++;
    } else {
      res.together.games.push({ lobby: l, side: sa });
      if (l.winner) l.winner === sa ? res.together.wins++ : res.together.losses++;
    }
  }
  return res;
}

export const sortedRecords = (map, minGames = 1) =>
  [...map.values()]
    .filter((r) => r.wins + r.losses >= minGames)
    .sort((x, y) => (y.wins + y.losses) - (x.wins + x.losses) || y.wins - x.wins || x.name.localeCompare(y.name));
