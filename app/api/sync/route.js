import { upsertEnergieData } from '@/lib/db';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// ANWB Energie consumentenprijs — exact zoals geconfigureerd in Victron DESS
// Leveringsformule én teruglevering: (p + 0.03 + 0.13) * 1.21
// TODO: bij overstap naar Frank Energie → frankNaarConsumer() gebruiken
function anwbPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

async function haalSpotPrijzen(datumStr) {
  // Nederlandse dag loopt van 00:00 CEST = 22:00 UTC daarvoor t/m 23:59 CEST = 21:59 UTC
  // We halen daarom prijzen op voor het UTC-venster dat de volledige Nederlandse dag dekt
  const isDST  = isDaylightSaving(new Date(datumStr + 'T12:00:00Z'));
  const offset = isDST ? 2 : 1; // uren verschil NL t.o.v. UTC

  const vanUtc  = new Date(datumStr + 'T00:00:00Z');
  vanUtc.setUTCHours(vanUtc.getUTCHours() - offset); // bijv. 22:00 UTC daarvoor
  const totUtc  = new Date(datumStr + 'T23:59:59Z');
  totUtc.setUTCHours(totUtc.getUTCHours() - offset); // bijv. 21:59 UTC

  const vanStr = vanUtc.toISOString();
  const totStr = totUtc.toISOString();

  const res = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${vanStr}&tillDate=${totStr}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) throw new Error(`EnergyZero API fout: ${res.status}`);
  const json = await res.json();
  return json?.Prices || [];
}

