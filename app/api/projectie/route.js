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

// Haal een week EPEX-prijzen op voor een gegeven datum (1e van de maand 2025)
async function haalMaandPrijzen(maandStr) {
  const van  = `${maandStr}-08T00:00:00.000Z`;
  const tot  = `${maandStr}-14T23:59:59.000Z`;
  const res  = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${van}&tillDate=${tot}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) return null;
  const json = await res.json();
  const prijzen = (json?.Prices || []).map(p => anwbPrijs(parseFloat(p.price)));
  if (!prijzen.length) return null;
  const gesorteerd = [...prijzen].sort((a, b) => a - b);
  const p25 = gesorteerd[Math.floor(gesorteerd.length * 0.25)];
  const p75 = gesorteerd[Math.floor(gesorteerd.length * 0.75)];
  const avg = prijzen.reduce((s, v) => s + v, 0) / prijzen.length;
  return { p25, p75, avg, spread: p75 - p25 };
}

// Simuleer wat de batterij had verdiend in een maand
// op basis van P1 export/import en maandprijzen
function simuleerMaand(maandNr, exportKwh, importKwh, prijzen) {
  const dagen = DAGEN[maandNr];
  const { p25, p75 } = prijzen;

  // 1. Zonsurplus opslaan en op piekmoment verkopen/gebruiken
  //    Batterij kan max ~24 kWh/dag van zon opslaan (32 kWh cap, 80% nuttig)
  const maxZonPerDag   = 24;
  const zonCaptured    = Math.min(exportKwh, dagen * maxZonPerDag);
  // Zonder batterij: verkocht op zontijdprijs (≈ p25)
  // Met batterij: verkocht op piekmomenten (≈ p75), 90% rendement
  const zonWinst       = zonCaptured * (p75 * 0.9 - p25);

  // 2. Net arbitrage: laden op p25, ontladen op p75
  //    Ruimte over na zonneladen, max 16 kWh/dag van net
  const ruimteNaZon    = Math.max(0, dagen * 24 - zonCaptured);
  const gridArb        = Math.min(ruimteNaZon, dagen * 16, importKwh * 0.35);
  const gridWinst      = gridArb * (p75 * 0.9 - p25);

  // 3. Accukosten: €0,01/kWh per laad- én ontlaadbeurt
  const totaalKwh      = zonCaptured + gridArb;
  const accuKosten     = totaalKwh * 0.01 * 2;

  return +(zonWinst + gridWinst - accuKosten).toFixed(2);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    // Cache: 7 dagen geldig (prijzen van 2025 veranderen niet meer)
    const cache = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'projectie_cache'`.catch(() => []);
    if (cache[0]) {
      const oud = (Date.now() - new Date(cache[0].bijgewerkt)) / 3600000;
      if (oud < 168) return Response.json({ success: true, ...JSON.parse(cache[0].waarde), vanCache: true });
    }

    // Haal EPEX maandprijzen op voor 2025 (week 2 van elke maand)
    const maandPrijzen = {};
    for (let m = 1; m <= 12; m++) {
      const key = `2025-${String(m).padStart(2,'0')}`;
      maandPrijzen[key] = await haalMaandPrijzen(key);
      await new Promise(r => setTimeout(r, 200)); // rustig aan
    }

    // Simuleer per maand
    const maanden = Object.entries(P1_2025).map(([key, p1]) => {
      const maandNr = parseInt(key.slice(5,7)) - 1;
      const prijzen = maandPrijzen[key];
      if (!prijzen) return { maand: MAANDEN_NL[maandNr], proj: null };
      const proj = simuleerMaand(maandNr, p1.exp, p1.imp, prijzen);
      return {
        maand:     MAANDEN_NL[maandNr],
        proj,
        exportKwh: +p1.exp.toFixed(0),
        importKwh: +p1.imp.toFixed(0),
        spread:    +prijzen.spread.toFixed(3),
        p25:       +prijzen.p25.toFixed(3),
        p75:       +prijzen.p75.toFixed(3),
      };
    });

    const jaarTotaal = +maanden.reduce((s, m) => s + (m.proj || 0), 0).toFixed(2);

    const resultaat = { maanden, jaarTotaal };
    await sql`
      INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
      VALUES ('projectie_cache', ${JSON.stringify(resultaat)}, NOW())
      ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
    `.catch(() => {});

    return Response.json({ success: true, ...resultaat });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
