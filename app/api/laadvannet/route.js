import { neon } from '@neondatabase/serverless';
import { revalidateTag } from 'next/cache';
import { parseSchedule, effectiveState } from '@/lib/schedule';
import { leesKnoppenRuw, KNOPPEN_TAG } from '@/lib/knoppen';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// GET — huidige (effectieve, schema-bewuste) stand van de drie knoppen, gelezen door
// dashboard én Node-RED. Node-RED hoeft niets van schema's te weten: dat wordt hier al
// verwerkt tot een simpele aan/uit-waarde. Geen secret: read-only, lage gevoeligheid.
export async function GET() {
  try {
    // v. 14-10: uit de cache (tag 'knoppen'), niet elke minuut uit Neon -- zie lib/knoppen.js
    const m = await leesKnoppenRuw();
    const laadVanNetSchedule = parseSchedule(m['laad_van_net_schedule']);
    const keepChargedSchedule = parseSchedule(m['keep_charged_schedule']);
    const verkoopPauzeSchedule = parseSchedule(m['verkoop_pauze_schedule']);
    const reserveSocRaw = Number(m['reserve_soc']);
    const reserveSoc = (reserveSocRaw >= 10 && reserveSocRaw <= 40) ? reserveSocRaw : 25;
    return Response.json({
      success: true,
      laadVanNet: effectiveState(m['laad_van_net'] === 'true', laadVanNetSchedule),
      keepCharged: effectiveState(m['keep_charged'] === 'true', keepChargedSchedule),
      verkoopPauze: effectiveState(m['verkoop_pauze'] === 'true', verkoopPauzeSchedule),
      laadVanNetHandmatig: m['laad_van_net'] === 'true',
      keepChargedHandmatig: m['keep_charged'] === 'true',
      verkoopPauzeHandmatig: m['verkoop_pauze'] === 'true',
      laadVanNetSchedule, keepChargedSchedule, verkoopPauzeSchedule,
      reserveSoc,
      pushToken: Number(m['push_nu']) || 0,   // wijzigt zodra iemand in de app "Ververs nu" indrukt -> Node-RED pusht dan meteen de status
    });
  } catch {
    const off = { enabled: false, start: '12:00', end: '18:00' };
    return Response.json({
      success: true, laadVanNet: false, keepCharged: false, verkoopPauze: false,
      laadVanNetHandmatig: false, keepChargedHandmatig: false, verkoopPauzeHandmatig: false,
      laadVanNetSchedule: off, keepChargedSchedule: off, verkoopPauzeSchedule: off,
      reserveSoc: 25, pushToken: 0,
    });
  }
}

// POST — zet de stand (secret vereist; backup naast de UI-knop / server action).
// Body: { aan: true | false }
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const aan = body.aan === true || body.aan === 'true';
    const sql = getDb();
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('laad_van_net', ${aan ? 'true' : 'false'}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET
        waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
    `;
    revalidateTag(KNOPPEN_TAG, 'max');   // in een route handler kan updateTag niet; de volgende poll (of de daaropvolgende) ziet de nieuwe stand
    return Response.json({ success: true, laadVanNet: aan });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
