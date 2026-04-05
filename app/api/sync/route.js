import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function berekenPrijs(spotprijs) {
  return (spotprijs + 0.03 + 0.13) * 1.21;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Gisteren als timestamp
    const gisteren = new Date();
    gisteren.setDate(gisteren.getDate() - 1);
    const datumStr = gisteren.toISOString().split('T')[0];
    const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
    const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

    // 2. Victron statistics API (dagdata)
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=days&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();
    const totals = victronData?.totals || {};

    // 3. Velden uitlezen
    const pvNaarNet         = parseFloat(totals.Pg || 0);  // PV to grid
    const pvNaarVerbruiker  = parseFloat(totals.Pc || 0);  // PV to consumers
    const pvNaarBatterij    = parseFloat(totals.Pb || 0);  // PV to battery
    const batNaarNet        = parseFloat(totals.Bg || 0);  // Battery to grid
    const batNaarVerbruiker = parseFloat(totals.Bc || 0);  // Battery to consumers
    const netNaarBatterij   = parseFloat(totals.Gb || 0);  // Grid to battery
    const netNaarVerbruiker = parseFloat(totals.Gc || 0);  // Grid to consumers
    const totalPV           = pvNaarNet + pvNaarVerbruiker + pvNaarBatterij;

    // 4. Dynamische energieprijs ophalen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];
    const gemSpot   = prijzen.length > 0
      ? prijzen.reduce((s, p) => s + p.price, 0) / prijzen.length
      : 0.10;
    const eindprijs = berekenPrijs(gemSpot);

    // 5. Winstberekening
    // Batterij naar net = verkoop aan net
    // Batterij naar verbruikers = vermeden inkoop
    const winstBatNaarNet        = batNaarNet * eindprijs;
    const winstBatNaarVerbruiker = batNaarVerbruiker * eindprijs;
    const totaalWinst            = winstBatNaarNet + winstBatNaarVerbruiker;

    // 6. Opslaan in database
    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: totalPV,
      verbruik_kwh:    pvNaarVerbruiker + batNaarVerbruiker + netNaarVerbruiker,
      net_import_kwh:  netNaarBatterij + netNaarVerbruiker,
      net_export_kwh:  pvNaarNet + batNaarNet,
      winst_euro:      totaalWinst,
    });

    return Response.json({
      success:          true,
      datum:            datumStr,
      pvNaarNet,
      pvNaarVerbruiker,
      pvNaarBatterij,
      batNaarNet,
      batNaarVerbruiker,
      netNaarBatterij,
      eindprijs:        eindprijs.toFixed(4),
      winst:            totaalWinst.toFixed(2),
    });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}