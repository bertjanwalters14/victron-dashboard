export const dynamic = 'force-dynamic';

// P1 maanddata 2025 — cumulatieve dagstanden omgezet naar maandtotalen
// Import = van net gekocht (kWh), Export = teruggeleverd aan net (kWh)
const P1_2025 = {
  '2025-01': { imp: 809.9,  exp: 76.3  },
  '2025-02': { imp: 650.2,  exp: 224.3 },
  '2025-03': { imp: 325.3,  exp: 692.4 },
  '2025-04': { imp: 200.9,  exp: 713.0 },
  '2025-05': { imp: 149.5,  exp: 743.8 },
  '2025-06': { imp: 125.8,  exp: 614.5 },
  '2025-07': { imp: 124.2,  exp: 573.7 },
  '2025-08': { imp: 113.6,  exp: 697.5 },
  '2025-09': { imp: 165.6,  exp: 534.2 },
  '2025-10': { imp: 284.0,  exp: 283.0 },
  '2025-11': { imp: 474.3,  exp: 146.9 },
  '2025-12': { imp: 651.2,  exp: 64.1  },
};

const MAANDEN_NL = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
const DAGEN = [31,28,31,30,31,30,31,31,30,31,30,31];

function anwbPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

// Haal EPEX-prijzen op voor week 2 van de maand.
// Geeft zowel kale spot-percentiel als consumentenprijzen terug.
async function haalMaandPrijzen(maandStr) {
  const van = `${maandStr}-08T00:00:00.000Z`;
  const tot = `${maandStr}-14T23:59:59.000Z`;
  const res = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${van}&tillDate=${tot}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) return null;
  const json = await res.json();

  const spots = (json?.Prices || []).map(p => parseFloat(p.price));
  if (!spots.length) return null;

  const consumers   = spots.map(anwbPrijs);
  const sortedSpots = [...spots].sort((a, b) => a - b);
  const sortedCons  = [...consumers].sort((a, b) => a - b);

  const idx25 = Math.floor(spots.length * 0.25);
  const idx75 = Math.floor(spots.length * 0.75);

  return {
    p25_spot:        sortedSpots[idx25],
    p75_spot:        sortedSpots[idx75],
    p25_consumer:    sortedCons[idx25],
    p75_consumer:    sortedCons[idx75],
    avg_consumer:    consumers.reduce((s, v) => s + v, 0) / consumers.length,
    spread_consumer: sortedCons[idx75] - sortedCons[idx25],
  };
}

// Simuleer maandelijkse batterijwinst — dagmodel gebaseerd op wat DESS doet:
//
// Cyclus 1 — zon-arbitrage (grootste waarde):
//   Overdag laadt batterij van zonnepanelen in plaats van direct te exporteren (p25_spot).
//   Avondpiek: ontladen naar huis of net, gewaardeerd tegen p75_consumer (saldering).
//   Winst/dag = zonUit × p75_consumer − zonIn × p25_spot
//
// Cyclus 2 — nacht/grid-arbitrage (als spread het toelaat):
//   Laad van net op goedkoopste uren (avg_consumer), ontlaad op piekmomenten (p75_consumer).
//   Winst/dag = gridIn × (p75_consumer × 0.9 − avg_consumer)
//
// Accukosten: €0,01/kWh laden + €0,01/kWh ontladen
//
function simuleerMaand(maandNr, exportKwh, importKwh, prijzen) {
  const dagen = DAGEN[maandNr];
  const { p25_spot, p75_consumer, avg_consumer } = prijzen;
  const EFF        = 0.9;   // rondreis-rendement
  const CAPACITEIT = 25.6;  // kWh bruikbaar per dag (32 kWh × 80%)

  // ── Cyclus 1: zon-arbitrage ───────────────────────────────────────────────
  const zonPerDag   = exportKwh / dagen;
  const zonInPerDag = Math.min(zonPerDag, CAPACITEIT);      // laden vanuit zon
  const zonUitPerDag = zonInPerDag * EFF;                   // netto naar huis/net

  // Ontladen waardeer je tegen p75_consumer: hetzij bespaart import, hetzij verkoop
  // aan net op piekmomenten (saldering = zelfde tarief).
  const zonWinstPerDag = zonUitPerDag * p75_consumer
                       - zonInPerDag  * p25_spot;           // gemiste export op zonnemoment

  // ── Cyclus 2: nacht-arbitrage ─────────────────────────────────────────────
  const ruimteNaZon    = Math.max(0, CAPACITEIT - zonInPerDag);
  const gridSpread     = p75_consumer * EFF - avg_consumer; // laad gem., ontlaad piek
  const gridInPerDag   = gridSpread > 0.02
    ? Math.min(ruimteNaZon * 0.5, 12)                       // max ~halve restcapaciteit, max 12 kWh
    : 0;
  const gridWinstPerDag = gridInPerDag * gridSpread;

  // ── Accukosten ────────────────────────────────────────────────────────────
  const cycledPerDag  = zonInPerDag + gridInPerDag;
  const accuPerDag    = cycledPerDag * 0.01 * 2;            // €0,01 laden + €0,01 ontladen

  const winstPerDag = zonWinstPerDag + gridWinstPerDag - accuPerDag;
  return +(winstPerDag * dagen).toFixed(2);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    // Cache: 7 dagen geldig — sleutel _v3 voor dagmodel
    const cache = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'projectie_cache_v3'`.catch(() => []);
    if (cache[0]) {
      const oud = (Date.now() - new Date(cache[0].bijgewerkt)) / 3600000;
      if (oud < 168) return Response.json({ success: true, ...JSON.parse(cache[0].waarde), vanCache: true });
    }

    // Haal EPEX maandprijzen op voor 2025 (week 2 van elke maand)
    const maandPrijzen = {};
    for (let m = 1; m <= 12; m++) {
      const key = `2025-${String(m).padStart(2, '0')}`;
      maandPrijzen[key] = await haalMaandPrijzen(key);
      await new Promise(r => setTimeout(r, 200));
    }

    // Simuleer per maand
    const maanden = Object.entries(P1_2025).map(([key, p1]) => {
      const maandNr = parseInt(key.slice(5, 7)) - 1;
      const prijzen = maandPrijzen[key];
      if (!prijzen) return { maand: MAANDEN_NL[maandNr], proj: null };
      const proj = simuleerMaand(maandNr, p1.exp, p1.imp, prijzen);
      return {
        maand:     MAANDEN_NL[maandNr],
        proj,
        exportKwh: +p1.exp.toFixed(0),
        importKwh: +p1.imp.toFixed(0),
        spread:    +prijzen.spread_consumer.toFixed(3),
        p25:       +prijzen.p25_consumer.toFixed(3),
        p75:       +prijzen.p75_consumer.toFixed(3),
        p25spot:   +prijzen.p25_spot.toFixed(3),
      };
    });

    const jaarTotaal = +maanden.reduce((s, m) => s + (m.proj || 0), 0).toFixed(2);

    const resultaat = { maanden, jaarTotaal };
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('projectie_cache_v3', ${JSON.stringify(resultaat)}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
    `.catch(() => {});

    return Response.json({ success: true, ...resultaat });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
