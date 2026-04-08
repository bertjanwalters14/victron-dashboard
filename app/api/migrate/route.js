import { neon } from '@neondatabase/serverless';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS solar_w   NUMERIC`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS grid_w    NUMERIC`;
    await sql`ALTER TABLE onbalans_log ADD COLUMN IF NOT EXISTS verbruik_w NUMERIC`;

    return Response.json({
      success: true,
      bericht: 'Kolommen solar_w, grid_w en verbruik_w toegevoegd aan onbalans_log',
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
