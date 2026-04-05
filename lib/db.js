import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

export async function getEnergieData() {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM energie_data
    ORDER BY datum ASC
  `;
  return rows;
}

export async function upsertEnergieData({
  datum, solar_yield_kwh, verbruik_kwh,
  net_import_kwh, net_export_kwh, winst_euro
}) {
  const sql = getDb();
  await sql`
    INSERT INTO energie_data
      (datum, solar_yield_kwh, verbruik_kwh, net_import_kwh, net_export_kwh, winst_euro)
    VALUES
      (${datum}, ${solar_yield_kwh}, ${verbruik_kwh}, ${net_import_kwh}, ${net_export_kwh}, ${winst_euro})
    ON CONFLICT (datum) DO UPDATE SET
      solar_yield_kwh = EXCLUDED.solar_yield_kwh,
      verbruik_kwh    = EXCLUDED.verbruik_kwh,
      net_import_kwh  = EXCLUDED.net_import_kwh,
      net_export_kwh  = EXCLUDED.net_export_kwh,
      winst_euro      = EXCLUDED.winst_euro
  `;
}