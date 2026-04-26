export const dynamic = 'force-dynamic';

// Eenmalig setup-endpoint: maakt alle benodigde tabellen aan als ze nog niet bestaan.
// Veilig om meerdere keren aan te roepen (IF NOT EXISTS overal).

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const resultaten = [];

  async function stap(naam, query) {
    try {
      await query();
      resultaten.push({ stap: naam, status: 'ok' });
    } catch (e) {
      resultaten.push({ stap: naam, status: 'fout', fout: e.message });
    }
  }

  await stap('energie_data aanmaken', () => sql`
    CREATE TABLE IF NOT EXISTS energie_data (
      datum            DATE PRIMARY KEY,
      solar_yield_kwh  NUMERIC,
      verbruik_kwh     NUMERIC,
      net_import_kwh   NUMERIC,
      net_export_kwh   NUMERIC,
      winst_euro       NUMERIC,
      bat_meerwaarde   NUMERIC,
      bijgewerkt       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await stap('energie_data bat_meerwaarde kolom', () => sql`
    ALTER TABLE energie_data ADD COLUMN IF NOT EXISTS bat_meerwaarde NUMERIC
  `);

  await stap('instellingen aanmaken', () => sql`
    CREATE TABLE IF NOT EXISTS instellingen (
      sleutel    TEXT PRIMARY KEY,
      waarde     TEXT NOT NULL,
      bijgewerkt TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await stap('ess_commando aanmaken', () => sql`
    CREATE TABLE IF NOT EXISTS ess_commando (
      id         SERIAL PRIMARY KEY,
      watt       INTEGER NOT NULL,
      reden      TEXT,
      bron       TEXT DEFAULT 'dashboard',
      aangemaakt TIMESTAMPTZ DEFAULT NOW(),
      uitgevoerd TIMESTAMPTZ
    )
  `);

  await stap('ess_commando standaard rij', () => sql`
    INSERT INTO ess_commando (watt, reden, bron)
    SELECT 50, 'Standaard ESS auto-modus', 'initialisatie'
    WHERE NOT EXISTS (SELECT 1 FROM ess_commando)
  `);

  const allesOk = resultaten.every(r => r.status === 'ok');
  return Response.json({ success: allesOk, resultaten });
}
