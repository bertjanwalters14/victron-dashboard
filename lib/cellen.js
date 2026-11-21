// Hulpfuncties voor de kaart "Cellen" (celspanningen per pack uit de Node-RED meetflow "Celspanningen", via de push in ess_live.cellen).
// Zuivere functies zonder React, zodat ze met node te testen zijn (zie het commit-bericht).

export const TOP_V = 3.45;    // vanaf hier is de hoogste cel op de top (zelfde grens als topNu in ess_logic.js)
export const LAAG_V = 3.05;   // eronder zit een cel in de knik onderin
export const ZWAKKE_CEL = { pack: '01', cel: 14 };   // de zwakke cel (21-11-2026): pack 01, cel 14
export const PACK_ROL = { '00': 'master', '01': 'slave' };
export const OUD_NA_MS = 60 * 60000;   // een meting ouder dan 1 uur: de push of de meetflow staat stil

// Verschil tussen hoogste en laagste cel in volt: < 30 mV groen, 30-100 mV oranje, > 100 mV rood.
export function verschilKleur(diff) {
  if (diff == null || !Number.isFinite(diff)) return 'grijs';
  if (diff < 0.03) return 'groen';
  if (diff <= 0.1) return 'oranje';
  return 'rood';
}

// Een cel: 'laag' (< 3,05 V), 'top' (> 3,45 V) of 'normaal'; null/NaN = 'onbekend'.
export function celStand(v) {
  if (v == null || !Number.isFinite(v)) return 'onbekend';
  if (v < LAAG_V) return 'laag';
  if (v > TOP_V) return 'top';
  return 'normaal';
}

export const isZwakkeCel = (pack, cel) => pack === ZWAKKE_CEL.pack && cel === ZWAKKE_CEL.cel;

// "3 min geleden", "2 u 5 min geleden", "1 dag geleden"
export function leeftijdTekst(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'onbekend';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const u = Math.floor(min / 60);
  if (u < 24) return `${u} u${min % 60 ? ` ${min % 60} min` : ''} geleden`;
  const d = Math.floor(u / 24);
  return `${d} ${d === 1 ? 'dag' : 'dagen'} geleden`;
}

// Maakt van het ruwe veld `cellen` een veilige vorm; geeft null als er niets bruikbaars in zit.
// Velden mogen null zijn; een pack zonder cellenlijst blijft staan (met alle cellen null).
export function normaliseerCellen(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.packs) || raw.packs.length === 0) return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const packs = raw.packs.filter(p => p && typeof p === 'object').map(p => {
    const cellen = Array.isArray(p.cellen) ? p.cellen.map(num) : [];
    const bekend = cellen.filter(x => x !== null);
    // min/max/diff opnieuw uit de cellen als de aanlevering ze niet meegaf
    const min = num(p.min) ?? (bekend.length ? Math.min(...bekend) : null);
    const max = num(p.max) ?? (bekend.length ? Math.max(...bekend) : null);
    return {
      pack: String(p.pack ?? '?'),
      online: p.online === true,
      t: num(p.t),
      soc: num(p.soc), v: num(p.v), i: num(p.i), temp: num(p.temp),
      cellen,
      min, max,
      diff: num(p.diff) ?? (min !== null && max !== null ? Math.round((max - min) * 1000) / 1000 : null),
      minCel: num(p.minCel) ?? (min !== null ? cellen.indexOf(min) + 1 || null : null),
      maxCel: num(p.maxCel) ?? (max !== null ? cellen.indexOf(max) + 1 || null : null),
      balancing: p.balancing === null || p.balancing === undefined ? null : (Number(p.balancing) > 0 ? 1 : 0),
    };
  });
  if (!packs.length) return null;
  return { t: num(raw.t), packs };
}
