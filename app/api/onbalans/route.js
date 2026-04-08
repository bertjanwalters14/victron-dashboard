import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// Drempelwaarden — later instelbaar via dashboard
const DREMPEL_ONTLADEN = 0.25;  // €/kWh → ontladen als prijs hoger
const DREMPEL_LADEN    = 0.05;  // €/kWh → laden als prijs lager
const BAT_MIN_PCT      = 10;    // % → altijd stoppen onder dit niveau
const BAT_MAX_PCT      = 90;    // % → niet meer laden boven dit niveau

function bepaalBeslissing(prijs, batterijPct) {
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT) {
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  }
  if (prijs < 0) {
    return { beslissing: 'laden', reden: `Negatieve prijs (€${prijs.toFixed(4)}) — gratis stroom` };
  }
  if (prijs > DREMPEL_ONTLADEN && (batterijPct === null || batterijPct > BAT_MIN_PCT)) {
    return { beslissing: 'ontladen', reden: `Prijs hoog (€${prijs.toFixed(4)} > €${DREMPEL_ONTLADEN})` };
  }
  if (prijs < DREMPEL_LADEN && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    return { beslissing: 'laden', reden: `Prijs laag (€${prijs.toFixed(4)} < €${DREMPEL_LADEN})` };
  }
  return { beslissing: 'wachten', reden: `Prijs neutraal (€${prijs.toFixed(4)})` };
}

// GET — haal huidige prijs + beslissing op
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Haal huidige EPEX kwartierprijs op via EnergyZero
    const nu      = new Date();
    const vandaag = nu.toISOString().split('T')[0];
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${vandaag}T00:00:00.000Z&tillDate=${vandaag}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen   = prijsData?.Prices || [];

    // Zoek huidige kwartierprijs
    const huidigKwartier = prijzen.find(p => {
      const t = new Date(p.readingDate);
      return t <= nu && new Date(t.getTime() + 15 * 60000) > nu;
    }) || prijzen[prijzen.length - 1];

    const huidigePrijs = huidigKwartier ? huidigKwartier.price : null;

    // 2. Haal batterijpercentage op via Victron stats API
    let batterijPct = null;
    try {
      const nu2    = new Date();
      const start  = Math.floor(new Date(nu2.getTime() - 15 * 60000).getTime() / 1000);
      const end    = Math.floor(nu2.getTime() / 1000);
      const batRes = await fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${process.env.VICTRON_SITE_ID}/stats?type=live&start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${process.env.VICTRON_API_TOKEN}` } }
      );
      const batData = await batRes.json();
      const records = batData?.records || {};
      // SOC staat in Bs (Battery State of Charge)
      const socArr = records?.Bs || records?.soc || [];
      if (socArr.length > 0) {
        batterijPct = socArr[socArr.length - 1][1];
      }
    } catch {}

    // 3. Bepaal beslissing
    const { beslissing, reden } = huidigePrijs !== null
      ? bepaalBeslissing(huidigePrijs, batterijPct)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // 4. Sla op in database
    const sql = getDb();
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing, batterij_pct)
      VALUES (${nu.toISOString()}, ${huidigePrijs}, ${beslissing}, ${batterijPct})
    `;

    // 5. Haal alle prijzen van vandaag op voor grafiek
    const allePrijzen = prijzen.map(p => ({
      tijd:  new Date(p.readingDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
      prijs: +p.price.toFixed(4),
    }));

    return Response.json({
      success:      true,
      tijdstip:     nu.toISOString(),
      prijs:        huidigePrijs,
      batterijPct,
      beslissing,
      reden,
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

// GET history — haal log op van afgelopen 24 uur
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