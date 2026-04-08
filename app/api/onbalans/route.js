import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

const BAT_MIN_PCT        = 10;
const BAT_MAX_PCT        = 90;

// Prijsformule: (spotprijs + leverancier + energiebelasting) × BTW
const OPSLAG_LEVERANCIER = 0.03;
const ENERGIEBELASTING   = 0.13;
const BTW_FACTOR         = 1.21;

// Dynamische drempels: percentiel van de dagprijzen
const PERCENTIEL_LADEN    = 25; // goedkoopste 25% van de dag → laden
const PERCENTIEL_ONTLADEN = 75; // duurste 25% van de dag → ontladen
const VLOER_ONTLADEN      = 0.20; // nooit ontladen onder €0.20 consumentenprijs

function spotNaarConsumer(spot) {
  return (spot + OPSLAG_LEVERANCIER + ENERGIEBELASTING) * BTW_FACTOR;
}

function berekenDrempels(consumerPrijzen) {
  const gesorteerd = [...consumerPrijzen].sort((a, b) => a - b);
  const n = gesorteerd.length;
  const laadDrempel    = gesorteerd[Math.floor(n * PERCENTIEL_LADEN / 100)];
  const ontlaadDrempel = Math.max(
    gesorteerd[Math.floor(n * PERCENTIEL_ONTLADEN / 100)],
    VLOER_ONTLADEN
  );
  return { laadDrempel, ontlaadDrempel };
}

function bepaalBeslissing(consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel) {
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT) {
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  }
  if (consumerPrijs < 0) {
    return { beslissing: 'laden', reden: `Negatieve prijs (€${consumerPrijs.toFixed(4)}) — gratis stroom` };
  }
  if (consumerPrijs >= ontlaadDrempel && (batterijPct === null || batterijPct > BAT_MIN_PCT)) {
    return { beslissing: 'ontladen', reden: `Prijs hoog (€${consumerPrijs.toFixed(4)} ≥ €${ontlaadDrempel.toFixed(4)})` };
  }
  if (consumerPrijs <= laadDrempel && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    return { beslissing: 'laden', reden: `Prijs laag (€${consumerPrijs.toFixed(4)} ≤ €${laadDrempel.toFixed(4)})` };
  }
  return { beslissing: 'wachten', reden: `Prijs neutraal (€${consumerPrijs.toFixed(4)})` };
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
    const spotPrijs     = huidigKwartier ? huidigKwartier.price : null;
    const consumerPrijs = spotPrijs !== null ? spotNaarConsumer(spotPrijs) : null;

    // Dynamische drempels berekenen op basis van vandaag
    const consumerPrijzenVandaag = epexPrijzen.map(p => spotNaarConsumer(p.price));
    const { laadDrempel, ontlaadDrempel } = berekenDrempels(consumerPrijzenVandaag);

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

    // 4. Beslissing bepalen op basis van dagelijkse dynamische drempels
    const { beslissing, reden } = consumerPrijs !== null
      ? bepaalBeslissing(consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // 5. Opslaan in database (consumer prijs)
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing, batterij_pct)
      VALUES (${nu.toISOString()}, ${consumerPrijs}, ${beslissing}, ${batterijPct})
    `;

    // 6. Alle EPEX prijzen van vandaag voor grafiek (consumer prijs)
    const allePrijzen = epexPrijzen.map(p => ({
      tijd:  new Date(p.readingDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }),
      prijs: +spotNaarConsumer(p.price).toFixed(4),
      spot:  +p.price.toFixed(4),
    }));

    // Exacte tijd-label van het huidige kwartier (matcht altijd met grafiekdata)
    const huidigeTijd = huidigKwartier
      ? new Date(huidigKwartier.readingDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
      : null;

    return Response.json({
      success:     true,
      tijdstip:    nu.toISOString(),
      prijs:       consumerPrijs,
      spotprijs:   spotPrijs,
      huidigeTijd,
      batterijPct,
      beslissing,
      reden,
      tennet: tennetShortage !== null ? {
        shortage: tennetShortage,
        surplus:  tennetSurplus,
      } : null,
      drempels: {
        ontladen:   +ontlaadDrempel.toFixed(4),
        laden:      +laadDrempel.toFixed(4),
        batMin:     BAT_MIN_PCT,
        batMax:     BAT_MAX_PCT,
        percentiel: { laden: PERCENTIEL_LADEN, ontladen: PERCENTIEL_ONTLADEN },
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