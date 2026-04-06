export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  const gisteren = new Date();
  gisteren.setDate(gisteren.getDate() - 1);
  const datumStr = gisteren.toISOString().split('T')[0];
  const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

  try {
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=15mins&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

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

    function berekenSom(veld) {
      return (records[veld] || []).reduce((som, [ts, kwh]) => {
        return som + kwh * vindPrijs(ts);
      }, 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    // Volledige berekening
    const winstBg = berekenSom('Bg'); // batterij naar net
    const winstBc = berekenSom('Bc'); // batterij naar verbruikers
    const winstPc = berekenSom('Pc'); // zon naar verbruikers
    const winstPg = berekenSom('Pg'); // zon naar net
    const kostenGb = berekenSom('Gb'); // net naar batterij
    const kostenGc = berekenSom('Gc'); // net naar verbruikers

    const totaalWinst = winstBg + winstBc + winstPc + winstPg - kostenGb - kostenGc;

    return Response.json({
      datum: datumStr,
      verwacht_victron: '5.70',
      totaalWinst: totaalWinst.toFixed(2),
      uitsplitsing: {
        'Bg (batterij→net)':         { kwh: totaalKwh('Bg').toFixed(2), euro: winstBg.toFixed(2) },
        'Bc (batterij→verbruikers)': { kwh: totaalKwh('Bc').toFixed(2), euro: winstBc.toFixed(2) },
        'Pc (zon→verbruikers)':      { kwh: totaalKwh('Pc').toFixed(2), euro: winstPc.toFixed(2) },
        'Pg (zon→net)':              { kwh: totaalKwh('Pg').toFixed(2), euro: winstPg.toFixed(2) },
        'Gb (net→batterij) kosten':  { kwh: totaalKwh('Gb').toFixed(2), euro: `-${kostenGb.toFixed(2)}` },
        'Gc (net→verbruikers) kosten':{ kwh: totaalKwh('Gc').toFixed(2), euro: `-${kostenGc.toFixed(2)}` },
      }
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}