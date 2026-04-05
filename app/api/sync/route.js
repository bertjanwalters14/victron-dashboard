import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function berekenPrijs(spotprijs) {
  return (spotprijs + 0.03 + 0.13) * 1.21;
}

function vindWaarde(records, code) {
  const rec = records.find(r => r.code === code);
  return rec ? parseFloat(rec.rawValue || 0) : 0;
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
    const records = victronData?.records || [];

    // 2. Relevante velden uitlezen
    const pvNaarNet        = vindWaarde(records, 'Pg');   // PV to grid (kWh)
    const pvNaarVerbruiker = vindWaarde(records, 'Pc');   // PV to consumers (kWh)
    const pvNaarBatterij   = vindWaarde(records, 'Pb');   // PV to battery (kWh)
    const batNaarNet       = vindWaarde(records, 'Bg');   // Battery to grid (kWh)
    const batNaarVerbruiker= vindWaarde(records, 'Bc');   // Battery to consumers (kWh)
    const netNaarBatterij  = vindWaarde(records, 'Gb');   // Grid to battery (kWh)
    const netNaarVerbruiker= vindWaarde(records, 'Gc');   // Grid to consumers (kWh)
    const totalPV          = pvNaarNet + pvNaarVerbruiker + pvNaarBatterij;

    // 3. Dynamische energieprijs ophalen
    const gisteren = new Date();
    gisteren.setDate(gisteren.getDate() - 1);
    const datumStr = gisteren.toISOString().split('T')[0];

    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();

    const prijzen  = prijsData?.Prices || [];
    const gemSpot  = prijzen.length > 0
      ? prijzen.reduce((s, p) => s + p.price, 0) / prijzen.length
      : 0.10;
    const eindprijs = berekenPrijs(gemSpot);

    // 4. Winstberekening
    // Batterij naar net = verkoop aan net
    // Batterij naar verbruikers = vermeden inkoop
    const winstBatNaarNet        = batNaarNet * eindprijs;
    const winstBatNaarVerbruiker = batNaarVerbruiker * eindprijs;
    const totaalWinst = winstBatNaarNet + winstBatNaarVerbruiker;

    // 5. Opslaan in database
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