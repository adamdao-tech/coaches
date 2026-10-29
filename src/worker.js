// Cloudflare Worker: servíruje statický web z /public a na /api/data
// přeposílá raw JSON z API organizátora (obchází CORS, krátce cachuje).
//
// Nastavení:
//   wrangler.jsonc → vars.SOURCE_URL   (lobby API organizátora)
//                    vars.BOARD_URL    (žebříček)
//   wrangler secret put SOURCE_TOKEN   (volitelně, pokud API chce token)

const CACHE_SECONDS = 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/data') return proxy(request, env.SOURCE_URL, env, ctx);
    if (url.pathname === '/api/board') return proxy(request, env.BOARD_URL, env, ctx);
    if (url.pathname === '/api/health') return json({ ok: true, source: Boolean(env.SOURCE_URL) });

    return env.ASSETS.fetch(request);
  },
};

async function proxy(request, target, env, ctx) {
  if (!target) return json({ error: 'zdroj není nastavený' }, 404);

  const cache = caches.default;
  const cacheKey = new Request(new URL(new URL(request.url).pathname, request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = { accept: 'application/json', 'user-agent': 'coaches-scouting (github.com/adamdao-tech/coaches)' };
  if (env.SOURCE_TOKEN) headers.authorization = `Bearer ${env.SOURCE_TOKEN}`;

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
      'access-control-allow-origin': '*',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
}
