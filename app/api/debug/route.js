export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  // Gisteren
  const gisteren = new Date();
  gisteren.setDate(gisteren.getDate() - 1);
  const datumStr = gisteren.toISOString().split('T')[0];
  const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

  try {
    // Victron kwartierdata
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=15mins&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

    // Energieprijzen per uur
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];

    // All-in prijs per uur
    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = (p.price + 0.03 + 0.13) * 1.21;
    }

    function vindPrijs(tsMs) {
      const d = new Date(tsMs);
      d.setMinutes(0, 0, 0);
      return prijsPerUur[d.getTime()] ?? 0.15;
    }

    // Bereken per kwartier
    const details = [];
    const alleTs = new Set([
      ...(records.Bc || []).map(([ts]) => ts),
      ...(records.Pc || []).map(([ts]) => ts),
      ...(records.Gc || []).map(([ts]) => ts),
      ...(records.Gb || []).map(([ts]) => ts),
    ]);

    const maakMap = (veld) => Object.fromEntries((records[veld] || []).map(([ts, v]) => [ts, v]));
    const Bc = maakMap('Bc');
    const Pc = maakMap('Pc');
    const Gc = maakMap('Gc');
    const Gb = maakMap('Gb');

    let totaalWinst = 0;
    for (const ts of [...alleTs].sort()) {
      const prijs = vindPrijs(ts);
      const bc = Bc[ts] || 0;
      const pc = Pc[ts] || 0;
      const gc = Gc[ts] || 0;
      const gb = Gb[ts] || 0;
      const winst = (bc + pc - gc - gb) * prijs;
      totaalWinst += winst;
      details.push({
        tijd: new Date(ts).toISOString(),
        prijs: prijs.toFixed(4),
        bc: bc.toFixed(4),
        pc: pc.toFixed(4),
        gc: gc.toFixed(4),
        gb: gb.toFixed(4),
        winst: winst.toFixed(4),
      });
    }

    return Response.json({
      datum: datumStr,
      totaalWinst: totaalWinst.toFixed(2),
      verwacht_victron: '5.70',
      details,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}