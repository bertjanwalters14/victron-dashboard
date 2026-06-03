import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// GET — huidige stand van "laden uit net" (gelezen door dashboard én Node-RED).
// Geen secret: read-only, lage gevoeligheid.
export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT waarde FROM instellingen WHERE sleutel = 'laad_van_net'`;
    const aan = rows[0]?.waarde === 'true';
    return Response.json({ success: true, laadVanNet: aan });
  } catch {
    return Response.json({ success: true, laadVanNet: false });
  }
}

// POST — zet de stand (secret vereist; backup naast de UI-knop / server action).
// Body: { aan: true | false }
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const aan = body.aan === true || body.aan === 'true';
    const sql = getDb();
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('laad_van_net', ${aan ? 'true' : 'false'}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET
        waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
    `;
    return Response.json({ success: true, laadVanNet: aan });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
