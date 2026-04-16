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

// Haal EPEX-prijzen op voor één volledige kalendermaand van één jaar.
async function haalMaandPrijzen(jaar, maandNr) {
  const maandStr    = `${jaar}-${String(maandNr).padStart(2, '0')}`;
  const aantalDagen = new Date(jaar, maandNr, 0).getDate();
  const van = `${maandStr}-01T00:00:00.000Z`;
  const tot = `${maandStr}-${String(aantalDagen).padStart(2, '0')}T23:59:59.000Z`;

  const res = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${van}&tillDate=${tot}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.Prices || []).map(p => parseFloat(p.price));
}

// Haal prijzen op voor dezelfde kalendermaand over 2023, 2024 én 2025,
// pool alle uurprijzen en bereken gezamenlijke percentielstatistieken.
// Zo middelen atypische jaren (bijv. koude snap jan 2025) uit.
async function haalGemiddeldeMaandPrijzen(maandNr) {
  const jaren = [2023, 2024, 2025];
  const alleSpots = (await Promise.all(jaren.map(j => haalMaandPrijzen(j, maandNr)))).flat();
  if (!alleSpots.length) return null;

  const consumers   = alleSpots.map(anwbPrijs);
  const sortedSpots = [...alleSpots].sort((a, b) => a - b);
  const sortedCons  = [...consumers].sort((a, b) => a - b);

  const idx25 = Math.floor(alleSpots.length * 0.25);
  const idx75 = Math.floor(alleSpots.length * 0.75);

  // Negatieve spotprijsuren: DESS laadt maximaal bij als spotprijs < 0
  const negatiefSpots = alleSpots.filter(s => s < 0);
  const negatieveUrenPerMaand = negatiefSpots.length / jaren.length;
  const gemNegatieveSpot = negatiefSpots.length > 0
    ? negatiefSpots.reduce((s, v) => s + v, 0) / negatiefSpots.length
    : 0;

  return {
    p25_spot:             sortedSpots[idx25],
    p75_spot:             sortedSpots[idx75],
    p25_consumer:         sortedCons[idx25],
    p75_consumer:         sortedCons[idx75],
    avg_consumer:         consumers.reduce((s, v) => s + v, 0) / consumers.length,
    avg_spot:             alleSpots.reduce((s, v) => s + v, 0) / alleSpots.length,
    spread_consumer:      sortedCons[idx75] - sortedCons[idx25],
    negatieveUrenPerMaand,
    gemNegatieveSpot,
  };
}

