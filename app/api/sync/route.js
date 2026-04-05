import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function inkoopprijs(spot)  { return (spot + 0.03 + 0.13) * 1.21; }
function verkoopprijs(spot) { return spot * 1.21; }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Gisteren
    const gisteren = new Date();
    gisteren.setDate(gisteren.getDate() - 1);
    const datumStr = gisteren.toISOString().split('T')[0];
    const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
    const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

    // 2. Victron kwartierdata
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=15mins&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const records = victronData?.records || {};

    // 3. Energieprijzen per uur
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];

    // Maak een map van uur → spotprijs
    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = p.price;
    }

    // Zoek de spotprijs voor een gegeven timestamp
    function vindPrijs(tsMs) {
      const d = new Date(tsMs);
      d.setMinutes(0, 0, 0);
      const uurTs = d.getTime();
      return prijsPerUur[uurTs] ?? 0.10; // fallback 0.10
    }

    // 4. Bereken winst per datapunt
    function berekenSom(veld, prijsFn) {
      return (records[veld] || []).reduce((som, [ts, kwh]) => {
        const spot = vindPrijs(ts);
        return som + kwh * prijsFn(spot);
      }, 0);
    }

    const winstBgNet   = berekenSom('Bg', verkoopprijs); // batterij → net
    const winstBcThuis = berekenSom('Bc', inkoopprijs);  // batterij → verbruikers
    const winstPcThuis = berekenSom('Pc', inkoopprijs);  // zon → verbruikers
    const kostenGbNet  = berekenSom('Gb', inkoopprijs);  // net → batterij (laadkosten)
    const kostenGcNet  = berekenSom('Gc', inkoopprijs);  // net → verbruikers (netkosten)

    const totaalWinst = winstBgNet + winstBcThuis + winstPcThuis - kostenGbNet - kostenGcNet;

    // 5. Totalen voor opslag
    const som = (veld) => (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    const Pg = som('Pg'), Pc = som('Pc'), Pb = som('Pb');
    const Bg = som('Bg'), Bc = som('Bc');
    const Gb = som('Gb'), Gc = som('Gc');

    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: Pg + Pc + Pb,
      verbruik_kwh:    Pc + Bc + Gc,
      net_import_kwh:  Gb + Gc,
      net_export_kwh:  Pg + Bg,
      winst_euro:      totaalWinst,
    });

    return Response.json({
      success:       true,
      datum:         datumStr,
      Bg: Bg.toFixed(2), Bc: Bc.toFixed(2),
      Pc: Pc.toFixed(2), Pg: Pg.toFixed(2),
      Gb: Gb.toFixed(2), Gc: Gc.toFixed(2),
      winstBgNet:   winstBgNet.toFixed(2),
      winstBcThuis: winstBcThuis.toFixed(2),
      winstPcThuis: winstPcThuis.toFixed(2),
      kostenGbNet:  kostenGbNet.toFixed(2),
      kostenGcNet:  kostenGcNet.toFixed(2),
      winst:        totaalWinst.toFixed(2),
    });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}