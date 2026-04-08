import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

const DREMPEL_ONTLADEN = 0.25;
const DREMPEL_LADEN    = 0.05;
const BAT_MIN_PCT      = 10;
const BAT_MAX_PCT      = 90;

function bepaalBeslissing(epexPrijs, batterijPct, tennetShortage, tennetSurplus) {
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT) {
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  }
  if (epexPrijs < 0) {
    return { beslissing: 'laden', reden: `Negatieve EPEX prijs (€${epexPrijs.toFixed(4)}) — gratis stroom` };
  }
  if (epexPrijs > DREMPEL_ONTLADEN && (batterijPct === null || batterijPct > BAT_MIN_PCT)) {
    return { beslissing: 'ontladen', reden: `EPEX prijs hoog (€${epexPrijs.toFixed(4)} > €${DREMPEL_ONTLADEN})` };
  }
  if (epexPrijs < DREMPEL_LADEN && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    return { beslissing: 'laden', reden: `EPEX prijs laag (€${epexPrijs.toFixed(4)} < €${DREMPEL_LADEN})` };
  }
  return { beslissing: 'wachten', reden: `Prijs neutraal (€${epexPrijs.toFixed(4)})` };
}

// TenneT geeft prijzen in EUR/MWh — omrekenen naar EUR/kWh
function mwhNaarKwh(mwh) {
  return mwh / 1000;
}

function formatTenneTDatum(date) {
  const d  = String(date.getUTCDate()).padStart(2, '0');
  const m  = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y  = date.getUTCFullYear();
  const h  = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s  = String(date.getUTCSeconds()).padStart(2, '0');
  return `${d}-${m}-${y} ${h}:${mi}:${s}`;
}

async function haalTenneTData(nu) {
  const apiKey = process.env.TENNET_API_KEY;
  if (!apiKey) return null; // optioneel — geen fout als key ontbreekt

  // Fetch de hele dag in 1 call (limiet: 25 calls/dag op productie)
  const dagStart = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate(), 0, 0, 0));
  const res = await fetch(
    `https://api.tennet.eu/publications/v1/settlement-prices?date_from=${encodeURIComponent(formatTenneTDatum(dagStart))}&date_to=${encodeURIComponent(formatTenneTDatum(nu))}`,
    { headers: { apikey: apiKey, Accept: 'application/json' } }
  );
  if (!res.ok) return null; // bij fout gewoon doorgaan zonder TenneT
  return res.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const nu      = new Date();
    const vandaag = nu.toISOString().split('T')[0];

    // 1. EPEX kwartierprijs ophalen via EnergyZero (primaire handelsprijs)
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${vandaag}T00:00:00.000Z&tillDate=${vandaag}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData      = await prijsRes.json();
    const epexPrijzen    = prijsData?.Prices || [];
    const huidigKwartier = epexPrijzen.find(p => {
      const t = new Date(p.readingDate);
      return t <= nu && new Date(t.getTime() + 15 * 60000) > nu;
    }) || epexPrijzen[epexPrijzen.length - 1];
    const epexPrijs = huidigKwartier ? huidigKwartier.price : null;

    // 2. TenneT onbalansprijzen ophalen (aanvullende info)
    const tennетData   = await haalTenneTData(nu);
    const tennетPoints = tennетData?.TimeSeries?.[0]?.Period?.Points || [];
    const huidigTennet = tennетPoints.find(p => {
      const start = new Date(p.timeInterval_start);
      const eind  = new Date(p.timeInterval_end);
      return start <= nu && eind > nu;
    }) || tennетPoints[tennетPoints.length - 1];
    const tennetShortage = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.shortage)) : null;
    const tennetSurplus  = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.surplus))  : null;

    // 3. SOC ophalen uit database (gestuurd door Node-RED)
    const sql = getDb();
    const socRow = await sql`
      SELECT batterij_pct FROM onbalans_log
      WHERE batterij_pct IS NOT NULL
      ORDER BY tijdstip DESC LIMIT 1
    `;
    const batterijPct = socRow.length > 0 ? parseFloat(socRow[0].batterij_pct) : null;

    // 4. Beslissing bepalen (primair op EPEX, TenneT beschikbaar voor toekomstige logica)
    const { beslissing, reden } = epexPrijs !== null
      ? bepaalBeslissing(epexPrijs, batterijPct, tennetShortage, tennetSurplus)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // 5. Opslaan in database
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing, batterij_pct)
      VALUES (${nu.toISOString()}, ${epexPrijs}, ${beslissing}, ${batterijPct})
    `;

    // 6. Alle EPEX prijzen van vandaag voor grafiek
    const allePrijzen = epexPrijzen.map(p => ({
      tijd:  new Date(p.readingDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
      prijs: +p.price.toFixed(4),
    }));

    return Response.json({
      success:     true,
      tijdstip:    nu.toISOString(),
      prijs:       epexPrijs,
      batterijPct,
      beslissing,
      reden,
      tennet: tennetShortage !== null ? {
        shortage: tennetShortage,
        surplus:  tennetSurplus,
      } : null,
      drempels: {
        ontladen: DREMPEL_ONTLADEN,
        laden:    DREMPEL_LADEN,
        batMin:   BAT_MIN_PCT,
        batMax:   BAT_MAX_PCT,
      },
      prijzenVandaag: allePrijzen,
    });

  } catch (err) {
    console.error('Onbalans fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT tijdstip, prijs_kwh, beslissing, batterij_pct
      FROM onbalans_log
      WHERE tijdstip > NOW() - INTERVAL '24 hours'
      ORDER BY tijdstip DESC
      LIMIT 100
    `;
    return Response.json({ success: true, data: rows });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}