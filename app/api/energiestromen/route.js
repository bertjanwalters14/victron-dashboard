const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Simpele DST-check voor Nederland, zelfde als /api/sync.
function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

// NL-lokaal uur (0-23) van een timestamp, ONGEACHT de tijdzone van de server zelf (Vercel draait in
// UTC) -- zonder dit zouden de uur-labels in de grafiek stilletjes 1-2 uur verschoven zijn.
function nlUur(tsMs) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false });
  return parseInt(fmt.format(new Date(tsMs)), 10) % 24;
}

// Zelfde VRM-call als /api/live en /api/sync (Bg/Pc/Pg/Pb/Bc/Gc/Gb, interval=hours) -- die tellen 'm
// meteen op tot één dagtotaal, dit geeft 'm juist per uur terug voor de energiestromen-grafiek op /ess.
// ?datum=YYYY-MM-DD kiest een andere dag dan vandaag (bv. teruggebladerd via de dag-navigatie).
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const vandaagStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // YYYY-MM-DD
    const datumStr = searchParams.get('datum') || vandaagStr;
    const isVandaag = datumStr === vandaagStr;

    const isDST  = isDaylightSaving(new Date(datumStr + 'T12:00:00Z'));
    const offset = isDST ? '+02:00' : '+01:00';
    const start  = Math.floor(new Date(datumStr + 'T00:00:00' + offset).getTime() / 1000);
    const end    = isVandaag
      ? Math.floor(Date.now() / 1000)
      : Math.floor(new Date(datumStr + 'T23:59:59' + offset).getTime() / 1000);

    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

    const VELDEN = ['Bg', 'Pg', 'Pb', 'Pc', 'Bc', 'Gc', 'Gb'];
    const perUur = {};
    for (const veld of VELDEN) {
      for (const [ts, kwh] of (records[veld] || [])) {
        const uurKey = ('0' + nlUur(ts)).slice(-2) + ':00';
        if (!perUur[uurKey]) perUur[uurKey] = { uur: uurKey, Bg: 0, Pg: 0, Pb: 0, Pc: 0, Bc: 0, Gc: 0, Gb: 0 };
        perUur[uurKey][veld] = +Number(kwh).toFixed(2);
      }
    }

    const uren = Object.values(perUur).sort((a, b) => a.uur.localeCompare(b.uur));
    return Response.json({ success: true, datum: datumStr, vandaag: isVandaag, uren });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
