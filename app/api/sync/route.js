import { upsertEnergieData } from '@/lib/db';
import { magApi } from '@/lib/auth';
import { nlDagVensterSec } from '@/lib/tijd';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Consumentenprijs, gelijk aan de opbouw die ess_logic.js (Node-RED) gebruikt voor de sturing.
// Leveringsformule (inkoop, en teruglevering ZOLANG saldering geldt): (p + 0.0197 + 0.0916) * 1.21
// Naam is niet willekeurig: ANWB Energie is de daadwerkelijke leverancier.
function anwbPrijs(spot) {
  return (spot + 0.0197 + 0.0916) * 1.21;
}

// Saldering stopt per 1 januari 2027 (definitief, Eerste Kamer) -- zelfde aanpak als ess_logic.js's
// v42/v43: tot die datum blijft teruglevering gewoon tegen de all-in prijs (saldering, ongewijzigd),
// erna geldt de wettelijke bodem (minimaal 50% van kale marktprijs + opslag, EXCL. energiebelasting/
// BTW, wet geldig tot 1 jan 2030). SELL_ADJ is een placeholder voor de echte terugleververgoeding
// van de dan gekozen leverancier zodra die bekend is (nu 0, dus dit ís de wettelijke minimumschatting).
// Raakt winstBg/winstPg, en daarmee ook batMeerwaarde/totaalWinst/nettoKosten -- ongewijzigd voor elke
// datum vóór 2027, dus geen regressie op bestaande/historische dagen.
const SALDERING_EINDDATUM     = '2027-01-01';
const TERUGLEVER_BODEM_FRACTIE = 0.5;
const SELL_ADJ = 0;

function verkoopprijsKaal(spot) {
  return TERUGLEVER_BODEM_FRACTIE * (spot + 0.0197 + 0.0916) + SELL_ADJ;
}

async function haalSpotPrijzen(datumStr) {
  // Nederlandse dag loopt van 00:00 CEST = 22:00 UTC daarvoor t/m 23:59 CEST = 21:59 UTC
  // We halen daarom prijzen op voor het UTC-venster dat de volledige Nederlandse dag dekt.
  // Via lib/tijd.js: Vercel draait in UTC, dus Date#getTimezoneOffset() ziet nooit zomertijd (de dag
  // liep daardoor in de zomer een uur te laat); Intl met expliciete tijdzone doet het wel goed.
  const venster = nlDagVensterSec(datumStr);
  const vanStr = new Date(venster.start * 1000).toISOString();
  const totStr = new Date(venster.eind * 1000).toISOString();

  const res = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${vanStr}&tillDate=${totStr}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) throw new Error(`EnergyZero API fout: ${res.status}`);
  const json = await res.json();
  return json?.Prices || [];
}

