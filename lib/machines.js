// Beste moment voor machines (wasmachine, droger, vaatwasser): puur afgeleid van de forecast-uren die Node-RED al
// meestuurt (prijs + zonverwachting per uur). Raakt de sturing niet; het is alleen informatie.

const TZ = 'Europe/Amsterdam';

// Forecast-uur ("14:00" of "+1 14:00") -> uren sinds middernacht van de dag waarop de data is gemaakt.
export function uurIndex(u) {
  const m = /^(?:\+(\d+) )?(\d{2}):/.exec(String(u));
  if (!m) return null;
  return (m[1] ? Number(m[1]) : 0) * 24 + Number(m[2]);
}

const datumNl = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: TZ });
const uurNl = (ms) => {
  const delen = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  return Number(delen.find(p => p.type === 'hour').value);
};

// Het huidige hele uur, uitgedrukt in dezelfde index als de forecast (ook als de data van gisteren is).
export function nuIndex(nuMs, bijgewerktMs) {
  const basis = Number.isFinite(bijgewerktMs) ? bijgewerktMs : nuMs;
  const dagen = Math.round((Date.parse(datumNl(nuMs)) - Date.parse(datumNl(basis))) / 86400000);
  return dagen * 24 + uurNl(nuMs);
}

const gelijk = (a, b) => Math.abs(a - b) <= 0.0005;

// Kleinste gemiddelde prijs; bij gelijke prijs het blok met meer zon, daarna het vroegste.
function beter(a, b) {
  if (!b) return true;
  if (!gelijk(a.prijs, b.prijs)) return a.prijs < b.prijs;
  if (Math.abs(a.zon - b.zon) > 0.05) return a.zon > b.zon;
  return a.start < b.start;
}

// Geeft null zolang er te weinig uren bekend zijn.
export function bepaalAdvies(forecast, nuMs, bijgewerktMs, blokUren) {
  const rijen = (forecast || [])
    .map(r => ({ i: uurIndex(r.uur), prijs: Number(r.prijs), zon: Number(r.pv) || 0 }))
    .filter(r => r.i != null && Number.isFinite(r.prijs))
    .sort((a, b) => a.i - b.i);
  const nu = nuIndex(nuMs, bijgewerktMs);
  const toekomst = rijen.filter(r => r.i >= nu);
  if (toekomst.length < blokUren) return null;

  const blokken = [];
  for (let s = 0; s + blokUren <= toekomst.length; s++) {
    const b = toekomst.slice(s, s + blokUren);
    if (b[blokUren - 1].i - b[0].i !== blokUren - 1) continue;   // alleen aaneengesloten uren
    blokken.push({
      start: b[0].i, eind: b[0].i + blokUren,
      prijs: b.reduce((x, r) => x + r.prijs, 0) / blokUren,
      zon: b.reduce((x, r) => x + r.zon, 0),
    });
  }
  if (!blokken.length) return null;

  let beste = null, duurste = null;
  for (const b of blokken) {
    if (beter(b, beste)) beste = b;
    if (!duurste || b.prijs > duurste.prijs) duurste = b;
  }
  const dagNu = Math.floor(nu / 24);
  const perDag = {};
  for (const b of blokken) {
    const d = Math.floor(b.start / 24) - dagNu;
    if (beter(b, perDag[d])) perDag[d] = b;
  }

  // "Nu": waar ligt het huidige uur t.o.v. de komende 24 uur?
  const volgende = toekomst.slice(0, 24).map(r => r.prijs);
  const huidig = toekomst.find(r => r.i === nu);
  const spread = Math.max(...volgende) - Math.min(...volgende);
  let nuStand = null;
  if (huidig) {
    const lager = volgende.filter(p => p < huidig.prijs - 0.0005).length;
    const aandeel = volgende.length > 1 ? lager / (volgende.length - 1) : 0;
    if (spread < 0.06) nuStand = 'vlak';
    else if (nu >= beste.start && nu < beste.eind) nuStand = 'beste';
    else if (aandeel <= 0.33) nuStand = 'goed';
    else if (aandeel >= 0.67) nuStand = 'duur';
    else nuStand = 'matig';
  }
  return { nu, dagNu, beste, duurste, perDag, nuStand, huidigePrijs: huidig ? huidig.prijs : null, spread, rijen: toekomst };
}

export const dagNaam = (verschil) => (verschil === 0 ? 'Vandaag' : verschil === 1 ? 'Morgen' : 'Overmorgen');
export const uurTekst = (index) => String(((index % 24) + 24) % 24).padStart(2, '0') + ':00';
export const euro = (p, d = 3) => '€' + Number(p).toFixed(d).replace('.', ',');
