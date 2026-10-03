// Tijdzone-helpers voor Europe/Amsterdam. Vercel draait in UTC: Date#getTimezoneOffset() en
// new Date('YYYY-MM-DDT00:00:00') (zonder Z) zijn daar dus altijd UTC en nooit bruikbaar voor zomertijd.
// Alles hier rekent via Intl met expliciete tijdzone, onafhankelijk van de server-tijdzone.
const TZ = 'Europe/Amsterdam';

// Hoeveel uur Amsterdam op dit moment vooroploopt op UTC (CET=1, CEST=2).
function offsetUurOp(utcMs) {
  const lokaal = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(utcMs)), 10) % 24;
  let v = lokaal - new Date(utcMs).getUTCHours();
  if (v < -12) v += 24;
  if (v > 12) v -= 24;
  return v;
}

// Offset (uren) op het lokale middernacht-moment van `datumStr` (YYYY-MM-DD). 00:00Z ligt vóór de
// omschakeling (01:00Z), dus dit klopt ook op de twee omschakeldagen.
export function nlOffsetUur(datumStr) {
  return offsetUurOp(Date.parse(datumStr + 'T00:00:00Z'));
}

// Lokale kalenderdatum (YYYY-MM-DD) van dit moment in Nederland.
export function nlVandaagStr(nu = new Date()) {
  return nu.toLocaleDateString('sv-SE', { timeZone: TZ });
}

// UNIX-seconden van het begin en het laatste moment van de Nederlandse kalenderdag `datumStr`.
export function nlDagVensterSec(datumStr) {
  const mid = Date.parse(datumStr + 'T00:00:00Z');
  const volg = mid + 86400000;
  const start = mid / 1000 - offsetUurOp(mid) * 3600;
  const eind = volg / 1000 - offsetUurOp(volg) * 3600 - 1;
  return { start, eind };
}
