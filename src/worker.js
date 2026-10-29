// Cloudflare Worker: servíruje statický web z /public a na /api/data
// přeposílá raw JSON z API organizátora (obchází CORS, krátce cachuje).
//
// Nastavení:
//   wrangler.jsonc → vars.SOURCE_URL   (URL raw API organizátora)
//   wrangler secret put SOURCE_TOKEN   (volitelně, pokud API chce token)

const CACHE_SECONDS = 30;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/data') return proxyData(request, env, ctx);
    if (url.pathname === '/api/health') return json({ ok: true, source: Boolean(env.SOURCE_URL) });

    return env.ASSETS.fetch(request);
  },
};

async function proxyData(request, env, ctx) {
  if (!env.SOURCE_URL) return json({ error: 'SOURCE_URL není nastavené' }, 404);

  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/data', request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = { accept: 'application/json' };
  if (env.SOURCE_TOKEN) headers.authorization = `Bearer ${env.SOURCE_TOKEN}`;

  let upstream;
  try {
    upstream = await fetch(env.SOURCE_URL, { headers, cf: { cacheTtl: 0 } });
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