async function syncEénDag(datumStr) {
  // Nederlandse dag-grenzen (CEST = UTC+2, CET = UTC+1), zie lib/tijd.js
  const { start, eind: end } = nlDagVensterSec(datumStr);

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

  // Map: uur-timestamp (ms) → all-in ANWB prijs, én de KALE marktprijs (geen opslag/belasting/BTW).
  // De kale prijs is nodig voor Pb's opportunity cost (zie batMeerwaarde hieronder): zon die de accu
  // in gaat is geen netstroom-transactie, dus geen retail-opslag van toepassing -- alleen wat die
  // kWh zelf op de markt waard was.
  const salderingActief = datumStr < SALDERING_EINDDATUM;

  const prijsPerUur = {};
  const kalePrijsPerUur = {};
  const verkoopPrijsPerUur = {};
  for (const p of spotPrijzen) {
    const d = new Date(p.readingDate);
    d.setMinutes(0, 0, 0);
    const spot = parseFloat(p.price);
    prijsPerUur[d.getTime()] = anwbPrijs(spot);
    kalePrijsPerUur[d.getTime()] = spot;
    verkoopPrijsPerUur[d.getTime()] = salderingActief ? anwbPrijs(spot) : verkoopprijsKaal(spot);
  }

  function vindPrijs(tsMs) {
    const d = new Date(tsMs);
    d.setMinutes(0, 0, 0);
    return prijsPerUur[d.getTime()] ?? 0.28;
  }
  function vindKalePrijs(tsMs) {
    const d = new Date(tsMs);
    d.setMinutes(0, 0, 0);
    return kalePrijsPerUur[d.getTime()] ?? 0;
  }
  // Prijs voor Bg/Pg (teruglevering): all-in zolang saldering geldt, anders de wettelijke bodem.
  function vindVerkoopPrijs(tsMs) {
    const d = new Date(tsMs);
    d.setMinutes(0, 0, 0);
    return verkoopPrijsPerUur[d.getTime()] ?? (salderingActief ? 0.28 : 0.05);
  }

  function berekenSom(veld) {
    return (records[veld] || []).reduce((som, [ts, kwh]) => som + kwh * vindPrijs(ts), 0);
  }
  function berekenSomKaal(veld) {
    return (records[veld] || []).reduce((som, [ts, kwh]) => som + kwh * vindKalePrijs(ts), 0);
  }
  function berekenSomVerkoop(veld) {
    return (records[veld] || []).reduce((som, [ts, kwh]) => som + kwh * vindVerkoopPrijs(ts), 0);
  }

  function totaalKwh(veld) {
    return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
  }

  const winstBg  = berekenSomVerkoop('Bg');
  const winstBc  = berekenSom('Bc');
  const winstPc  = berekenSom('Pc');
  const kostenGc = berekenSom('Gc');
  const kostenGb = berekenSom('Gb');

  const GbKwh = totaalKwh('Gb');
  const BgKwh = totaalKwh('Bg');
  const BcKwh = totaalKwh('Bc');
  const PcKwh = totaalKwh('Pc');
  const PgKwh = totaalKwh('Pg');
  const PbKwh = totaalKwh('Pb');
  const GcKwh = totaalKwh('Gc');

  // Slijtage: €9.000 accu / (8000 cycli x 32 kWh x 0,9025 rendement-gecorrigeerde doorvoer/cyclus) ≈ €0,0185/kWh
  const accuKosten  = (GbKwh + BgKwh + BcKwh) * 0.0185;
  const totaalWinst = winstBg + winstBc - kostenGb - accuKosten;

  // Meerwaarde t.o.v. geen accu: exportopbrengst (Bg) + vermeden inkoop (Bc) - laadkosten (Gb) - slijtage,
  // MINUS de gemiste exportwaarde van de zon die nu de accu in ging (Pb) i.p.v. het net op. Die Pb-term
  // is bewust de KALE marktprijs (geen opslag/belasting/BTW): het is geen netstroom-transactie, dus geen
  // retail-opslag van toepassing. (Eerdere versie vergeleek totaalWinst met een apart "winstZonderBat"-
  // totaal van een andere scope, wat Bc dubbel liet meetellen -- deze rechtstreekse formule niet.)
  const winstPbKaal   = berekenSomKaal('Pb');
  const batMeerwaarde = winstBg + winstBc - kostenGb - winstPbKaal - accuKosten;

  // Werkelijke netto energiekosten van het HELE huishouden die dag (niet accu-specifiek, in
  // tegenstelling tot batMeerwaarde hierboven) -- voor het jaaroverzicht (voorschot vs. werkelijk).
  // Onder saldering (nu actief) nettoot export 1-op-1 tegen import tegen dezelfde all-in prijs, dus
  // gewoon: (Gb+Gc, betaald) - (Bg+Pg, gecrediteerd). Positief = die dag netto kosten, negatief =
  // netto credit (bouwt mee aan de teruggave).
  const winstPg = berekenSomVerkoop('Pg');
  const nettoKosten = kostenGb + kostenGc - winstBg - winstPg;

  await upsertEnergieData({
    datum:           datumStr,
    solar_yield_kwh: PgKwh + PcKwh + PbKwh,
    verbruik_kwh:    BcKwh + PcKwh + GcKwh,
    net_import_kwh:  GbKwh + GcKwh,
    net_export_kwh:  BgKwh + PgKwh,
    winst_euro:      totaalWinst,
    bat_meerwaarde:  batMeerwaarde,
    netto_kosten:    nettoKosten,
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
    winstPbKaal:   winstPbKaal.toFixed(2),
    batMeerwaarde: batMeerwaarde.toFixed(2),
    nettoKosten:   nettoKosten.toFixed(2),
    salderingActief,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (!(await magApi(request))) {
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
