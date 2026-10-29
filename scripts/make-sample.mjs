// Vygeneruje public/sample-lobbies.json – ukázková data podle lobby ze screenshotu.
// Výsledky odehraných kol jsou VYMYŠLENÉ, slouží jen k vyzkoušení UI.
// Spuštění: node scripts/make-sample.mjs
import { writeFileSync } from 'node:fs';

const current = {
  841: [['Anton', 'matej2532', 'pukkmenstar', 'rakos420', 'Samco0015'], ['Ereniko', 'KloMrk', 'KoreanPizzaBoy', 'Munet', 'Proky']],
  840: [['eSGi', 'Chmelda', 'koubee', 'Pengu', 'Undead'], ['Dawe146', 'fityr', 'Michaloo832', 'Mittcho', 'Wride']],
  839: [['bruska132', 'Ejdyxdd', 'Kebixik', 'Necromartin', 'SherifGooffy'], ['Dadu', 'FonkoCZ', 'Honzikk', 'Rguardian', 'SebaHolub']],
  838: [['lethalented', 'mouzwyr', 'Pedronix', 'Skodix', 'Turyx'], ['ockoLOL', 'robin', 'SKREAM', 'Thomass616', 'w8maxcs']],
  837: [['Gile', 'Only', 'Sambee', 'sugiiss', 'VekTTor'], ['billyboner', 'BreyK', 'ItzConki', 'SGoob', 'Twight']],
  836: [['176lvx', 'bandygod', 'Metys', 'sovaz1', 'The_Goksi'], ['dvlk696', 'Enrik', 'Stryg', 'sw3ry', 'tomomaso']],
};
const all = Object.values(current).flat(2);

// deterministický PRNG
let seed = 2026;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const skill = Object.fromEntries(all.map((n) => [n, rnd()]));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const champs = ['Ahri', 'Lee Sin', 'Jinx', 'Thresh', 'Darius', 'Viego', 'Lux', 'Kaisa', 'Nautilus', 'Garen', 'Yasuo', 'Ezreal', 'Leona', 'Sett', 'Syndra'];

// pár hráčů s ukázkovým OP.GG (formát { euw: 'Jméno#TAG' })
const opgg = (n, i) => (i % 3 === 0 ? { euw: `${n}#EUW` } : i % 3 === 1 ? { eune: `${n}#EUNE` } : {});
const player = (n, champion) => ({ name: n, opgg: opgg(n, all.indexOf(n)), ...(champion ? { champion } : {}) });

const lobbies = [];
let id = 812;
const base = Date.parse('2026-10-29T17:00:00+01:00');
for (let round = 0; round < 4; round++) {
  const order = shuffle(all);
  for (let g = 0; g < 6; g++) {
    const ten = order.slice(g * 10, g * 10 + 10);
    const blue = ten.slice(0, 5), red = ten.slice(5);
    const sum = (t) => t.reduce((s, n) => s + skill[n], 0);
    const pBlue = 1 / (1 + Math.exp(-(sum(blue) - sum(red)) * 2.2));
    lobbies.push({
      id: id++,
      status: 'finished',
      startedAt: new Date(base + round * 40 * 60_000).toISOString(),
      winner: rnd() < pBlue ? 'blue' : 'red',
      blue: { players: blue.map((n) => player(n, champs[Math.floor(rnd() * champs.length)])) },
      red: { players: red.map((n) => player(n, champs[Math.floor(rnd() * champs.length)])) },
    });
  }
}
for (const [lid, [blue, red]] of Object.entries(current).sort((a, b) => a[0] - b[0])) {
  lobbies.push({
    id: Number(lid), status: 'čeká na start', startedAt: '2026-10-29T19:32:00+01:00', winner: null,
    blue: { players: blue.map((n) => player(n)) }, red: { players: red.map((n) => player(n)) },
  });
}

writeFileSync(new URL('../public/sample-lobbies.json', import.meta.url), JSON.stringify({ _note: 'UKÁZKOVÁ DATA – výsledky jsou vymyšlené', lobbies }, null, 1));
console.log(`OK: ${lobbies.length} lobby`);
