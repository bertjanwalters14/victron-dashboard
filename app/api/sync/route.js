import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Exacte Victron DESS formule
function victronPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Datum
    const datumParam = searchParams.get('datum');
    let datumStr;
    if (datumParam) {
      datumStr = datumParam;
    } else {
      const gisteren = new Date();
      gisteren.setDate(gisteren.getDate() - 1);
      datumStr = gisteren.toISOString().split('T')[0];
    }
    const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
    const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

    // 2. Victron uurdata
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

    // 3. Energieprijzen per uur van EnergyZero
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];

    // Map van uur timestamp → spotprijs
    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = p.price;
    }

    function vindSpot(tsMs) {
      // Rond af naar het uur
      const d = new Date(tsMs);
      d.setMinutes(0, 0, 0);
      return prijsPerUur[d.getTime()] ?? 0.10;
    }

    // Bereken som voor een veld
    function berekenSom(veld) {
      return (records[veld] || []).reduce((som, [ts, kwh]) => {
        return som + kwh * victronPrijs(vindSpot(ts));
      }, 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    // 4. Winstberekening (exacte Victron methode)
    const winstBg = berekenSom('Bg'); // naar net (zon + batterij)
    const winstBc = berekenSom('Bc'); // batterij naar verbruikers
    const winstPc = berekenSom('Pc'); // zon naar verbruikers
    const kostenGc = berekenSom('Gc'); // net naar verbruikers
    const kostenGb = berekenSom('Gb'); // net naar batterij

    // Accu kosten: €0.01 per kWh doorvoer (laden + ontladen)
    const GbKwh = totaalKwh('Gb');
    const BgKwh = totaalKwh('Bg');
    const BcKwh = totaalKwh('Bc');
    const accuKosten = (GbKwh + BgKwh + BcKwh) * 0.01;

    const totaalWinst = winstBg - accuKosten;

    // 5. Totalen voor opslag
    const PcKwh = totaalKwh('Pc');
    const PgKwh = totaalKwh('Pg');
    const PbKwh = totaalKwh('Pb');
    const GcKwh = totaalKwh('Gc');

    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: PgKwh + PcKwh + PbKwh,
      verbruik_kwh:    BcKwh + PcKwh + GcKwh,
      net_import_kwh:  GbKwh + GcKwh,
      net_export_kwh:  BgKwh + PgKwh,
      winst_euro:      totaalWinst,
    });

    return Response.json({
      success:      true,
      datum:        datumStr,
      winstBg:      winstBg.toFixed(2),
      winstBc:      winstBc.toFixed(2),
      winstPc:      winstPc.toFixed(2),
      kostenGc:     kostenGc.toFixed(2),
      kostenGb:     kostenGb.toFixed(2),
      accuKosten:   accuKosten.toFixed(2),
      winst:        totaalWinst.toFixed(2),
    });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}