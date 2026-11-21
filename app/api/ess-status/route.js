import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// POST — ontvangt de live ESS-beslissing van Node-RED (status + forecast, en sinds 21-11-2026 de celspanningen per pack).
// Body: { status: {...}, forecast: [...], cellen: { t, packs: [...] } | null }
// `cellen` komt uit global.ess_cellen van de meetflow "Celspanningen" (zie celdata/). Ontbreekt het in een push (meetflow uit,
// oudere push-node), dan blijft de vorige waarde staan: de kaart in de app toont dan hoe oud die is.
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const status = body.status ?? {};
    const forecast = Array.isArray(body.forecast) ? body.forecast : [];
    const cellenRuw = body.cellen && typeof body.cellen === 'object' && Array.isArray(body.cellen.packs) ? JSON.stringify(body.cellen) : null;
    const cellen = cellenRuw && cellenRuw.length <= 50000 ? cellenRuw : null;   // 2 packs zijn ~3 kB; alles boven 50 kB is geen celdata

    const sql = getDb();
    await sql`
      CREATE TABLE IF NOT EXISTS ess_live (
        id int PRIMARY KEY DEFAULT 1,
        status jsonb,
        forecast jsonb,
        bijgewerkt timestamptz DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE ess_live ADD COLUMN IF NOT EXISTS cellen jsonb`;
    await sql`
      INSERT INTO ess_live (id, status, forecast, cellen, bijgewerkt)
      VALUES (1, ${JSON.stringify(status)}::jsonb, ${JSON.stringify(forecast)}::jsonb, ${cellen}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        status     = EXCLUDED.status,
        forecast   = EXCLUDED.forecast,
        cellen     = COALESCE(EXCLUDED.cellen, ess_live.cellen),
        bijgewerkt = EXCLUDED.bijgewerkt
    `;

    return Response.json({ success: true, ontvangen: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET — laatste status + forecast + celspanningen (zonder secret; read-only, voor het dashboard).
// De kolom `cellen` lees ik via to_jsonb(ess_live)->'cellen': bestaat de kolom nog niet (tussen deploy en de eerste push met celdata)
// dan geeft dat gewoon null i.p.v. een fout, en blijft de rest van het dashboard werken.
export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT status, forecast, bijgewerkt, to_jsonb(ess_live)->'cellen' AS cellen FROM ess_live WHERE id = 1`;
    const r = rows[0];
    return Response.json({
      success: true,
      status: r?.status ?? {},
      forecast: r?.forecast ?? [],
      cellen: r?.cellen ?? null,
      bijgewerkt: r?.bijgewerkt ?? null,
    });
  } catch (err) {
    return Response.json({ success: true, status: {}, forecast: [], cellen: null, bijgewerkt: null });
  }
}
