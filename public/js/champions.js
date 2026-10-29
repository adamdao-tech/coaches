// Ikonky championů z Riot Data Dragon (oficiální CDN).
// Mapuje název z dat ("Lee Sin", "Kai'Sa", "Wukong", "leesin", 64 …) na id obrázku.

const DD = 'https://ddragon.leagueoflegends.com';
const LS_KEY = 'coaches.ddragon';
let state = null; // { version, byKey: { normalizovanýNázev: id } }

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

export async function loadChampions() {
  if (state) return state;
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (cached && Date.now() - cached.at < 24 * 3600e3) return (state = cached);
  } catch {}
  try {
    const [version] = await (await fetch(`${DD}/api/versions.json`)).json();
    const { data } = await (await fetch(`${DD}/cdn/${version}/data/en_US/champion.json`)).json();
    const byKey = {};
    for (const c of Object.values(data)) {
      byKey[norm(c.id)] = c.id;      // MonkeyKing, LeeSin
      byKey[norm(c.name)] = c.id;    // Wukong, Lee Sin, Kai'Sa
      byKey[c.key] = c.id;           // číselné championId z Riot API
    }
    byKey.nunu = 'Nunu';
    state = { version, byKey, at: Date.now() };
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
  } catch (e) {
    console.warn('Data Dragon nedostupný, championi budou bez ikonek', e);
    state = { version: null, byKey: {} };
  }
  return state;
}

export function champIcon(name) {
  if (!state?.version || name == null) return null;
  const id = state.byKey[norm(name)] || state.byKey[String(name)];
  return id ? `${DD}/cdn/${state.version}/img/champion/${id}.png` : null;
}

// <img> + název; když ikona není, jen text
export function champTag(name, { size = 22, label = true } = {}) {
  if (!name) return '<span class="muted">–</span>';
  const e = String(name).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const src = champIcon(name);
  const img = src ? `<img class="champ" src="${src}" width="${size}" height="${size}" alt="${e}" title="${e}" loading="lazy">` : '';
  return `<span class="champ-tag">${img}${label || !src ? `<span>${e}</span>` : ''}</span>`;
}
