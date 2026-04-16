export const dynamic    = 'force-dynamic';
export const maxDuration = 30;

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

// Haal EPEX-prijzen op voor de VOLLEDIGE maand (niet alleen week 2).
// Zo krijgen we de echte maandgemiddelden — inclusief dure en goedkope weken.
async function haalMaandPrijzen(maandStr) {
  const [jaar, maand] = maandStr.split('-').map(Number);
  const aantalDagen   = new Date(jaar, maand, 0).getDate(); // laatste dag van de maand
  const van = `${maandStr}-01T00:00:00.000Z`;
  const tot = `${maandStr}-${String(aantalDagen).padStart(2, '0')}T23:59:59.000Z`;

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

  const avg_consumer = consumers.reduce((s, v) => s + v, 0) / consumers.length;
  const avg_spot     = spots.reduce((s, v) => s + v, 0) / spots.length;

  return {
    p25_spot:        sortedSpots[idx25],
    p75_spot:        sortedSpots[idx75],
    p25_consumer:    sortedCons[idx25],
    p75_consumer:    sortedCons[idx75],
    avg_consumer,
    avg_spot,
    spread_consumer: sortedCons[idx75] - sortedCons[idx25],
  };
}

// Simuleer maandelijkse batterijwinst — dagmodel.
//
// Cyclus 1 — zon-arbitrage:
//   Overdag laadt batterij van panelen (gemiste export = p25_spot).
//   Ontladen waardeer je tegen p75_consumer: DESS kiest bewust de piekuren.
//   Winst/dag = zonUit × p75_consumer − zonIn × p25_spot
//
// Cyclus 2 — grid time-shifting (warmtepomp model):
//   Laad 's nachts van net op goedkoopste uren (p25_consumer).
//   Verbruik overdag voor warmtepomp — vervangt GEMIDDELD verbruik (avg_consumer),
//   niet alleen piekmomenten. Zo modelleren we dat je betaalt, maar minder.
//   Winst/dag = gridIn × (avg_consumer × EFF − p25_consumer)
//
// Accukosten: €0,01/kWh laden + €0,01/kWh ontladen
//
// Geeft een uitsplitsing terug: totaal + twee componenten
function simuleerMaand(maandNr, exportKwh, importKwh, prijzen) {
  const dagen = DAGEN[maandNr];
  const { p25_spot, p25_consumer, p75_consumer, avg_consumer } = prijzen;
  const EFF        = 0.9;
  const CAPACITEIT = 25.6;  // kWh/dag (32 kWh × 80%)

  // ── Component A: zonne-arbitrage ─────────────────────────────────────────
  // Sla goedkope middagzon op → verkoop/gebruik op duur avondpiekmoment.
  // Meerwaarde t.o.v. direct exporteren: (p75_consumer × EFF − p25_spot) per kWh.
  const zonPerDag      = exportKwh / dagen;
  const zonInPerDag    = Math.min(zonPerDag, CAPACITEIT);
  const zonUitPerDag   = zonInPerDag * EFF;
  const zonWinstPerDag = zonUitPerDag * p75_consumer - zonInPerDag * p25_spot;

  // ── Component B: goedkoop inkopen voor warmtepomp ────────────────────────
  // DESS laadt op de goedkoopste uren (p25) en ontlaadt op de duurste uren (p75),
  // ook als het verbruik door de warmtepomp gaat — het huis draait dan op batterij
  // ipv duur net. Besparing per kWh geladen: p75_consumer × EFF − p25_consumer.
  const gridSpread     = p75_consumer * EFF - p25_consumer;
  const ruimteNaZon    = Math.max(0, CAPACITEIT - zonInPerDag);
  const verbruikPerDag = importKwh / dagen;
  // In winter met warmtepomp: bijna volle cyclus mogelijk (max 16 kWh/dag van net,
  // nooit meer dan 85% restcapaciteit, nooit meer dan 60% dagverbruik)
  const gridInPerDag   = gridSpread > 0.01
    ? Math.min(ruimteNaZon * 0.85, 16, verbruikPerDag * 0.6)
    : 0;
  const gridWinstPerDag = gridInPerDag * gridSpread;

  // ── Accukosten ────────────────────────────────────────────────────────────
  const cycledPerDag = zonInPerDag + gridInPerDag;
  const accuPerDag   = cycledPerDag * 0.01 * 2;

  // Verdeel accukosten proportioneel over de twee componenten
  const totaalWinst = zonWinstPerDag + gridWinstPerDag - accuPerDag;
  const zonFractie  = (zonWinstPerDag + gridWinstPerDag) > 0
    ? zonWinstPerDag / (zonWinstPerDag + gridWinstPerDag)
    : 0.5;
  const zonNetto  = +(  (zonWinstPerDag  - accuPerDag * zonFractie)       * dagen).toFixed(2);
  const gridNetto = +((gridWinstPerDag  - accuPerDag * (1 - zonFractie)) * dagen).toFixed(2);

  return {
    proj:     +(totaalWinst * dagen).toFixed(2),
    projZon:  zonNetto,   // extra opbrengst door zonnestroom op piekmoment te verkopen
    projGrid: gridNetto,  // besparing door goedkoop inkopen voor warmtepomp
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    // Cache: 7 dagen — sleutel _v5 (energiekosten toegevoegd)
    const cache = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'projectie_cache_v7'`.catch(() => []);
    if (cache[0]) {
      const oud = (Date.now() - new Date(cache[0].bijgewerkt)) / 3600000;
      if (oud < 168) return Response.json({ success: true, ...JSON.parse(cache[0].waarde), vanCache: true });
    }

    // Haal EPEX-maandprijzen op — volledige maanden, parallel
    const maandKeys      = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const prijsResultaten = await Promise.all(maandKeys.map(k => haalMaandPrijzen(k)));
    const maandPrijzen   = Object.fromEntries(maandKeys.map((k, i) => [k, prijsResultaten[i]]));

    // Simuleer per maand
    const maanden = Object.entries(P1_2025).map(([key, p1]) => {
      const maandNr = parseInt(key.slice(5, 7)) - 1;
      const prijzen = maandPrijzen[key];
      if (!prijzen) return { maand: MAANDEN_NL[maandNr], proj: null };
      const sim = simuleerMaand(maandNr, p1.exp, p1.imp, prijzen);
      // Energiekosten zonder batterij: wat je die maand aan stroom zou betalen
      const energiekosten = +(p1.imp * prijzen.avg_consumer).toFixed(2);
      return {
        maand:        MAANDEN_NL[maandNr],
        proj:         sim.proj,
        projZon:      sim.projZon,
        projGrid:     sim.projGrid,
        energiekosten,
        exportKwh:    +p1.exp.toFixed(0),
        importKwh:    +p1.imp.toFixed(0),
        avgPrijs:     +prijzen.avg_consumer.toFixed(3),
        spread:       +prijzen.spread_consumer.toFixed(3),
        p25:          +prijzen.p25_consumer.toFixed(3),
        p75:          +prijzen.p75_consumer.toFixed(3),
        p25spot:      +prijzen.p25_spot.toFixed(3),
      };
    });

    const jaarTotaal     = +maanden.reduce((s, m) => s + (m.proj     || 0), 0).toFixed(2);
    const jaarTotaalZon  = +maanden.reduce((s, m) => s + (m.projZon  || 0), 0).toFixed(2);
    const jaarTotaalGrid = +maanden.reduce((s, m) => s + (m.projGrid || 0), 0).toFixed(2);

    const resultaat = { maanden, jaarTotaal, jaarTotaalZon, jaarTotaalGrid };
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('projectie_cache_v7', ${JSON.stringify(resultaat)}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
    `.catch(() => {});

    // Verwijder oude cache-versies (opruimen)
    await sql`DELETE FROM instellingen WHERE sleutel IN ('projectie_cache','projectie_cache_v2','projectie_cache_v3','projectie_cache_v4','projectie_cache_v5','projectie_cache_v6')`.catch(() => {});

    return Response.json({ success: true, ...resultaat });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
