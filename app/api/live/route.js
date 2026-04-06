const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function victronPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Vandaag
    const nu = new Date();
    const datumStr = nu.toISOString().split('T')[0];
    const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
    const end   = Math.floor(nu.getTime() / 1000);

    // Victron uurdata van vandaag
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

    // Energieprijzen van vandaag
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];

    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = p.price;
    }

    function vindSpot(tsMs) {
      const d = new Date(tsMs);
      d.setMinutes(0, 0, 0);
      return prijsPerUur[d.getTime()] ?? 0.10;
    }

    function berekenSom(veld) {
      return (records[veld] || []).reduce((som, [ts, kwh]) => {
        return som + kwh * victronPrijs(vindSpot(ts));
      }, 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    const winstBg  = berekenSom('Bg');
    const winstBc  = berekenSom('Bc');
    const winstPc  = berekenSom('Pc');
    const kostenGc = berekenSom('Gc');
    const kostenGb = berekenSom('Gb');
    const GbKwh    = totaalKwh('Gb');
    const BgKwh    = totaalKwh('Bg');
    const BcKwh    = totaalKwh('Bc');
    const accuKosten = (GbKwh + BgKwh + BcKwh) * 0.01;

    const winst = winstBg + winstBc + winstPc - kostenGc - kostenGb - accuKosten;

    return Response.json({
      success: true,
      datum:   datumStr,
      winst:   winst.toFixed(2),
      winstBg:     winstBg.toFixed(2),
      winstBc:     winstBc.toFixed(2),
      winstPc:     winstPc.toFixed(2),
      kostenGc:    kostenGc.toFixed(2),
      kostenGb:    kostenGb.toFixed(2),
      accuKosten:  accuKosten.toFixed(2),
      bijgewerkt: nu.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' }),
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}