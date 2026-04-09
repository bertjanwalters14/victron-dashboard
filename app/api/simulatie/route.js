export const dynamic = 'force-dynamic';

import { neon } from '@neondatabase/serverless';

// ── Constanten (gelijk aan onbalans/route.js) ────────────────────────────
const BAT_MIN_PCT             = 10;
const BAT_MAX_PCT             = 90;
const BATTERIJ_CAPACITEIT_KWH = 32;
const PERCENTIEL_LADEN        = 25;
const PERCENTIEL_ONTLADEN     = 75;
const VLOER_ONTLADEN          = 0.20;
const LAAD_VERMOGEN_KW        = 10;   // kW per uur max laden (gemeten: 9.7 kW)
const ONTLAAD_VERMOGEN_KW     = 10;   // kW per uur max ontladen
const WEAR_PER_KWH            = 0.01; // €/kWh slijtage
const SOC_START_PCT           = 50;   // aanname: dag begint op 50%
const AVOND_RESERVE_PCT       = 30;   // % SOC bewaren voor avondverbruik
const AVOND_RESERVE_START     = 20;   // uur: na 20:00 reserve bewaken
const AVOND_PIEK_START        = 16;
const AVOND_PIEK_EIND         = 20;
const SOLAR_LADEN_DREMPEL     = 2000; // W

function anwbPrijs(spot) {
  return (spot + 0.03 + 0.13) * 1.21;
}

function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

async function haalUurprijzen(datumStr) {
  const isDST   = isDaylightSaving(new Date(datumStr + 'T12:00:00Z'));
  const offset  = isDST ? 2 : 1;
  const vanUtc  = new Date(datumStr + 'T00:00:00Z');
  vanUtc.setUTCHours(vanUtc.getUTCHours() - offset);
  const totUtc  = new Date(datumStr + 'T23:59:59Z');
  totUtc.setUTCHours(totUtc.getUTCHours() - offset);

  const res = await fetch(
    `https://api.energyzero.nl/v1/energyprices?fromDate=${vanUtc.toISOString()}&tillDate=${totUtc.toISOString()}&interval=4&usageType=1&inclBtw=false`
  );
  if (!res.ok) throw new Error(`EnergyZero fout: ${res.status}`);
  const json = await res.json();
  return json?.Prices || [];
}

function berekenDrempels(consumerPrijzen) {
  const gesorteerd = [...consumerPrijzen].sort((a, b) => a - b);
  const n = gesorteerd.length;
  return {
    laadDrempel:    gesorteerd[Math.floor(n * PERCENTIEL_LADEN / 100)],
    ontlaadDrempel: Math.max(
      gesorteerd[Math.floor(n * PERCENTIEL_ONTLADEN / 100)],
      VLOER_ONTLADEN
    ),
  };
}

