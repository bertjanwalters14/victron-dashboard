import { neon } from '@neondatabase/serverless';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS solar_w    NUMERIC`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS grid_w     NUMERIC`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS verbruik_w NUMERIC`;

    // bron kolom: onderscheid Node-RED rijen van beslissings-rijen (robuuster dan solar_w IS NOT NULL)
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS bron TEXT`;
    await sql`UPDATE onbalans_log SET bron = 'nodered' WHERE solar_w IS NOT NULL AND bron IS NULL`;

    await sql`
      CREATE TABLE IF NOT EXISTS instellingen (
        sleutel    TEXT PRIMARY KEY,
        waarde     TEXT NOT NULL,
        bijgewerkt TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      INSERT INTO instellingen (sleutel, waarde)
      VALUES ('modus', 'handel')
      ON CONFLICT (sleutel) DO NOTHING
    `;

    return Response.json({
      success: true,
      bericht: 'Migraties klaar: solar_w/grid_w/verbruik_w kolommen + instellingen tabel aangemaakt',
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
