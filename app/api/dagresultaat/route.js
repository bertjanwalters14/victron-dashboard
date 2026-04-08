import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

// GET — kWh geladen/ontladen per dag + financieel resultaat
// Berekening: bat_w (W) per minuut × 1/60 = Wh → delen door 1000 = kWh
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();

  try {
    // Sensordata: kWh geladen/ontladen per dag (bat_w per minuut)
    const sensorDagen = await sql`
      WITH met_interval AS (
        SELECT *,
          EXTRACT(EPOCH FROM (
            LEAD(tijdstip) OVER (PARTITION BY date_trunc('day', tijdstip AT TIME ZONE 'Europe/Amsterdam') ORDER BY tijdstip)
            - tijdstip
          )) AS interval_sec
        FROM onbalans_log
        WHERE bron = 'nodered'
          AND bat_w IS NOT NULL
          AND tijdstip > NOW() - INTERVAL '30 days'
      )
      SELECT
        date_trunc('day', tijdstip AT TIME ZONE 'Europe/Amsterdam') AS dag,
        ROUND(SUM(CASE WHEN bat_w   > 0 AND interval_sec IS NOT NULL THEN  bat_w   * interval_sec / 3600000.0 ELSE 0 END)::numeric, 2) AS kwh_geladen,
        ROUND(SUM(CASE WHEN bat_w   < 0 AND interval_sec IS NOT NULL THEN -bat_w   * interval_sec / 3600000.0 ELSE 0 END)::numeric, 2) AS kwh_ontladen,
        ROUND(SUM(CASE WHEN solar_w > 0 AND interval_sec IS NOT NULL THEN  solar_w * interval_sec / 3600000.0 ELSE 0 END)::numeric, 2) AS kwh_zon,
        ROUND(SUM(CASE WHEN grid_w  > 0 AND interval_sec IS NOT NULL THEN  grid_w  * interval_sec / 3600000.0 ELSE 0 END)::numeric, 2) AS kwh_van_net,
        ROUND(SUM(CASE WHEN grid_w  < 0 AND interval_sec IS NOT NULL THEN -grid_w  * interval_sec / 3600000.0 ELSE 0 END)::numeric, 2) AS kwh_teruggeleverd,
        COUNT(*) AS metingen
      FROM met_interval
      GROUP BY 1
      ORDER BY 1 DESC
    `;

    // Beslissingen: verdeling per dag
    const beslissingDagen = await sql`
      SELECT
        date_trunc('day', tijdstip AT TIME ZONE 'Europe/Amsterdam') AS dag,
        beslissing,
        COUNT(*)                                    AS aantal,
        ROUND(AVG(prijs_kwh)::numeric, 4)           AS gem_prijs,
        ROUND(MIN(prijs_kwh)::numeric, 4)           AS min_prijs,
        ROUND(MAX(prijs_kwh)::numeric, 4)           AS max_prijs
      FROM onbalans_log
      WHERE bron IS NULL
        AND beslissing IS NOT NULL
        AND tijdstip > NOW() - INTERVAL '30 days'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2
    `;

    // Combineer per dag
    const dagenMap = {};
    for (const r of sensorDagen) {
      const dag = r.dag.toISOString().split('T')[0];
      dagenMap[dag] = {
        dag,
        kwh_geladen:       parseFloat(r.kwh_geladen),
        kwh_ontladen:      parseFloat(r.kwh_ontladen),
        kwh_zon:           parseFloat(r.kwh_zon),
        kwh_van_net:       parseFloat(r.kwh_van_net),
        kwh_teruggeleverd: parseFloat(r.kwh_teruggeleverd),
        metingen:          parseInt(r.metingen),
        beslissingen:      {},
      };
    }

    for (const r of beslissingDagen) {
      const dag = r.dag.toISOString().split('T')[0];
      if (!dagenMap[dag]) continue;
      dagenMap[dag].beslissingen[r.beslissing] = {
        aantal:    parseInt(r.aantal),
        gem_prijs: parseFloat(r.gem_prijs),
        min_prijs: parseFloat(r.min_prijs),
        max_prijs: parseFloat(r.max_prijs),
      };
    }

    // Financiële schatting per dag:
    // - ontladen × gem_prijs ontladen = vermeden kosten (of opbrengst teruglevering)
    // - van_net laden × gem_prijs laden = inkoop kosten
    const dagen = Object.values(dagenMap).map(d => {
      const gemPrijsOntladen = d.beslissingen?.ontladen?.gem_prijs ?? null;
      const gemPrijsLaden    = d.beslissingen?.laden?.gem_prijs    ?? null;
      const waarde_ontladen  = gemPrijsOntladen != null ? +(d.kwh_ontladen * gemPrijsOntladen).toFixed(2) : null;
      const kosten_laden     = gemPrijsLaden    != null ? +(d.kwh_van_net  * gemPrijsLaden).toFixed(2)    : null;
      const netto_resultaat  = waarde_ontladen != null && kosten_laden != null
        ? +(waarde_ontladen - kosten_laden).toFixed(2)
        : null;
      return { ...d, waarde_ontladen, kosten_laden, netto_resultaat };
    });

    return Response.json({ success: true, dagen });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
