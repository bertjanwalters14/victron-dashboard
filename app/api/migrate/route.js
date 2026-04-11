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

    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS bron TEXT`;
    await sql`UPDATE onbalans_log SET bron = 'nodered' WHERE solar_w IS NOT NULL AND bron IS NULL`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS essentieel_w NUMERIC`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS bat_w NUMERIC`;

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

    await sql`
      CREATE TABLE IF NOT EXISTS vrm_dag_stats (
        dag               DATE PRIMARY KEY,
        kwh_zon           NUMERIC,
        kwh_geladen       NUMERIC,
        kwh_geladen_zon   NUMERIC,
        kwh_geladen_net   NUMERIC,
        kwh_ontladen      NUMERIC,
        kwh_van_net       NUMERIC,
        kwh_teruggeleverd NUMERIC,
        bijgewerkt        TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Verwijder niet-representatieve opstartdagen
    const verwijder = searchParams.get('verwijder');
    if (verwijder) {
      const datums = verwijder.split(',').map(d => d.trim());
      for (const datum of datums) {
        await sql`DELETE FROM energie_data WHERE datum = ${datum}::date`;
      }
      return Response.json({ success: true, bericht: `Verwijderd: ${datums.join(', ')}` });
    }

    await sql`
      CREATE TABLE IF NOT EXISTS tennet_dag_cache (
        datum             DATE PRIMARY KEY,
        grafiek_json      TEXT NOT NULL,
        samenvatting_json TEXT NOT NULL,
        bijgewerkt        TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    await sql`ALTER TABLE energie_data ADD COLUMN IF NOT EXISTS bat_meerwaarde NUMERIC`;

    await sql`
      CREATE TABLE IF NOT EXISTS ess_commando (
        id         SERIAL PRIMARY KEY,
        watt       INTEGER NOT NULL,
        reden      TEXT,
        bron       TEXT DEFAULT 'dashboard',
        aangemaakt TIMESTAMPTZ DEFAULT NOW(),
        uitgevoerd TIMESTAMPTZ
      )
    `;

    // Zorg dat er altijd een standaard AUTO commando in de tabel staat
    await sql`
      INSERT INTO ess_commando (watt, reden, bron)
      SELECT 50, 'Standaard ESS auto-modus', 'initialisatie'
      WHERE NOT EXISTS (SELECT 1 FROM ess_commando)
    `;

    return Response.json({
      success: true,
      bericht: 'Migraties klaar',
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
