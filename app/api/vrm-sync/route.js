import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const VRM_BASE   = 'https://vrmapi.victronenergy.com/v2';
const SITE_ID    = process.env.VICTRON_SITE_ID;
const VRM_TOKEN  = process.env.VICTRON_API_TOKEN;

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

function vrmHeaders() {
  return { 'X-Authorization': `Token ${VRM_TOKEN}` };
}

// Haal dagelijkse kWh stats op uit VRM voor de afgelopen N dagen
async function haalVrmDagStats(aantalDagen = 7) {
  const res = await fetch(
    `${VRM_BASE}/installations/${SITE_ID}/stats?type=kwh&interval=days&count=${aantalDagen}`,
    { headers: vrmHeaders() }
  );
  if (!res.ok) throw new Error(`VRM stats fout: ${res.status}`);
  const json = await res.json();
  return json.records ?? {};
}

// Verwerk VRM records naar per-dag objecten
function verwerkVrmStats(records) {
  // Elke key bevat array van [timestamp_ms, waarde_kwh]
  const dagenMap = {};

  const voegToe = (key, tijdstip, waarde) => {
    if (waarde == null) return;
    const dag = new Date(tijdstip).toISOString().split('T')[0];
    if (!dagenMap[dag]) dagenMap[dag] = {};
    dagenMap[dag][key] = parseFloat(waarde) || 0;
  };

  for (const [key, punten] of Object.entries(records)) {
    if (!Array.isArray(punten)) continue;
    for (const [ts, val] of punten) {
      voegToe(key, ts, val);
    }
  }

  // Bereken afgeleide waarden per dag
  const dagen = [];
  for (const [dag, r] of Object.entries(dagenMap)) {
    const Pb = r.Pb ?? 0; // Solar → Batterij
    const Pg = r.Pg ?? 0; // Solar → Net (teruglevering)
    const Pc = r.Pc ?? 0; // Solar → Directe consumptie
    const Bc = r.Bc ?? 0; // Batterij → Consumptie
    const Bg = r.Bg ?? 0; // Batterij → Net
    const Gc = r.Gc ?? 0; // Net → Consumptie
    const Gb = r.Gb ?? 0; // Net → Batterij

    dagen.push({
      dag,
      kwh_zon:           +(Pb + Pg + Pc).toFixed(2),  // Totale opwek
      kwh_geladen:       +(Pb + Gb).toFixed(2),         // Batterij geladen (zon + net)
      kwh_geladen_zon:   +Pb.toFixed(2),                // Batterij geladen via zon
      kwh_geladen_net:   +Gb.toFixed(2),                // Batterij geladen via net
      kwh_ontladen:      +(Bc + Bg).toFixed(2),         // Batterij ontladen totaal
      kwh_van_net:       +(Gc + Gb).toFixed(2),         // Totaal van net gekocht
      kwh_teruggeleverd: +(Pg + Bg).toFixed(2),         // Totaal teruggeleverd
    });
  }

  return dagen.sort((a, b) => b.dag.localeCompare(a.dag));
}

// GET — haal VRM dagstats op en sla op in DB
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!SITE_ID || !VRM_TOKEN) {
    return Response.json({ error: 'VICTRON_SITE_ID of VICTRON_API_TOKEN niet ingesteld' }, { status: 500 });
  }

  try {
    const sql    = getDb();
    const records = await haalVrmDagStats(30);
    const dagen   = verwerkVrmStats(records);

    if (!dagen.length) {
      return Response.json({ success: true, bericht: 'Geen VRM data beschikbaar', dagen: [] });
    }

    // Sla op in vrm_dag_stats tabel
    for (const d of dagen) {
      await sql`
        INSERT INTO vrm_dag_stats (
          dag, kwh_zon, kwh_geladen, kwh_geladen_zon, kwh_geladen_net,
          kwh_ontladen, kwh_van_net, kwh_teruggeleverd, bijgewerkt
        ) VALUES (
          ${d.dag}, ${d.kwh_zon}, ${d.kwh_geladen}, ${d.kwh_geladen_zon}, ${d.kwh_geladen_net},
          ${d.kwh_ontladen}, ${d.kwh_van_net}, ${d.kwh_teruggeleverd}, NOW()
        )
        ON CONFLICT (dag) DO UPDATE SET
          kwh_zon           = EXCLUDED.kwh_zon,
          kwh_geladen       = EXCLUDED.kwh_geladen,
          kwh_geladen_zon   = EXCLUDED.kwh_geladen_zon,
          kwh_geladen_net   = EXCLUDED.kwh_geladen_net,
          kwh_ontladen      = EXCLUDED.kwh_ontladen,
          kwh_van_net       = EXCLUDED.kwh_van_net,
          kwh_teruggeleverd = EXCLUDED.kwh_teruggeleverd,
          bijgewerkt        = NOW()
      `;
    }

    return Response.json({ success: true, bericht: `${dagen.length} dagen opgeslagen`, dagen });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
