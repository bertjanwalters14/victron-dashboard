import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// POST — ontvangt SOC van Node-RED
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const batterijPct = parseFloat(body.batterij_pct);
    const solarW      = body.solar_w    != null ? parseFloat(body.solar_w)    : null;
    const gridW       = body.grid_w     != null ? parseFloat(body.grid_w)     : null;
    const verbruikW   = body.verbruik_w != null ? parseFloat(body.verbruik_w) : null;

    if (isNaN(batterijPct)) {
      return Response.json({ error: 'batterij_pct is geen geldig getal' }, { status: 400 });
    }

    const sql = getDb();
    await sql`
      INSERT INTO onbalans_log (tijdstip, batterij_pct, solar_w, grid_w, verbruik_w)
      VALUES (NOW(), ${batterijPct}, ${solarW}, ${gridW}, ${verbruikW})
    `;

    return Response.json({ success: true, batterijPct, solarW, gridW, verbruikW });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET — haal laatste SOC op
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT batterij_pct, tijdstip
      FROM onbalans_log
      WHERE batterij_pct IS NOT NULL
      ORDER BY tijdstip DESC
      LIMIT 1
    `;
    return Response.json({
      success: true,
      batterijPct: rows.length > 0 ? parseFloat(rows[0].batterij_pct) : null,
      tijdstip:    rows.length > 0 ? rows[0].tijdstip : null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}