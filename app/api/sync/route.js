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
    // 1. Victron data ophalen
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/diagnostics`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const victronData = await victronRes.json();

    // 2. Dynamische energieprijs van gisteren ophalen
    const gisteren = new Date();
    gisteren.setDate(gisteren.getDate() - 1);
    const datumStr = gisteren.toISOString().split('T')[0];

    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();

    const prijzen   = prijsData?.Prices || [];
    const gemSpot   = prijzen.length > 0
      ? prijzen.reduce((s, p) => s + p.price, 0) / prijzen.length
      : 0.10;
    const eindprijs = berekenPrijs(gemSpot);

    // 3. Victron velden verwerken
    const records    = victronData?.records || {};
    const solar      = parseFloat(records.total_solar_yield  || 0);
    const verbruik   = parseFloat(records.total_consumption  || 0);
    const netFrom    = parseFloat(records.grid_history_from  || 0);
    const netTo      = parseFloat(records.grid_history_to    || 0);

    const zelfverbruikZon = Math.max(0, solar - netTo);
    const batterijBijdrage = Math.max(0, verbruik - solar - netFrom);
    const totaalWinst =
      zelfverbruikZon   * eindprijs +
      netTo             * eindprijs * 0.7 +
      batterijBijdrage  * eindprijs;

    // 4. Opslaan in Neon
    await upsertEnergieData({
      datum:           datumStr,
      solar_yield_kwh: solar,
      verbruik_kwh:    verbruik,
      net_import_kwh:  netFrom,
      net_export_kwh:  netTo,
      winst_euro:      totaalWinst,
    });

    return Response.json({
      success: true,
      datum:      datumStr,
      solar,
      verbruik,
      netFrom,
      netTo,
      eindprijs:  eindprijs.toFixed(4),
      winst:      totaalWinst.toFixed(2),
    });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}