import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function allinPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Datum (gisteren of opgegeven datum via ?datum=2026-04-04)
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

    // All-in prijs per uur
    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = allinPrijs(p.price);
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

    // 4. Winstberekening
    const winstBg = berekenSom('Bg'); // naar net
    const winstBc = berekenSom('Bc'); // batterij naar verbruikers
    const winstPc = berekenSom('Pc'); // zon naar verbruikers
    const kostenGc = berekenSom('Gc'); // net naar verbruikers
    const kostenGb = berekenSom('Gb'); // net naar batterij

    const totaalWinst = winstBg + winstBc + winstPc - kostenGc - kostenGb;

    // 5. Totalen
    const Bg = totaalKwh('Bg'), Bc = totaalKwh('Bc');
    const Pc = totaalKwh('Pc'), Pg = totaalKwh('Pg');
    const Pb = totaalKwh('Pb'), Gb = totaalKwh('Gb');
    const Gc = totaalKwh('Gc');

    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: Bg + Pc + Pb, // totale zon (Bg = zon+bat naar net, Pc = zon thuis)
      verbruik_kwh:    Bc + Pc + Gc,
      net_import_kwh:  Gb + Gc,
      net_export_kwh:  Bg,
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
      winst:        totaalWinst.toFixed(2),
    });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}