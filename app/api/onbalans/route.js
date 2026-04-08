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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const nu      = new Date();
    const vandaag = nu.toISOString().split('T')[0];

    // 1. EPEX kwartierprijs ophalen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${vandaag}T00:00:00.000Z&tillDate=${vandaag}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData  = await prijsRes.json();
    const prijzen    = prijsData?.Prices || [];
    const huidigKwartier = prijzen.find(p => {
      const t = new Date(p.readingDate);
      return t <= nu && new Date(t.getTime() + 15 * 60000) > nu;
    }) || prijzen[prijzen.length - 1];
    const huidigePrijs = huidigKwartier ? huidigKwartier.price : null;

    // 2. SOC ophalen uit database (gestuurd door Node-RED)
    const sql = getDb();
    const socRow = await sql`
      SELECT batterij_pct FROM onbalans_log
      WHERE batterij_pct IS NOT NULL
      ORDER BY tijdstip DESC LIMIT 1
    `;
    const batterijPct = socRow.length > 0 ? parseFloat(socRow[0].batterij_pct) : null;

    // 3. Beslissing bepalen
    const { beslissing, reden } = huidigePrijs !== null
      ? bepaalBeslissing(huidigePrijs, batterijPct)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // 4. Opslaan in database
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing, batterij_pct)
      VALUES (${nu.toISOString()}, ${huidigePrijs}, ${beslissing}, ${batterijPct})
    `;

    // 5. Alle prijzen van vandaag voor grafiek
    const allePrijzen = prijzen.map(p => ({
      tijd:  new Date(p.readingDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
      prijs: +p.price.toFixed(4),
    }));

    return Response.json({
      success:        true,
      tijdstip:       nu.toISOString(),
      prijs:          huidigePrijs,
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