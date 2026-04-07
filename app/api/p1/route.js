// app/api/p1/route.js
import { neon } from '@neondatabase/serverless';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// GET — haal P1 data op per maand
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT datum, import_kwh, export_kwh
      FROM p1_data
      WHERE datum >= '2025-04-03'
      ORDER BY datum ASC
    `;
    return Response.json({ success: true, data: rows });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// POST — importeer CSV data
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { rows } = await request.json();
    const sql = getDb();
    let inserted = 0;

    for (const row of rows) {
      await sql`
        INSERT INTO p1_data (datum, import_kwh, export_kwh)
        VALUES (${row.datum}, ${row.import_kwh}, ${row.export_kwh})
        ON CONFLICT (datum) DO UPDATE SET
          import_kwh = EXCLUDED.import_kwh,
          export_kwh = EXCLUDED.export_kwh
      `;
      inserted++;
    }

    return Response.json({ success: true, inserted });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}