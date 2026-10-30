# Coaches – scouting Streamers Clash

Veřejná webovka nad raw JSON API organizátora. Kdokoliv (i kdo neumí s JSONem) uvidí:

- **Hráči** – tabulka: zápasy, výhry, prohry, winrate, forma (posledních 5), série, OP.GG. Řazení kliknutím na sloupec, hledání, filtr min. zápasů, export do CSV (Excel).
- **Detail hráče** – koho porazil, proti komu prohrál, se kterými spoluhráči vyhrává/prohrává, championi (pokud jsou v datech), celá historie zápasů.
- **Zápasy** – lobby jako na webu organizátora, s výsledkem a bilancí každého hráče.
- **Head-to-head** – dva hráči: bilance proti sobě i spolu v týmu.

Odkazy jdou sdílet (`#hrac/SGoob`, `#h2h/SGoob/Twight`).

## Zdroj dat

Hlavní zdroj je **Streamers Queue API** (Candi, `https://sq.candycz01.xyz`) přes Worker:

| Endpoint webu | API | Cache |
|---|---|---|
| `/api/sq/players` | `/api/players` – hráči, ELO, W/L | 60 s |
| `/api/sq/games` | `/api/games?state=ENDED,IN_PROGRESS,WAITING` – celá historie | 120 s |
| `/api/sq/live` | `/api/games?state=ACTIVE` – živé zápasy, web je obnovuje každou minutu | 15 s |

API klíč je **secret** `SQ_API_KEY` ve Workeru – nikdy ho nedávej do kódu ani do `wrangler.jsonc`.
Nastavení: Cloudflare → Workers → coaches → Settings → Variables and Secrets → Add → Secret `SQ_API_KEY`,
nebo `npx wrangler secret put SQ_API_KEY`. Kontrola: `/api/health` vrátí `"sq": true`.

Když API neodpovídá, web spadne na zálohu: veřejné endpointy streamersclash.cz (`/api/data`, `/api/board`)
a uložená data v `public/data/`. Další možnosti v tlačítku **Zdroj dat** (vložený JSON, vlastní URL).

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