// Dag-cyclus beslissing — identiek aan onbalans/route.js bepaalBeslissing
function bepaalBeslissing(uur, prijs, socPct, prijzen, laadDrempel, ontlaadDrempel, solarRestKwh) {
  if (socPct < BAT_MIN_PCT) return 'stop';
  if (prijs < 0)            return 'laden';

  // Na 20:00: avondreserve bewaken
  if (uur >= AVOND_RESERVE_START) {
    if (socPct <= AVOND_RESERVE_PCT) return 'wachten';
    if (prijs >= ontlaadDrempel)     return 'ontladen';
  }

  // Herlaadpotentieel (zon + goedkope uren resterend)
  const goedkopeUrenRest = prijzen.slice(uur + 1).filter(p => p <= laadDrempel).length;
  const socKwh = socPct / 100 * BATTERIJ_CAPACITEIT_KWH;
  const maxHerlaadKwh = Math.min(
    (solarRestKwh ?? 0) + goedkopeUrenRest * LAAD_VERMOGEN_KW,
    BATTERIJ_CAPACITEIT_KWH * (BAT_MAX_PCT - socPct) / 100
  );

  // Avondpiek uren nog te komen
  const avondPiekUrenNog = prijzen.slice(uur + 1).filter((p, i) => {
    const absUur = uur + 1 + i;
    return absUur >= AVOND_PIEK_START && absUur < AVOND_PIEK_EIND && p >= ontlaadDrempel;
  }).length;
  const avondReserveKwh    = AVOND_RESERVE_PCT / 100 * BATTERIJ_CAPACITEIT_KWH;
  const bewaarVoorAvondKwh = avondPiekUrenNog * ONTLAAD_VERMOGEN_KW;

  // Avondpiek zelf
  const isAvondPiek = uur >= AVOND_PIEK_START && uur < AVOND_PIEK_EIND;
  if (isAvondPiek && prijs >= ontlaadDrempel && socPct > AVOND_RESERVE_PCT) return 'ontladen';

  // Vóór avondpiek: ontladen alleen als herladen daarna mogelijk is
  if (prijs >= ontlaadDrempel && uur < AVOND_PIEK_START && socPct > AVOND_RESERVE_PCT) {
    const naOntlaadKwh = Math.max(0, socKwh - ONTLAAD_VERMOGEN_KW);
    const naHerlaadKwh = Math.min(naOntlaadKwh + maxHerlaadKwh, BATTERIJ_CAPACITEIT_KWH * BAT_MAX_PCT / 100);
    const beschikbaarVoorAvond = naHerlaadKwh - avondReserveKwh;
    if (avondPiekUrenNog === 0 || beschikbaarVoorAvond >= bewaarVoorAvondKwh) return 'ontladen';
    return 'wachten';
  }

  if (prijs <= laadDrempel && socPct < BAT_MAX_PCT) return 'laden';
  return 'wachten';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Datum: ?datum=2026-04-09 of standaard gisteren
  let datumStr = searchParams.get('datum');
  if (!datumStr) {
    const gisteren = new Date();
    gisteren.setUTCDate(gisteren.getUTCDate() - 1);
    datumStr = gisteren.toISOString().split('T')[0];
  }

  try {
    // ── 1. Spotprijzen ophalen ─────────────────────────────────────────────
    const rawPrijzen = await haalUurprijzen(datumStr);
    if (!rawPrijzen.length) {
      return Response.json({ success: false, bericht: 'Geen prijsdata beschikbaar voor deze dag' });
    }

    // Sorteer op tijd en pak de 24 NL-uurprijzen
    const isDST     = isDaylightSaving(new Date(datumStr + 'T12:00:00Z'));
    const offsetMs  = (isDST ? 2 : 1) * 3600000;

    // Maak uur → prijs map (NL lokale uren 0-23)
    const prijsPerUur = new Array(24).fill(null);
    for (const p of rawPrijzen) {
      const utcMs   = new Date(p.readingDate).getTime();
      const nlMs    = utcMs + offsetMs;
      const nlUur   = new Date(nlMs).getUTCHours();
      if (nlUur >= 0 && nlUur < 24) {
        prijsPerUur[nlUur] = anwbPrijs(parseFloat(p.price));
      }
    }

    // Vul eventuele gaten met gemiddelde
    const bekende = prijsPerUur.filter(v => v !== null);
    const gemiddelde = bekende.length
      ? bekende.reduce((s, v) => s + v, 0) / bekende.length
      : 0.28;
    const prijzen = prijsPerUur.map(v => v ?? gemiddelde);

    // ── 2. Drempels berekenen ──────────────────────────────────────────────
    const { laadDrempel, ontlaadDrempel } = berekenDrempels(prijzen);

    // ── 3. Simulatie uitvoeren ─────────────────────────────────────────────
    let socKwh    = BATTERIJ_CAPACITEIT_KWH * SOC_START_PCT / 100;
    const minKwh  = BATTERIJ_CAPACITEIT_KWH * BAT_MIN_PCT  / 100;
    const maxKwh  = BATTERIJ_CAPACITEIT_KWH * BAT_MAX_PCT  / 100;

    let totaalLadenKwh    = 0;
    let totaalOntlaadKwh  = 0;
    let kostenLaden       = 0;
    let opbrengstOntladen = 0;

    // Schat resterend zonkwh per uur (afnemend — zon schijnt minder naarmate dag vordert)
    // Zonder echte Solcast data in simulatie: verdeel zonnig-uur schatting lineair
    // over de middaguren. Dit is een vereenvoudiging voor de herlaadcheck.
    function solarRestPerUur(uur) {
      // Aanname: zon draagt bij van 08:00-17:00, piek rond 13:00
      // Ruwe schatting — in werkelijkheid komt dit van Solcast
      const zonnige = [0,0,0,0,0,0,0,0,1,2,3,4,4,3,2,1,0,0,0,0,0,0,0,0];
      return zonnige.slice(uur + 1).reduce((s, v) => s + v, 0) * 1.5; // kWh
    }

    const uren = prijzen.map((prijs, uur) => {
      const socPct    = (socKwh / BATTERIJ_CAPACITEIT_KWH) * 100;
      const beslissing = bepaalBeslissing(uur, prijs, socPct, prijzen, laadDrempel, ontlaadDrempel, solarRestPerUur(uur));

      let kwhDelta  = 0;
      let euroDelta = 0;

      if (beslissing === 'laden') {
        const ruimte    = maxKwh - socKwh;
        const laadKwh   = Math.min(LAAD_VERMOGEN_KW, ruimte);
        if (laadKwh > 0.01) {
          socKwh          += laadKwh;
          kwhDelta         = +laadKwh.toFixed(3);
          euroDelta        = -(laadKwh * prijs);  // negatief = uitgave
          kostenLaden     += laadKwh * prijs;
          totaalLadenKwh  += laadKwh;
        }
      } else if (beslissing === 'ontladen') {
        const beschikbaar  = socKwh - minKwh;
        const ontlaadKwh   = Math.min(ONTLAAD_VERMOGEN_KW, beschikbaar);
        if (ontlaadKwh > 0.01) {
          socKwh              -= ontlaadKwh;
          kwhDelta             = -ontlaadKwh;  // negatief = ontladen
          euroDelta            = +(ontlaadKwh * prijs);  // positief = inkomsten
          opbrengstOntladen   += ontlaadKwh * prijs;
          totaalOntlaadKwh    += ontlaadKwh;
        }
      }

      return {
        uur,
        tijdLabel:   `${String(uur).padStart(2, '0')}:00`,
        prijs:       +prijs.toFixed(4),
        beslissing,
        socPct:      +((socKwh / BATTERIJ_CAPACITEIT_KWH) * 100).toFixed(1),
        kwhDelta:    +kwhDelta.toFixed(3),
        euroDelta:   +euroDelta.toFixed(4),
      };
    });

    const wearKosten  = (totaalLadenKwh + totaalOntlaadKwh) * WEAR_PER_KWH;

    // SOC-correctie: als we meer ontladen dan geladen (SOC daalt), corrigeer de
    // "gratis" beginvoorraad tegen de gemiddelde dagprijs.
    // Zonder correctie is de simulatie oneerlijk: het begint op 50% en kan die
    // energie gratis ontladen zonder hem te hebben ingekocht.
    const socStartKwh  = BATTERIJ_CAPACITEIT_KWH * SOC_START_PCT / 100;
    const socEindKwh   = uren[23] ? (uren[23].socPct / 100) * BATTERIJ_CAPACITEIT_KWH : socStartKwh;
    const socVerschilKwh = socStartKwh - socEindKwh; // positief = meer ontladen dan geladen
    const gemPrijs     = prijzen.reduce((s, p) => s + p, 0) / prijzen.length;
    const socCorrectie = socVerschilKwh > 0 ? socVerschilKwh * gemPrijs : 0;

    const nettoWinst  = opbrengstOntladen - kostenLaden - wearKosten - socCorrectie;

    // ── 4. Actuele data uit DB ────────────────────────────────────────────
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT winst_euro, solar_yield_kwh, verbruik_kwh, net_import_kwh, net_export_kwh
      FROM energie_data
      WHERE datum = ${datumStr}::date
      LIMIT 1
    `.catch(() => []);

    const actueel = rows[0] ?? null;

    return Response.json({
      success: true,
      datum:   datumStr,
      drempels: {
        laadDrempel:    +laadDrempel.toFixed(4),
        ontlaadDrempel: +ontlaadDrempel.toFixed(4),
      },
      simulatie: {
        socStartPct:       SOC_START_PCT,
        socEindPct:        +uren[23].socPct,
        totaalLadenKwh:    +totaalLadenKwh.toFixed(2),
        totaalOntlaadKwh:  +totaalOntlaadKwh.toFixed(2),
        kostenLaden:       +kostenLaden.toFixed(2),
        opbrengstOntladen: +opbrengstOntladen.toFixed(2),
        wearKosten:        +wearKosten.toFixed(2),
        socCorrectie:      +socCorrectie.toFixed(2),
        nettoWinst:        +nettoWinst.toFixed(2),
      },
      actueel: actueel ? {
        winst_euro:       +parseFloat(actueel.winst_euro).toFixed(2),
        solar_yield_kwh:  +parseFloat(actueel.solar_yield_kwh || 0).toFixed(2),
        verbruik_kwh:     +parseFloat(actueel.verbruik_kwh || 0).toFixed(2),
        net_import_kwh:   +parseFloat(actueel.net_import_kwh || 0).toFixed(2),
        net_export_kwh:   +parseFloat(actueel.net_export_kwh || 0).toFixed(2),
      } : null,
      uren,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
