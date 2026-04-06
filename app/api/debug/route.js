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

  const datum = searchParams.get('datum') || (() => {
    const g = new Date();
    g.setDate(g.getDate() - 1);
    return g.toISOString().split('T')[0];
  })();

  const start = Math.floor(new Date(datum + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datum + 'T23:59:59').getTime() / 1000);

  try {
    // Victron uurdata
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const records = (await victronRes.json())?.records || {};

    // Energieprijzen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datum}T00:00:00.000Z&tillDate=${datum}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijzen = (await prijsRes.json())?.Prices || [];

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
      return (records[veld] || []).reduce((s, [ts, kwh]) => s + kwh * victronPrijs(vindSpot(ts)), 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    // Formule 1: huidige (Bg+Bc+Pc-Gc-Gb-accuKosten)
    const winstBg    = berekenSom('Bg');
    const winstBc    = berekenSom('Bc');
    const winstPc    = berekenSom('Pc');
    const kostenGc   = berekenSom('Gc');
    const kostenGb   = berekenSom('Gb');
    const GbKwh      = totaalKwh('Gb');
    const BgKwh      = totaalKwh('Bg');
    const BcKwh      = totaalKwh('Bc');
    const accuKosten = (GbKwh + BgKwh + BcKwh) * 0.01;
    const formule1   = winstBg + winstBc + winstPc - kostenGc - kostenGb - accuKosten;

    // Formule 2: nieuwe (Bc+Pc-Gc-Gb*0.01)
    const GbKwh2   = totaalKwh('Gb');
    const formule2 = winstBc + winstPc - kostenGc - (GbKwh2 * 0.01);

    // Formule 3: alleen Bg - accuKosten
    const formule3 = winstBg - accuKosten;

    return Response.json({
      datum,
      kwh: {
        Bg: BgKwh.toFixed(2),
        Bc: BcKwh.toFixed(2),
        Pc: totaalKwh('Pc').toFixed(2),
        Gc: totaalKwh('Gc').toFixed(2),
        Gb: GbKwh.toFixed(2),
      },
      euro: {
        winstBg:   winstBg.toFixed(2),
        winstBc:   winstBc.toFixed(2),
        winstPc:   winstPc.toFixed(2),
        kostenGc:  kostenGc.toFixed(2),
        kostenGb:  kostenGb.toFixed(2),
        accuKosten: accuKosten.toFixed(2),
      },
      resultaten: {
        formule1_huidig:        formule1.toFixed(2),
        formule2_BcPcGcGb001:   formule2.toFixed(2),
        formule3_BgAccu:        formule3.toFixed(2),
      }
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}