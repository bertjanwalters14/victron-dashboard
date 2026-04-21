export const dynamic = 'force-dynamic';

// Direct Solcast API endpoint — haalt verse forecast + estimated_actuals op.
// ?force=true verwijdert de cache en forceert een nieuwe API-call.
// Cache: 4 uur (240 min) — Solcast Free tier: 10 calls/dag.

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force       = searchParams.get('force') === 'true';
  const resourceId  = process.env.SOLCAST_RESOURCE_ID;
  const apiKey      = process.env.SOLCAST_API_KEY;

  if (!resourceId || !apiKey) {
    return Response.json({ error: 'SOLCAST_RESOURCE_ID of SOLCAST_API_KEY ontbreekt in env' }, { status: 500 });
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const nu  = new Date();

  // ── Cache check (tenzij ?force=true) ────────────────────────────────────
  if (!force) {
    try {
      const rij = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'solcast_cache'`;
      if (rij[0]) {
        const ouderdomMin = (nu - new Date(rij[0].bijgewerkt)) / 60000;
        if (ouderdomMin < 240) {
          return Response.json({
            success:    true,
            vanCache:   true,
            cacheOudMin: +ouderdomMin.toFixed(1),
            ...JSON.parse(rij[0].waarde),
          });
        }
      }
    } catch { /* geen cache */ }
  } else {
    // Verwijder cache zodat onbalans-route ook vers ophaalt
    await sql`DELETE FROM instellingen WHERE sleutel = 'solcast_cache'`.catch(() => {});
  }

  // ── Verse Solcast calls ──────────────────────────────────────────────────
  try {
    const [forecastRes, actualsRes] = await Promise.all([
      fetch(
        `https://api.solcast.com.au/rooftop_sites/${resourceId}/forecasts?format=json&hours=48`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      ),
      fetch(
        `https://api.solcast.com.au/rooftop_sites/${resourceId}/estimated_actuals?format=json&hours=24`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      ),
    ]);

    if (!forecastRes.ok) {
      return Response.json({ error: `Solcast forecast HTTP ${forecastRes.status}` }, { status: 502 });
    }

    const forecastData = await forecastRes.json();
    const actualsData  = actualsRes.ok ? await actualsRes.json() : { estimated_actuals: [] };

    const vandaag   = nu.toISOString().split('T')[0];
    const morgen    = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 1));
    const morgenStr = morgen.toISOString().split('T')[0];

    const periodes   = forecastData.forecasts        ?? [];
    const actuals    = actualsData.estimated_actuals  ?? [];

    // Aggregeer forecast
    let vandaagKwh          = 0;
    let morgenKwh           = 0;
    let vandaagResterendKwh = 0;
    const uurData = {};

    for (const p of periodes) {
      const eindUtc  = new Date(p.period_end);
      const beginUtc = new Date(eindUtc.getTime() - 30 * 60000);
      const kwh      = (p.pv_estimate ?? 0) * 0.5;
      const watt     = (p.pv_estimate ?? 0) * 1000;
      const dagStr   = beginUtc.toISOString().split('T')[0];

      if (dagStr === vandaag) {
        vandaagKwh += kwh;
        if (beginUtc >= nu) vandaagResterendKwh += kwh;
      }
      if (dagStr === morgenStr) morgenKwh += kwh;

      if ((dagStr === vandaag || dagStr === morgenStr) && beginUtc >= nu) {
        const lokaalBegin = new Date(beginUtc.getTime() + 2 * 3600000);
        const tijdLabel   = lokaalBegin.toISOString().slice(11, 16);
        const key         = (dagStr === vandaag ? 'vandaag' : 'morgen') + '_' + tijdLabel;
        if (!uurData[key]) uurData[key] = { tijd: tijdLabel, watt: 0, dag: dagStr === vandaag ? 'vandaag' : 'morgen' };
        uurData[key].watt = watt;
      }
    }

    // Estimated actuals (verleden vandaag)
    let vandaagGeproduceerdKwh = 0;
    for (const p of actuals) {
      const eindUtc  = new Date(p.period_end);
      const beginUtc = new Date(eindUtc.getTime() - 30 * 60000);
      if (beginUtc.toISOString().split('T')[0] !== vandaag) continue;
      const kwh  = (p.pv_estimate ?? 0) * 0.5;
      const watt = (p.pv_estimate ?? 0) * 1000;
      vandaagGeproduceerdKwh += kwh;
      if (beginUtc < nu) {
        const lokaalBegin = new Date(beginUtc.getTime() + 2 * 3600000);
        const tijdLabel   = lokaalBegin.toISOString().slice(11, 16);
        const key         = 'vandaag_' + tijdLabel;
        if (!uurData[key]) uurData[key] = { tijd: tijdLabel, watt: 0, dag: 'vandaag' };
        uurData[key].watt = watt;
      }
    }

    const grafiekData = Object.values(uurData).sort((a, b) => {
      const ord = d => (d === 'vandaag' ? 0 : 1);
      if (ord(a.dag) !== ord(b.dag)) return ord(a.dag) - ord(b.dag);
      return a.tijd.localeCompare(b.tijd);
    });

    const resultaat = {
      vandaagKwh:          +(vandaagGeproduceerdKwh + vandaagKwh).toFixed(2),
      vandaagGeproduceerdKwh: vandaagGeproduceerdKwh > 0 ? +vandaagGeproduceerdKwh.toFixed(2) : null,
      vandaagResterendKwh: +vandaagResterendKwh.toFixed(2),
      morgenKwh:           +morgenKwh.toFixed(2),
      grafiekData,
      bijgewerkt:          nu.toISOString(),
    };

    // Cache opslaan
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('solcast_cache', ${JSON.stringify(resultaat)}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
    `.catch(() => {});

    return Response.json({ success: true, vanCache: false, ...resultaat });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
