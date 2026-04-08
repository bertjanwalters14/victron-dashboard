import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// GET — haal huidige modus op (geen secret, dashboard leest dit op load)
export async function GET() {
  try {
    const sql  = getDb();
    const rows = await sql`SELECT waarde FROM instellingen WHERE sleutel = 'modus'`;
    return Response.json({ success: true, modus: rows[0]?.waarde ?? 'handel' });
  } catch (err) {
    // Tabel bestaat nog niet → standaard handel
    return Response.json({ success: true, modus: 'handel' });
  }
}

// POST — wissel modus { modus: 'handel' | 'groen' }
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body  = await request.json();
    const modus = body.modus;
    if (modus !== 'handel' && modus !== 'groen') {
      return Response.json({ error: 'Gebruik "handel" of "groen"' }, { status: 400 });
    }
    const sql = getDb();
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('modus', ${modus}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET
        waarde     = EXCLUDED.waarde,
        bijgewerkt = EXCLUDED.bijgewerkt
    `;
    return Response.json({ success: true, modus });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
