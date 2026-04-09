export const dynamic = 'force-dynamic';

import { neon } from '@neondatabase/serverless';

function getDb() {
  return neon(process.env.DATABASE_URL);
}

// POST /api/stuur?secret=...
// Body: { watt: number, reden?: string, bron?: string }
// Schrijft een nieuw setpunt-commando naar de DB.
// Node-RED pollt /api/commando en past het toe op de Cerbo GX.
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const watt = parseInt(body.watt ?? 0);
  if (isNaN(watt) || watt < -32000 || watt > 32000) {
    return Response.json({ error: 'Ongeldig watt getal (−32000…32000)' }, { status: 400 });
  }

  const reden = body.reden ?? null;
  const bron  = body.bron  ?? 'dashboard';

  const sql = getDb();
  const rows = await sql`
    INSERT INTO ess_commando (watt, reden, bron)
    VALUES (${watt}, ${reden}, ${bron})
    RETURNING id, watt, reden, bron, aangemaakt
  `;

  return Response.json({ success: true, commando: rows[0] });
}

// GET /api/stuur?secret=...
// Geeft het huidige (laatste) commando terug — voor het dashboard.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  const rows = await sql`
    SELECT id, watt, reden, bron, aangemaakt, uitgevoerd
    FROM ess_commando
    ORDER BY aangemaakt DESC
    LIMIT 1
  `;

  return Response.json({ success: true, commando: rows[0] ?? null });
}
