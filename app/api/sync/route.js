import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function berekenPrijzen(spotprijs) {
  const inkoopprijs  = (spotprijs + 0.03 + 0.13) * 1.21; // spot + opslag + EB × BTW
  const verkoopprijs = spotprijs * 1.21;                  // alleen spot × BTW
  return { inkoopprijs, verkoopprijs };
}

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

    // 2. Victron statistics API
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=days&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const totals = victronData?.totals || {};

    const Bg = parseFloat(totals.Bg || 0); // Batterij naar net
    const Bc = parseFloat(totals.Bc || 0); // Batterij naar verbruikers
    const Pc = parseFloat(totals.Pc || 0); // Zon naar verbruikers
    const Pb = parseFloat(totals.Pb || 0); // Zon naar batterij
    const Pg = parseFloat(totals.Pg || 0); // Zon naar net
    const Gb = parseFloat(totals.Gb || 0); // Net naar batterij
    const Gc = parseFloat(totals.Gc || 0); // Net naar verbruikers
    const totalPV = Pg + Pc + Pb;

    // 3. Dynamische prijzen per kwartier ophalen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];
    const gemSpot   = prijzen.length > 0
      ? prijzen.reduce((s, p) => s + p.price, 0) / prijzen.length
      : 0.10;

    const { inkoopprijs, verkoopprijs } = berekenPrijzen(gemSpot);

    // 4. Winstberekening (zoals Victron app)
    // + Batterij naar net         × verkoopprijs (verkoop bij hoge prijs)
    // + Batterij naar verbruikers × inkoopprijs  (vermeden inkoop)
    // + Zon naar verbruikers      × inkoopprijs  (vermeden inkoop)
    // - Net naar batterij         × inkoopprijs  (laadkosten van net)
    // - Net naar verbruikers      × inkoopprijs  (netkosten)
    const winstBgNet   = Bg * verkoopprijs;
    const winstBcThuis = Bc * inkoopprijs;
    const winstPcThuis = Pc * inkoopprijs;
    const kostenGbNet  = Gb * verkoopprijs;
    const kostenGcNet  = Gc * verkoopprijs;

    const totaalWinst = winstBgNet + winstBcThuis + winstPcThuis - kostenGbNet - kostenGcNet;

    // 5. Opslaan
    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: totalPV,
      verbruik_kwh:    Pc + Bc + Gc,
      net_import_kwh:  Gb + Gc,
      net_export_kwh:  Pg + Bg,
      winst_euro:      totaalWinst,
    });

    return Response.json({
      success: true,
      datum: datumStr,
      Bg, Bc, Pc, Pb, Pg, Gb, Gc,
      inkoopprijs:  inkoopprijs.toFixed(4),
      verkoopprijs: verkoopprijs.toFixed(4),
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