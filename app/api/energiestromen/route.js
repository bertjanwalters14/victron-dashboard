const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Zelfde VRM-call als /api/live en /api/sync (Bg/Bc/Pc/Pg/Pb/Gc/Gb, interval=hours) -- die tellen 'm
// meteen op tot één dagtotaal, dit geeft 'm juist per uur terug voor de energiestromen-grafiek op /ess.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const nu = new Date();
    const datumStr = nu.toISOString().split('T')[0];
    const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
    const end   = Math.floor(nu.getTime() / 1000);

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
        const d = new Date(ts);
        const uurKey = ('0' + d.getHours()).slice(-2) + ':00';
        if (!perUur[uurKey]) perUur[uurKey] = { uur: uurKey, Bg: 0, Pg: 0, Pb: 0, Pc: 0, Bc: 0, Gc: 0, Gb: 0 };
        perUur[uurKey][veld] = +Number(kwh).toFixed(2);
      }
    }

    const uren = Object.values(perUur).sort((a, b) => a.uur.localeCompare(b.uur));
    return Response.json({ success: true, datum: datumStr, uren });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
