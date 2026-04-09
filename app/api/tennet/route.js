export const dynamic = 'force-dynamic';

import { neon } from '@neondatabase/serverless';

const TENNET_BASE = 'https://api.tennet.eu/publications/v1';
const BATTERIJ_KW = 5;    // kW laad/ontlaad vermogen voor simulatie
const PTU_UREN    = 0.25; // 15 minuten = 0.25 uur

function getDb() {
  return neon(process.env.DATABASE_URL);
}

function fmt(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dd}-${mm}-${yy} ${hh}:${mi}:${ss}`;
}

// ── Live: balance-delta-high-res/latest — laatste 30 min, elke 12s bijgewerkt ──
async function haalLiveData(apiKey) {
  const url = `${TENNET_BASE}/balance-delta-high-res/latest`;
  const res = await fetch(url, { headers: { apikey: apiKey, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TenneT live fout: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`TenneT live: ${json.error}`);

  // Structuur: Response.TimeSeries[0].Period[0].points (Period is array, points lowercase)
  const rawPunten = json?.Response?.TimeSeries?.[0]?.Period?.[0]?.points ?? [];

  return rawPunten.map(p => {
    const midPrijs  = parseFloat(p.mid_price                  ?? 0);
    const maxUp     = p.max_upw_regulation_price  != null ? parseFloat(p.max_upw_regulation_price)  : null;
    const minDown   = p.min_downw_regulation_price != null ? parseFloat(p.min_downw_regulation_price) : null;
    const afrrOut   = parseFloat(p.power_afrr_out  ?? 0);
    const afrrIn    = parseFloat(p.power_afrr_in   ?? 0);

    // Staat afleiden: afrr_out > afrr_in → DOWN (surplus), afrr_in > afrr_out → UP (tekort)
    const state = afrrOut > afrrIn ? -1 : afrrIn > afrrOut ? 1 : 0;

    return {
      t:        p.timeInterval_start?.slice(11, 19) ?? '',
      state,
      midPrijs: +midPrijs.toFixed(2),
      maxUp:    maxUp  != null ? +maxUp.toFixed(2)  : null,
      minDown:  minDown != null ? +minDown.toFixed(2) : null,
      afrrOut:  +afrrOut.toFixed(1),
      afrrIn:   +afrrIn.toFixed(1),
    };
  });
}

// ── Historisch: settlement-prices per dag — met DB cache (max 8 req/dag) ──
async function haalSettlementData(apiKey, datumStr) {
  const sql = getDb();

  // Probeer eerst uit DB cache
  const cached = await sql`
    SELECT grafiek_json, samenvatting_json
    FROM tennet_dag_cache
    WHERE datum = ${datumStr}::date
    LIMIT 1
  `.catch(() => []);

  if (cached.length) {
    return {
      vanCache: true,
      grafiek:     JSON.parse(cached[0].grafiek_json),
      samenvatting: JSON.parse(cached[0].samenvatting_json),
    };
  }

  // Niet in cache → ophalen bij TenneT
  const van = new Date(datumStr + 'T00:00:00Z');
  const tot = new Date(datumStr + 'T23:59:59Z');
  const url = `${TENNET_BASE}/settlement-prices?date_from=${encodeURIComponent(fmt(van))}&date_to=${encodeURIComponent(fmt(tot))}`;
  const res = await fetch(url, { headers: { apikey: apiKey, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TenneT settlement fout: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`TenneT settlement: ${json.error}`);
  const punten = json?.Response?.TimeSeries?.[0]?.Period?.Points || [];

  const result = verwerkSettlement(punten);

  // Sla op in DB cache
  if (result.grafiek.length) {
    await sql`
      INSERT INTO tennet_dag_cache (datum, grafiek_json, samenvatting_json, bijgewerkt)
      VALUES (${datumStr}::date, ${JSON.stringify(result.grafiek)}, ${JSON.stringify(result.samenvatting)}, NOW())
      ON CONFLICT (datum) DO UPDATE
        SET grafiek_json     = EXCLUDED.grafiek_json,
            samenvatting_json = EXCLUDED.samenvatting_json,
            bijgewerkt        = NOW()
    `.catch(e => console.error('Cache opslaan mislukt:', e.message));
  }

  return { vanCache: false, ...result };
}

function verwerkSettlement(punten) {
  const kwhPerPtu = BATTERIJ_KW * PTU_UREN;
  let simWinstUp = 0, simWinstDown = 0;
  let aantalUp = 0, aantalDown = 0, aantalNeutr = 0;
  let maxUp = 0, maxDown = 0;

  const grafiek = punten.map(p => {
    const state          = parseInt(p.regulation_state ?? 0);
    const shortageEurMwh = parseFloat(p.shortage  ?? 0);
    const surplusEurMwh  = parseFloat(p.surplus   ?? 0);

    if (state === 1 || state === 2) {
      simWinstUp += kwhPerPtu * shortageEurMwh / 1000;
      aantalUp++;
      if (shortageEurMwh > maxUp) maxUp = shortageEurMwh;
    }
    if (state === -1 || state === 2) {
      simWinstDown += kwhPerPtu * surplusEurMwh / 1000;
      aantalDown++;
      if (surplusEurMwh > maxDown) maxDown = surplusEurMwh;
    }
    if (state === 0) aantalNeutr++;

    return {
      t:             p.timeInterval_start?.slice(11, 16) ?? '',
      state,
      regeling:      p.regulating_condition ?? 'NEUTRAL',
      shortageEurMwh: +shortageEurMwh.toFixed(2),
      surplusEurMwh:  +surplusEurMwh.toFixed(2),
    };
  });

  return {
    grafiek,
    samenvatting: {
      aantalPtu: punten.length,
      aantalUp, aantalDown, aantalNeutr,
      maxUpEurMwh:   +maxUp.toFixed(2),
      maxDownEurMwh: +maxDown.toFixed(2),
      simWinstUp:    +simWinstUp.toFixed(2),
      simWinstDown:  +simWinstDown.toFixed(2),
      simTotaal:     +(simWinstUp + simWinstDown).toFixed(2),
      kwhPerPtu,
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.TENNET_API_KEY;
  if (!apiKey) return Response.json({ error: 'TENNET_API_KEY niet ingesteld' }, { status: 500 });

  // ?live=true → real-time balance delta (laatste 30 min, elke 12s bijgewerkt)
  if (searchParams.get('live') === 'true') {
    try {
      const punten = await haalLiveData(apiKey);
      if (!punten.length) {
        return Response.json({ success: false, bericht: 'Geen live data' });
      }
      const laatste = punten[punten.length - 1];
      // Trend: neem elke 5e punt (~1 min interval) voor de mini-grafiek
      const trend = punten.filter((_, i) => i % 5 === 0);
      return Response.json({
        success:    true,
        type:       'live',
        laatste,
        trend,
        bijgewerkt: new Date().toISOString(),
      });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  // Standaard: historische settlement data voor een dag
  let datumStr = searchParams.get('datum');
  if (!datumStr) {
    const gisteren = new Date();
    gisteren.setUTCDate(gisteren.getUTCDate() - 1);
    datumStr = gisteren.toISOString().split('T')[0];
  }

  try {
    let result = await haalSettlementData(apiKey, datumStr);

    // Vandaag nog leeg? Automatisch gisteren proberen
    if (!result.grafiek?.length) {
      const gisteren = new Date();
      gisteren.setUTCDate(gisteren.getUTCDate() - 1);
      datumStr = gisteren.toISOString().split('T')[0];
      result = await haalSettlementData(apiKey, datumStr);
    }

    if (!result.grafiek?.length) {
      return Response.json({ success: false, bericht: 'Geen TenneT settlement data beschikbaar', datum: datumStr });
    }

    const laatste = result.grafiek[result.grafiek.length - 1] ?? null;

    return Response.json({
      success:   true,
      type:      'settlement',
      vanCache:  result.vanCache,
      datum:     datumStr,
      laatste,
      samenvatting: result.samenvatting,
      grafiek:      result.grafiek,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
