// Stáhne data ze Streamers Clash API a uloží je do public/data/.
//  - board.json   … celkový žebříček (W/L všech hráčů)
//  - matches.json … odehrané zápasy; API drží jen ~36 posledních,
//                   takže se nové přidávají k už uloženým a historie roste.
// Spouští GitHub Action (.github/workflows/sync.yml), lokálně: node scripts/sync.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://streamersclash.cz/api/streamers-queue';
const DIR = new URL('../public/data/', import.meta.url);
mkdirSync(DIR, { recursive: true });

async function get(path) {
  const r = await fetch(`${BASE}/${path}`, {
    headers: { accept: 'application/json', 'user-agent': 'coaches-scouting-sync (github.com/adamdao-tech/coaches)' },
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

const readJson = (name, fallback) => {
  try { return JSON.parse(readFileSync(new URL(name, DIR), 'utf8')); } catch { return fallback; }
};

// "27. 10." + "22:00" → ISO s rokem odvozeným z asOf
function toIso(day, time, asOf) {
  const m = String(day || '').match(/(\d{1,2})\.\s*(\d{1,2})\./);
  if (!m) return null;
  const now = new Date(asOf || Date.now());
  let year = now.getUTCFullYear();
  if (+m[2] > now.getUTCMonth() + 1 + 1) year--; // prosinec vs. leden
  const [hh = '00', mm = '00'] = String(time || '').split(':');
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00+01:00`;
}

const slimPlayer = (p) => ({ nickname: p.nickname, avatar: p.avatar ?? null, href: p.href ?? null });

const [board, lobby] = await Promise.all([get('board'), get('lobby')]);

const store = readJson('matches.json', { matches: [] });
const byId = new Map(store.matches.map((m) => [m.id, m]));
let added = 0;
for (const l of [...(lobby.recent || []), ...(lobby.live || [])]) {
  if (l.state !== 'ended' || !l.winner || byId.has(l.id)) continue;
  byId.set(l.id, {
    id: l.id, number: l.number, state: l.state, winner: l.winner,
    day: l.day, from: l.from, to: l.to, startedAt: toIso(l.day, l.from, lobby.asOf),
    blue: l.blue.map(slimPlayer), red: l.red.map(slimPlayer),
  });
  added++;
}

const matches = [...byId.values()].sort((a, b) => b.number - a.number);
writeFileSync(new URL('matches.json', DIR), JSON.stringify({
  source: `${BASE}/lobby`, updatedAt: new Date().toISOString(), count: matches.length, matches,
}, null, 1) + '\n');

writeFileSync(new URL('board.json', DIR), JSON.stringify({
  source: `${BASE}/board`, updatedAt: new Date().toISOString(), asOf: board.asOf,
  players: board.entries.length, entries: board.entries,
}, null, 1) + '\n');

console.log(`board: ${board.entries.length} hráčů · matches: ${matches.length} (+${added} nových)`);