// Simuleer maandelijkse batterijwinst — dagmodel.
//
// Component A — zonne-arbitrage:
//   Overdag laadt batterij van panelen; gelegenheidskosten = feedInTarief.
//   Met saldering: feedInTarief = p25_spot (export levert al redelijke creditering).
//   Zonder saldering: feedInTarief = avg_spot (~€0,08/kWh) — zon is goedkoper op te slaan.
//   Ontladen waardeer je tegen p75_consumer: DESS kiest bewust de piekuren.
//   Winst/dag = zonUit × p75_consumer − zonIn × feedInTarief
//
// Component B — grid time-shifting (warmtepomp model):
//   Laad 's nachts van net op goedkoopste uren (p25_consumer).
//   Ontladen op duurste uren (p75_consumer), ook voor warmtepomp.
//   Winst/dag = gridIn × (p75_consumer × EFF − p25_consumer)
//
// Component C — negatieve spotprijzen:
//   Als EPEX spot < 0 laadt DESS maximaal bij van net (word betaald voor verbruik).
//   Aanname: 5 kW laadvermogen, gemiddeld 4 kWh per negatief uur (80% benutting).
//   Waarde: je ontvangt |negConsumerPrijs| voor laden + bespaart avg_consumer bij ontladen.
//
// Accukosten: €0,01/kWh laden + €0,01/kWh ontladen
//
// feedInTarief = null → gebruik p25_spot (standaard, met saldering)
//              = avg_spot → zonder saldering scenario
function simuleerMaand(maandNr, exportKwh, importKwh, prijzen, feedInTarief = null) {
  const dagen = DAGEN[maandNr];
  const {
    p25_spot, p25_consumer, p75_consumer, avg_consumer,
    negatieveUrenPerMaand, gemNegatieveSpot,
  } = prijzen;
  const EFF        = 0.9;
  const CAPACITEIT = 25.6;  // kWh/dag (32 kWh × 80%)

  // feedInTarief: wat je kWh opbrengt als je exporteert i.p.v. opslaat
  const feedIn = feedInTarief ?? p25_spot;

  // ── Component A: zonne-arbitrage ─────────────────────────────────────────
  const zonPerDag      = exportKwh / dagen;
  const zonInPerDag    = Math.min(zonPerDag, CAPACITEIT);
  const zonUitPerDag   = zonInPerDag * EFF;
  const zonWinstPerDag = zonUitPerDag * p75_consumer - zonInPerDag * feedIn;

  // ── Component B: goedkoop inkopen voor warmtepomp ────────────────────────
  const gridSpread     = p75_consumer * EFF - p25_consumer;
  const ruimteNaZon    = Math.max(0, CAPACITEIT - zonInPerDag);
  const verbruikPerDag = importKwh / dagen;
  const gridInPerDag   = gridSpread > 0.01
    ? Math.min(ruimteNaZon * 0.85, 16, verbruikPerDag * 0.6)
    : 0;
  const gridWinstPerDag = gridInPerDag * gridSpread;

  // ── Component C: negatieve spotprijsuren ─────────────────────────────────
  // Tijdens EPEX spot < 0 laadt DESS de accu vol — los van de normale arbitrage.
  // Per negatief uur: 5 kW lader × ~80% benutting = 4 kWh geladen.
  // Consumentenprijs bij negatief spot: anwbPrijs(gemNegatieveSpot) — kan laag/negatief zijn.
  // Waarde per kWh: avg_consumer × EFF (besparing bij ontladen) − negConsumerPrijs (laadkosten).
  const negUurPerDag      = negatieveUrenPerMaand / dagen;
  const negConsumerPrijs  = anwbPrijs(gemNegatieveSpot);
  const negCapaciteit     = Math.max(0, ruimteNaZon - gridInPerDag); // resterende ruimte na B
  const negInPerDag       = Math.min(negUurPerDag * 4, negCapaciteit);
  const negWinstPerDag    = negInPerDag > 0
    ? negInPerDag * (avg_consumer * EFF - negConsumerPrijs)
    : 0;

  // ── Accukosten ────────────────────────────────────────────────────────────
  const cycledPerDag  = zonInPerDag + gridInPerDag + negInPerDag;
  const accuPerDag    = cycledPerDag * 0.01 * 2;

  // Verdeel accukosten proportioneel over de drie componenten
  const brutTotaal = zonWinstPerDag + gridWinstPerDag + negWinstPerDag;
  const zonFractie  = brutTotaal > 0 ? zonWinstPerDag  / brutTotaal : 0.34;
  const gridFractie = brutTotaal > 0 ? gridWinstPerDag / brutTotaal : 0.33;
  const negFractie  = brutTotaal > 0 ? negWinstPerDag  / brutTotaal : 0.33;

  const totaalWinst = brutTotaal - accuPerDag;
  const zonNetto  = +((zonWinstPerDag  - accuPerDag * zonFractie)  * dagen).toFixed(2);
  const gridNetto = +((gridWinstPerDag - accuPerDag * gridFractie) * dagen).toFixed(2);
  const negNetto  = +((negWinstPerDag  - accuPerDag * negFractie)  * dagen).toFixed(2);

  return {
    proj:     +(totaalWinst * dagen).toFixed(2),
    projZon:  zonNetto,   // extra opbrengst door zonnestroom op piekmoment te verkopen
    projGrid: gridNetto,  // besparing door goedkoop inkopen voor warmtepomp
    projNeg:  negNetto,   // winst door laden tijdens negatieve EPEX-prijzen
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

    const cache = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'projectie_cache_v11'`.catch(() => []);
    if (cache[0]) {
      const oud = (Date.now() - new Date(cache[0].bijgewerkt)) / 3600000;
      if (oud < 168) return Response.json({ success: true, ...JSON.parse(cache[0].waarde), vanCache: true });
    }

    // Haal EPEX-prijzen op: 2023+2024+2025 per maand, allemaal parallel (36 calls)
    const maandNummers   = Array.from({ length: 12 }, (_, i) => i + 1);
    const prijsResultaten = await Promise.all(maandNummers.map(m => haalGemiddeldeMaandPrijzen(m)));
    const maandPrijzen   = Object.fromEntries(
      maandNummers.map((m, i) => [`2025-${String(m).padStart(2, '0')}`, prijsResultaten[i]])
    );

    // Simuleer per maand
    const maanden = Object.entries(P1_2025).map(([key, p1]) => {
      const maandNr = parseInt(key.slice(5, 7)) - 1;
      const prijzen = maandPrijzen[key];
      if (!prijzen) return { maand: MAANDEN_NL[maandNr], proj: null };
      // Simulatie MET saldering (standaard)
      const sim = simuleerMaand(maandNr, p1.exp, p1.imp, prijzen);
      // Simulatie ZONDER saldering: exporteer zon aan spotprijs i.p.v. consumentenprijs
      const simZS = simuleerMaand(maandNr, p1.exp, p1.imp, prijzen, prijzen.avg_spot);

      // Energiekosten zonder batterij, MET saldering:
      //   Je betaalt voor import; export wordt gecrediteerd tegen consumentenprijs (netto saldering).
      const energiekosten = +(p1.imp * prijzen.avg_consumer).toFixed(2);

      // Energiekosten zonder batterij, ZONDER saldering:
      //   Je betaalt voor import; export levert alleen spotprijs op (~€0,08/kWh).
      //   Verschil toont het "salderingsvoordeel" dat je nu nog hebt.
      const energiekostenZS = +(p1.imp * prijzen.avg_consumer - p1.exp * prijzen.avg_spot).toFixed(2);

      return {
        maand:           MAANDEN_NL[maandNr],
        proj:            sim.proj,
        projZon:         sim.projZon,
        projGrid:        sim.projGrid,
        projNeg:         sim.projNeg,
        projZS:          simZS.proj,      // batterijwinst zonder saldering (hogere zon-waarde)
        energiekosten,
        energiekostenZS,                  // hogere energiekosten zonder saldering
        exportKwh:       +p1.exp.toFixed(0),
        importKwh:       +p1.imp.toFixed(0),
        avgPrijs:        +prijzen.avg_consumer.toFixed(3),
        spread:          +prijzen.spread_consumer.toFixed(3),
        p25:             +prijzen.p25_consumer.toFixed(3),
        p75:             +prijzen.p75_consumer.toFixed(3),
        p25spot:         +prijzen.p25_spot.toFixed(3),
        avgSpot:         +prijzen.avg_spot.toFixed(3),
        negUren:         +prijzen.negatieveUrenPerMaand.toFixed(1),
        negSpot:         +prijzen.gemNegatieveSpot.toFixed(3),
      };
    });

    const jaarTotaal          = +maanden.reduce((s, m) => s + (m.proj            || 0), 0).toFixed(2);
    const jaarTotaalZon       = +maanden.reduce((s, m) => s + (m.projZon         || 0), 0).toFixed(2);
    const jaarTotaalGrid      = +maanden.reduce((s, m) => s + (m.projGrid        || 0), 0).toFixed(2);
    const jaarTotaalNeg       = +maanden.reduce((s, m) => s + (m.projNeg         || 0), 0).toFixed(2);
    const jaarTotaalZS        = +maanden.reduce((s, m) => s + (m.projZS          || 0), 0).toFixed(2);
    const jaarEnergiekosten   = +maanden.reduce((s, m) => s + (m.energiekosten   || 0), 0).toFixed(2);
    const jaarEnergiekostenZS = +maanden.reduce((s, m) => s + (m.energiekostenZS || 0), 0).toFixed(2);

    const resultaat = {
      maanden,
      jaarTotaal, jaarTotaalZon, jaarTotaalGrid, jaarTotaalNeg,
      jaarTotaalZS,          // batterijwinst in het zonder-saldering scenario
      jaarEnergiekosten,     // variabele stroomkosten zonder batterij, met saldering
      jaarEnergiekostenZS,   // variabele stroomkosten zonder batterij, zonder saldering
    };
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('projectie_cache_v11', ${JSON.stringify(resultaat)}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
    `.catch(() => {});

    // Verwijder oude cache-versies (opruimen)
    await sql`DELETE FROM instellingen WHERE sleutel IN ('projectie_cache','projectie_cache_v2','projectie_cache_v3','projectie_cache_v4','projectie_cache_v5','projectie_cache_v6','projectie_cache_v7','projectie_cache_v8','projectie_cache_v9','projectie_cache_v10')`.catch(() => {});

    return Response.json({ success: true, ...resultaat });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
