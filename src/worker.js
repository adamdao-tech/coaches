// Cloudflare Worker: servíruje statický web z /public a přeposílá data z API.
//
// Streamers Queue API (Candi, https://sq.candycz01.xyz) – hlavní zdroj:
//   /api/sq/players  → hráči s ELO, W/L, winrate
//   /api/sq/games    → všechny odehrané + živé/čekající zápasy (bez zrušených), ~MB dat
//   /api/sq/live     → jen živé a čekající zápasy (malé, pro častou obnovu)
//   Klíč je tajný: wrangler secret put SQ_API_KEY  (nebo Cloudflare → Worker → Settings → Variables and Secrets)
//   Do prohlížeče se nikdy nedostane, Worker ho přidává sám do hlavičky x-api-key.
//
// Záloha (veřejné endpointy streamersclash.cz): /api/data (lobby), /api/board (žebříček)

const SQ = {
  players: { path: '/api/players', ttl: 60 },
  games: { path: '/api/games?state=ENDED,IN_PROGRESS,WAITING', ttl: 120 },
  live: { path: '/api/games?state=ACTIVE', ttl: 15 },
};
const CACHE_SECONDS = 30;

// Paměťová cache v instanci Workeru (funguje i na *.workers.dev, kde Cache API nic neukládá)
const memory = new Map();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const sq = url.pathname.match(/^\/api\/sq\/(players|games|live)$/);
    if (sq) return sqProxy(sq[1], env, ctx);

    if (url.pathname === '/api/data') return proxy(request, env.SOURCE_URL, env, ctx);
    if (url.pathname === '/api/board') return proxy(request, env.BOARD_URL, env, ctx);
    if (url.pathname === '/api/health') {
      return json({ ok: true, sq: Boolean(env.SQ_API_KEY), source: Boolean(env.SOURCE_URL) });
    }

    return env.ASSETS.fetch(request);
  },
};

async function sqProxy(name, env, ctx) {
  if (!env.SQ_API_KEY) return json({ error: 'SQ_API_KEY není nastavený' }, 503);
  const { path, ttl } = SQ[name];
  const base = String(env.SQ_BASE_URL || 'https://sq.candycz01.xyz').replace(/\/+$/, '');
  const now = Date.now();

  const mem = memory.get(name);
  if (mem && now - mem.at < ttl * 1000) return sqResponse(mem.body, ttl, 'memory');

  const cache = caches.default;
  const cacheKey = new Request(`https://coaches-cache.internal/sq/${name}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(base + path, {
      headers: { accept: 'application/json', 'x-api-key': env.SQ_API_KEY, 'user-agent': 'coaches-scouting' },
    });
  } catch (e) {
    if (mem) return sqResponse(mem.body, 5, 'stale');
    return json({ error: `Streamers Queue API nedostupné: ${e.message}` }, 502);
  }
  if (!upstream.ok) {
    // při výpadku nebo vyčerpaném limitu radši starší data než nic
    if (mem) return sqResponse(mem.body, 5, 'stale');
    const retry = upstream.headers.get('retry-after');
    return json({ error: `Streamers Queue API vrátilo HTTP ${upstream.status}`, retryAfter: retry }, 502);
  }

  // Tělo se jen přeposílá (žádné JSON.parse – velká odpověď by na free plánu přetáhla limit CPU)
  const body = await upstream.arrayBuffer();
  memory.set(name, { at: now, body });
  const res = sqResponse(body, ttl, 'origin');
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function sqResponse(body, ttl, from) {
  return new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${ttl}`,
      'x-coaches-cache': from,
    },
  });
}

async function proxy(request, target, env, ctx) {
  if (!target) return json({ error: 'zdroj není nastavený' }, 404);

  const cache = caches.default;
  const cacheKey = new Request(new URL(new URL(request.url).pathname, request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = { accept: 'application/json', 'user-agent': 'coaches-scouting (github.com/adamdao-tech/coaches)' };

  let upstream;
  try {
    upstream = await fetch(target, { headers, cf: { cacheTtl: 0 } });
  } catch (e) {
    return json({ error: `API organizátora nedostupné: ${e.message}` }, 502);
  }
  if (!upstream.ok) return json({ error: `API organizátora vrátilo HTTP ${upstream.status}` }, 502);

  const body = await upstream.text();
  try { JSON.parse(body); } catch { return json({ error: 'API organizátora nevrátilo JSON' }, 502); }

  const res = new Response(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
