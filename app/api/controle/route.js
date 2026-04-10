export const dynamic = 'force-dynamic';

// /api/controle — kill switch voor automatische batterijbesturing
//
// GET  → geeft huidige status { controle_actief: true/false }
// POST { actief: true/false } → zet auto-besturing aan of uit
//
// Wanneer actief:
//   /api/onbalans schrijft elke aanroep het berekende setpunt naar ess_commando
//   Node-RED pollt /api/commando elke 30s en stuurt MQTT naar Cerbo GX
//
// Wanneer inactief:
//   Geen automatische setpunten — Cerbo GX blijft op laatste handmatige waarde

import { neon } from '@neondatabase/serverless';

function getDb() { return neon(process.env.DATABASE_URL); }

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const sql = getDb();
  const rows = await sql`SELECT waarde FROM instellingen WHERE sleutel = 'controle_actief'`.catch(() => []);
  const actief = rows[0]?.waarde === 'true';

  return Response.json({ success: true, controle_actief: actief });
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const actief = body.actief === true || body.actief === 'true';
  const sql = getDb();

  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES ('controle_actief', ${String(actief)}, NOW())
    ON CONFLICT (sleutel) DO UPDATE
      SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
  `;

  // Bij uitschakelen: stuur direct een neutraal setpunt (50W = ESS auto)
  // zodat Cerbo niet blijft zitten op het laatste actieve commando
  if (!actief) {
    await sql`
      INSERT INTO ess_commando (watt, reden, bron)
      VALUES (50, 'Auto-besturing uitgeschakeld — ESS auto', 'kill-switch')
    `.catch(() => {});
  }

  return Response.json({ success: true, controle_actief: actief });
}
