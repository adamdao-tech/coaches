# Coaches – scouting Streamers Clash

Veřejná webovka nad raw JSON API organizátora. Kdokoliv (i kdo neumí s JSONem) uvidí:

- **Hráči** – tabulka: zápasy, výhry, prohry, winrate, forma (posledních 5), série, OP.GG. Řazení kliknutím na sloupec, hledání, filtr min. zápasů, export do CSV (Excel).
- **Detail hráče** – koho porazil, proti komu prohrál, se kterými spoluhráči vyhrává/prohrává, championi (pokud jsou v datech), celá historie zápasů.
- **Zápasy** – lobby jako na webu organizátora, s výsledkem a bilancí každého hráče.
- **Head-to-head** – dva hráči: bilance proti sobě i spolu v týmu.

Odkazy jdou sdílet (`#hrac/SGoob`, `#h2h/SGoob/Twight`).

## Zdroj dat

Pořadí, ve kterém web data hledá:

1. JSON vložený/nahraný přes tlačítko **Zdroj dat** (uloží se jen v prohlížeči),
2. vlastní URL zadaná tamtéž,
3. `/api/data` – Worker přeposílá API organizátora (`SOURCE_URL`), cache 30 s, obchází CORS,
4. `sample-lobbies.json` – **ukázková data** (výsledky vymyšlené), dokud API není.

Živá data se obnovují každou minutu.

## Až přijde formát API

Všechno parsování je v [`public/js/adapter.js`](public/js/adapter.js). Už teď zvládá běžné tvary
(`lobbies`/`matches`, `blue`/`red` nebo `teams[]`, `winner`/`win`, hráči jako stringy nebo objekty,
OP.GG jako URL, `{euw: "Jméno#TAG"}` nebo pole účtů). Když se reálná data liší, upraví se jen tenhle soubor.

## Nasazení (Cloudflare Workers)

```bash
npm install
# do wrangler.jsonc doplň vars.SOURCE_URL = URL raw API organizátora
npx wrangler secret put SOURCE_TOKEN   # jen pokud API vyžaduje token
npm run deploy
```

Lokálně: `npm run dev` (nebo jen statika: `npx serve public`).

Ukázková data znovu vygeneruješ `npm run sample`.
