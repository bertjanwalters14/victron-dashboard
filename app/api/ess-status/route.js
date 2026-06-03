import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// POST — ontvangt de live ESS-beslissing van Node-RED (status + forecast).
// Body: { status: {...}, forecast: [...] }
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const status = body.status ?? {};
    const forecast = Array.isArray(body.forecast) ? body.forecast : [];

    const sql = getDb();
    await sql`
      CREATE TABLE IF NOT EXISTS ess_live (
        id int PRIMARY KEY DEFAULT 1,
        status jsonb,
        forecast jsonb,
        bijgewerkt timestamptz DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO ess_live (id, status, forecast, bijgewerkt)
      VALUES (1, ${JSON.stringify(status)}::jsonb, ${JSON.stringify(forecast)}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status     = EXCLUDED.status,
        forecast   = EXCLUDED.forecast,
        bijgewerkt = EXCLUDED.bijgewerkt
    `;

    return Response.json({ success: true, ontvangen: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET — laatste status + forecast (zonder secret; read-only, voor het dashboard).
export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT status, forecast, bijgewerkt FROM ess_live WHERE id = 1`;
    const r = rows[0];
    return Response.json({
      success: true,
      status: r?.status ?? {},
      forecast: r?.forecast ?? [],
      bijgewerkt: r?.bijgewerkt ?? null,
    });
  } catch (err) {
    return Response.json({ success: true, status: {}, forecast: [], bijgewerkt: null });
  }
}