async function syncEénDag(datumStr) {
  // Nederlandse dag-grenzen (CEST = UTC+2, CET = UTC+1)
  // Door +02:00 mee te geven pakt JavaScript de juiste UTC-offset
  const isDST = isDaylightSaving(new Date(datumStr + 'T12:00:00'));
  const offset = isDST ? '+02:00' : '+01:00';
  const start  = Math.floor(new Date(datumStr + 'T00:00:00' + offset).getTime() / 1000);
  const end    = Math.floor(new Date(datumStr + 'T23:59:59' + offset).getTime() / 1000);

  // VRM uurdata
  const victronRes = await fetch(
    `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
    { headers: { 'x-authorization': `Token ${TOKEN}` } }
  );
  if (!victronRes.ok) throw new Error(`VRM API fout: ${victronRes.status}`);
  const victronData = await victronRes.json();
  const records = victronData?.records || {};

  // EPEX spotprijzen via EnergyZero
  const spotPrijzen = await haalSpotPrijzen(datumStr);

  // Map: uur-timestamp (ms) → all-in ANWB prijs
  const prijsPerUur = {};
  for (const p of spotPrijzen) {
    const d = new Date(p.readingDate);
    d.setMinutes(0, 0, 0);
    prijsPerUur[d.getTime()] = anwbPrijs(parseFloat(p.price));
  }

  function vindPrijs(tsMs) {
    const d = new Date(tsMs);
    d.setMinutes(0, 0, 0);
    return prijsPerUur[d.getTime()] ?? 0.28;
  }

  function berekenSom(veld) {
    return (records[veld] || []).reduce((som, [ts, kwh]) => som + kwh * vindPrijs(ts), 0);
  }

  function totaalKwh(veld) {
    return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
  }

  const winstBg  = berekenSom('Bg');
  const winstBc  = berekenSom('Bc');
  const winstPc  = berekenSom('Pc');
  const winstPb  = berekenSom('Pb');
  const winstPg  = berekenSom('Pg');
  const kostenGc = berekenSom('Gc');
  const kostenGb = berekenSom('Gb');

  const GbKwh = totaalKwh('Gb');
  const BgKwh = totaalKwh('Bg');
  const BcKwh = totaalKwh('Bc');
  const PcKwh = totaalKwh('Pc');
  const PgKwh = totaalKwh('Pg');
  const PbKwh = totaalKwh('Pb');
  const GcKwh = totaalKwh('Gc');

  const accuKosten  = (GbKwh + BgKwh + BcKwh) * 0.01;
  const totaalWinst = winstBg + winstBc - kostenGb - accuKosten;

  // Counterfactual: wat zou het resultaat zijn zonder batterij?
  // - Pb gaat naar net (Pg) i.p.v. naar batterij — zelfde uur, zelfde prijs
  // - Bc moet van net komen (Gc) i.p.v. van batterij — zelfde uur, zelfde prijs
  // - Geen Gb (geen laden van net) en geen Bg (geen export van batterij)
  const winstZonderBat = winstPg + winstPb + winstPc - kostenGc - winstBc;
  const batMeerwaarde  = totaalWinst - winstZonderBat;

  await upsertEnergieData({
    datum:           datumStr,
    solar_yield_kwh: PgKwh + PcKwh + PbKwh,
    verbruik_kwh:    BcKwh + PcKwh + GcKwh,
    net_import_kwh:  GbKwh + GcKwh,
    net_export_kwh:  BgKwh + PgKwh,
    winst_euro:      totaalWinst,
    bat_meerwaarde:  batMeerwaarde,
  });

  return {
    datum:      datumStr,
    kwh: {
      Bg: BgKwh.toFixed(2), Bc: BcKwh.toFixed(2), Pc: PcKwh.toFixed(2),
      Pg: PgKwh.toFixed(2), Pb: PbKwh.toFixed(2), Gc: GcKwh.toFixed(2), Gb: GbKwh.toFixed(2),
      totaalZon:      (PgKwh + PcKwh + PbKwh).toFixed(2),
      totaalOntladen: (BgKwh + BcKwh).toFixed(2),
    },
    winstBg:       winstBg.toFixed(2),
    winstBc:       winstBc.toFixed(2),
    winstPc:       winstPc.toFixed(2),
    kostenGc:      kostenGc.toFixed(2),
    kostenGb:      kostenGb.toFixed(2),
    accuKosten:    accuKosten.toFixed(2),
    winst:         totaalWinst.toFixed(2),
    winstZonderBat: winstZonderBat.toFixed(2),
    batMeerwaarde: batMeerwaarde.toFixed(2),
  };
}

// Simpele DST-check voor Nederland (laatste zondag maart t/m laatste zondag oktober)
function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Backfill: ?backfill=true → hersynct alle datums die al in energie_data staan
    if (searchParams.get('backfill') === 'true') {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      const bestaand = await sql`SELECT datum::text FROM energie_data ORDER BY datum ASC`;
      const resultaten = [];
      for (const { datum } of bestaand) {
        const dagStr = datum.split('T')[0];
        try {
          const res = await syncEénDag(dagStr);
          resultaten.push({ ...res, status: 'ok' });
        } catch (e) {
          resultaten.push({ datum: dagStr, status: 'fout', fout: e.message });
        }
      }
      return Response.json({ success: true, prijsBron: 'anwb', backfill: true, dagen: resultaten });
    }

    // Bulk-hersync: ?vanaf=2026-04-03  → synct alle dagen t/m gisteren
    const vanafParam = searchParams.get('vanaf');
    if (vanafParam) {
      const gisteren = new Date();
      gisteren.setDate(gisteren.getDate() - 1);
      const einddatum = gisteren.toISOString().split('T')[0];

      const resultaten = [];
      let huidige = new Date(vanafParam + 'T12:00:00Z');
      const einde  = new Date(einddatum  + 'T12:00:00Z');

      while (huidige <= einde) {
        const dagStr = huidige.toISOString().split('T')[0];
        try {
          const res = await syncEénDag(dagStr);
          resultaten.push({ ...res, status: 'ok' });
        } catch (e) {
          resultaten.push({ datum: dagStr, status: 'fout', fout: e.message });
        }
        huidige.setUTCDate(huidige.getUTCDate() + 1);
      }

      return Response.json({ success: true, prijsBron: 'anwb', dagen: resultaten });
    }

    // Enkel dag: ?datum=2026-04-08  of standaard gisteren
    const datumParam = searchParams.get('datum');
    let datumStr;
    if (datumParam) {
      datumStr = datumParam;
    } else {
      const gisteren = new Date();
      gisteren.setDate(gisteren.getDate() - 1);
      datumStr = gisteren.toISOString().split('T')[0];
    }

    const resultaat = await syncEénDag(datumStr);
    return Response.json({ success: true, prijsBron: 'anwb', ...resultaat });

  } catch (err) {
    console.error('Sync fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
