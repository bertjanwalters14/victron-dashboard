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
  // Neon returns DATE/TIMESTAMP columns as JS Date objects.
  // Normalize datum to a plain 'YYYY-MM-DD' string so client components can
  // safely call .slice(), .startsWith(), etc.
  // The timestamps are stored at midnight local time (CEST = UTC+2), so we
  // add 2 h to push past the UTC midnight boundary before slicing.
  return rows.map(r => {
    let datum = r.datum;
    if (datum instanceof Date) {
      datum = new Date(datum.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
    } else if (datum) {
      datum = String(datum).slice(0, 10);
    }
    return { ...r, datum };
  });
}

export async function upsertEnergieData({
  datum, solar_yield_kwh, verbruik_kwh,
  net_import_kwh, net_export_kwh, winst_euro, bat_meerwaarde
}) {
  const sql = getDb();
  await sql`
    INSERT INTO energie_data
      (datum, solar_yield_kwh, verbruik_kwh, net_import_kwh, net_export_kwh, winst_euro, bat_meerwaarde)
    VALUES
      (${datum}, ${solar_yield_kwh}, ${verbruik_kwh}, ${net_import_kwh}, ${net_export_kwh}, ${winst_euro}, ${bat_meerwaarde ?? null})
    ON CONFLICT (datum) DO UPDATE SET
      solar_yield_kwh = EXCLUDED.solar_yield_kwh,
      verbruik_kwh    = EXCLUDED.verbruik_kwh,
      net_import_kwh  = EXCLUDED.net_import_kwh,
      net_export_kwh  = EXCLUDED.net_export_kwh,
      winst_euro      = EXCLUDED.winst_euro,
      bat_meerwaarde  = EXCLUDED.bat_meerwaarde
  `;
}