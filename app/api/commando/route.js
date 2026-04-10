export const dynamic = 'force-dynamic';

// /api/commando?secret=...
//
// Dit endpoint is bedoeld voor Node-RED op de Cerbo GX.
// Node-RED pollt dit elke 30 seconden.
// Responsveld `watt` direct inzetbaar als MQTT payload waarde.
//
// Node-RED flow:
//   1. HTTP Request → GET /api/commando?secret={{env.CRON_SECRET}}
//   2. JSON parse → msg.payload.watt
//   3. Template node → {"value": {{payload.watt}}}
//   4. MQTT out → W/{portalId}/settings/0/Settings/CGwacs/AcPowerSetPoint
//
// Positief = importeren van net (batterij opladen)
// Negatief = exporteren naar net (batterij ontladen)
// 50       = Victron ESS standaard (auto, tiny import to prevent island mode)

import { neon } from '@neondatabase/serverless';

function getDb() {
  return neon(process.env.DATABASE_URL);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();

  // Haal het laatste commando op — fallback naar 50W als tabel nog niet bestaat
  let rows = [];
  try {
    rows = await sql`
      SELECT id, watt, reden, bron, aangemaakt, uitgevoerd
      FROM ess_commando
      ORDER BY aangemaakt DESC
      LIMIT 1
    `;
  } catch {
    // Tabel bestaat nog niet → stuur veilig standaard
    return Response.json({ commando: null, watt: 50 });
  }

  if (!rows.length) {
    return Response.json({ commando: null, watt: 50 });
  }

  const commando = rows[0];

  // Markeer als uitgevoerd de eerste keer dat Node-RED dit ophaalt
  if (!commando.uitgevoerd) {
    await sql`
      UPDATE ess_commando
      SET uitgevoerd = NOW()
      WHERE id = ${commando.id}
    `.catch(e => console.error('Ack mislukt:', e.message));
    commando.uitgevoerd = new Date().toISOString();
  }

  return Response.json({
    commando,
    watt: commando.watt,   // shorthand voor Node-RED template: {{payload.watt}}
  });
}
