import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic'; // nooit cachen op Vercel

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL niet ingesteld');
  return neon(url);
}

const BAT_MIN_PCT             = 10;
const BAT_MAX_PCT             = 90;
const BATTERIJ_CAPACITEIT_KWH = 32;
const LAAD_VERMOGEN_KW        = 10;   // kW per uur max laden (gemeten: 9.7 kW)
const ONTLAAD_VERMOGEN_KW     = 10;   // kW per uur max ontladen

// Groen modus drempels
const GROEN_MAX_LADEN_PCT = 70;   // Alleen van net laden als batterij < 70%

// Handel modus: zon moet echt goed schijnen voor "laden via zon" beslissing
const SOLAR_LADEN_DREMPEL = 2000; // W — zwakke zon telt niet mee

// Dag-cyclus strategie — avondreserve voor warmtepomp + huisverbruik
const AVOND_RESERVE_PCT   = 30;  // % SOC bewaren na avondpiek (~9.6 kWh bij 32 kWh)
const AVOND_RESERVE_START = 20;  // uur: na 20:00 reserve strikt bewaken
const AVOND_PIEK_START    = 16;  // uur: avondpiek begint
const AVOND_PIEK_EIND     = 20;  // uur: avondpiek eindigt

// Dynamische drempels: percentiel van de dagprijzen
const PERCENTIEL_LADEN    = 25;
const PERCENTIEL_ONTLADEN = 75;
const VLOER_ONTLADEN      = 0.20;

// Frank Energie consumentenprijs = spot + BTW op spot + opslag + energiebelasting
// (sourcingMarkupPrice en energyTaxPrice zijn al incl BTW)
function frankNaarConsumer(p) {
  return parseFloat(p.marketPrice)
    + parseFloat(p.marketPriceTax)
    + parseFloat(p.sourcingMarkupPrice)
    + parseFloat(p.energyTaxPrice);
}

async function haalFrankEnergiePrijzen(vandaag) {
  // Frank Energie GraphQL — geen authenticatie nodig voor marktprijzen
  const morgen = new Date(vandaag + 'T00:00:00Z');
  morgen.setUTCDate(morgen.getUTCDate() + 1);
  const morgenStr = morgen.toISOString().split('T')[0];

  const res = await fetch('https://graphql.frankenergie.nl/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query {
        marketPricesElectricity(startDate: "${vandaag}", endDate: "${morgenStr}") {
          from
          till
          marketPrice
          marketPriceTax
          sourcingMarkupPrice
          energyTaxPrice
        }
      }`,
    }),
  });

  if (!res.ok) throw new Error(`Frank Energie API fout: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Frank Energie GraphQL fout: ${json.errors[0]?.message}`);
  return json.data?.marketPricesElectricity || [];
}

// Simpele DST-check voor Nederland
function isDaylightSaving(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return date.getTimezoneOffset() < Math.max(jan, jul);
}

// Geeft Nederlands lokaal uur (0-23)
function getNlUur(nu) {
  return (nu.getUTCHours() + (isDaylightSaving(nu) ? 2 : 1)) % 24;
}

function berekenDrempels(consumerPrijzen) {
  const gesorteerd = [...consumerPrijzen].sort((a, b) => a - b);
  const n = gesorteerd.length;
  const laadDrempel    = gesorteerd[Math.floor(n * PERCENTIEL_LADEN / 100)];
  const ontlaadDrempel = Math.max(
    gesorteerd[Math.floor(n * PERCENTIEL_ONTLADEN / 100)],
    VLOER_ONTLADEN
  );
  return { laadDrempel, ontlaadDrempel };
}

async function haalZonnePrognose(nu, sql) {
  const vandaag   = nu.toISOString().split('T')[0];
  const morgen    = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 1));
  const morgenStr = morgen.toISOString().split('T')[0];

  const resourceId = process.env.SOLCAST_RESOURCE_ID;
  const apiKey     = process.env.SOLCAST_API_KEY;

  if (!resourceId || !apiKey) {
    console.error('Solcast env vars ontbreken');
    return null;
  }

  // Cache: gebruik opgeslagen resultaat als het minder dan 1 uur oud is
  try {
    const cacheRij = await sql`SELECT waarde, bijgewerkt FROM instellingen WHERE sleutel = 'solcast_cache'`;
    if (cacheRij[0]) {
      const ouderdom = (nu - new Date(cacheRij[0].bijgewerkt)) / 60000; // minuten
      if (ouderdom < 60) {
        return JSON.parse(cacheRij[0].waarde);
      }
    }
  } catch { /* cache nog niet beschikbaar */ }

  try {
    // Solcast: forecast (toekomst) + estimated_actuals (verleden vandaag) parallel ophalen
    const [forecastRes, actualsRes] = await Promise.all([
      fetch(`https://api.solcast.com.au/rooftop_sites/${resourceId}/forecasts?format=json&hours=48`,
        { headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch(`https://api.solcast.com.au/rooftop_sites/${resourceId}/estimated_actuals?format=json&hours=24`,
        { headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);
    if (!forecastRes.ok) throw new Error(`Solcast forecast HTTP ${forecastRes.status}`);
    const forecastData = await forecastRes.json();
    const actualsData  = actualsRes.ok ? await actualsRes.json() : { estimated_actuals: [] };

    const periodes       = forecastData.forecasts       ?? [];
    const actualsPerides = actualsData.estimated_actuals ?? [];

    // Aggregeer per uur en per dag
    let vandaagKwh          = 0;
    let morgenKwh           = 0;
    let vandaagResterendKwh = 0;
    const uurData = {}; // { 'HH:MM' + dag: { watt, dag } }

    for (const p of periodes) {
      // period_end is UTC, periode is 30 min
      const eindUtc  = new Date(p.period_end);
      const beginUtc = new Date(eindUtc.getTime() - 30 * 60000);
      const kwh      = (p.pv_estimate ?? 0) * 0.5; // kW × 0.5h = kWh
      const watt     = (p.pv_estimate ?? 0) * 1000; // kW → W

      const dagStr = beginUtc.toISOString().split('T')[0];
      const isVandaag = dagStr === vandaag;
      const isMorgen  = dagStr === morgenStr;

      if (isVandaag) {
        vandaagKwh += kwh;
        if (beginUtc >= nu) vandaagResterendKwh += kwh;
      }
      if (isMorgen) morgenKwh += kwh;

      // Grafiek: alleen toekomstige periodes (verleden komt uit estimated_actuals)
      if ((isVandaag || isMorgen) && beginUtc >= nu) {
        const lokaalBegin = new Date(beginUtc.getTime() + 2 * 3600000);
        const tijdLabel   = lokaalBegin.toISOString().slice(11, 16);
        const key         = (isVandaag ? 'vandaag' : 'morgen') + '_' + tijdLabel;
        if (!uurData[key]) {
          uurData[key] = { tijd: tijdLabel, watt: 0, dag: isVandaag ? 'vandaag' : 'morgen' };
        }
        uurData[key].watt += watt / 2;
      }
    }

    // Verleden uren vandaag uit estimated_actuals (alleen periodes vóór nu)
    let vandaagGeproduceerdKwh = 0;
    for (const p of actualsPerides) {
      const eindUtc  = new Date(p.period_end);
      const beginUtc = new Date(eindUtc.getTime() - 30 * 60000);
      const dagStr   = beginUtc.toISOString().split('T')[0];
      if (dagStr !== vandaag) continue;

      const kwh  = (p.pv_estimate ?? 0) * 0.5;
      const watt = (p.pv_estimate ?? 0) * 1000;
      vandaagGeproduceerdKwh += kwh;

      // Alleen verleden in grafiek zetten
      if (beginUtc < nu) {
        const lokaalBegin = new Date(beginUtc.getTime() + 2 * 3600000);
        const tijdLabel   = lokaalBegin.toISOString().slice(11, 16);
        const key         = 'vandaag_' + tijdLabel;
        if (!uurData[key]) {
          uurData[key] = { tijd: tijdLabel, watt: 0, dag: 'vandaag' };
        }
        uurData[key].watt += watt / 2;
      }
    }

    const vandaagTotaalKwh = vandaagGeproduceerdKwh + vandaagKwh;

    const grafiekData = Object.values(uurData).sort((a, b) => {
      const dagOrd = (d) => (d === 'vandaag' ? 0 : 1);
      if (dagOrd(a.dag) !== dagOrd(b.dag)) return dagOrd(a.dag) - dagOrd(b.dag);
      return a.tijd.localeCompare(b.tijd);
    });

    const resultaat = {
      vandaagKwh:          +vandaagTotaalKwh.toFixed(2),
      morgenKwh:           +morgenKwh.toFixed(2),
      vandaagResterendKwh: +vandaagResterendKwh.toFixed(2),
      grafiekData,
    };

    // Sla op in cache
    try {
      await sql`
        INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
        VALUES ('solcast_cache', ${JSON.stringify(resultaat)}, NOW())
        ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = NOW()
      `;
    } catch { /* cache opslaan mislukt, geen probleem */ }

    return resultaat;
  } catch (e) {
    console.error('Solcast mislukt:', e.message);

    // Fallback 1: gebruik cache ook als die ouder is dan 1 uur
    try {
      const cacheRij = await sql`SELECT waarde FROM instellingen WHERE sleutel = 'solcast_cache'`;
      if (cacheRij[0]) return JSON.parse(cacheRij[0].waarde);
    } catch { /* geen cache */ }

    // Fallback 2: Forecast.Solar
    try {
      console.log('Solcast mislukt, fallback naar Forecast.Solar');
      const res = await fetch('https://api.forecast.solar/estimate/53.20/6.75/35/0/6.66');
      if (!res.ok) return null;
      const data = await res.json();
      const wattHoursDay    = data.result?.watt_hours_day    || {};
      const wattHoursPeriod = data.result?.watt_hours_period || {};
      const watts           = data.result?.watts             || {};
      const vandaag2 = nu.toISOString().split('T')[0];
      const morgen2  = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 1)).toISOString().split('T')[0];
      const nuAms    = new Date(nu.getTime() + 2 * 3600000);
      const nuAmsStr = nuAms.toISOString().replace('T', ' ').slice(0, 19);
      let resterend = 0;
      for (const [t, wh] of Object.entries(wattHoursPeriod)) {
        if (t.startsWith(vandaag2) && t > nuAmsStr) resterend += wh / 1000;
      }
      const grafiekData2 = [];
      for (const [t, w] of Object.entries(watts)) {
        const isV = t.startsWith(vandaag2), isM = t.startsWith(morgen2);
        if (isV || isM) grafiekData2.push({ tijd: t.slice(11, 16), watt: w, dag: isV ? 'vandaag' : 'morgen' });
      }
      grafiekData2.sort((a, b) => (a.dag === b.dag ? a.tijd.localeCompare(b.tijd) : a.dag === 'vandaag' ? -1 : 1));
      return {
        vandaagKwh:          +((wattHoursDay[vandaag2] || 0) / 1000).toFixed(2),
        morgenKwh:           +((wattHoursDay[morgen2]  || 0) / 1000).toFixed(2),
        vandaagResterendKwh: +resterend.toFixed(2),
        grafiekData: grafiekData2,
      };
    } catch { return null; }
  }
}

// ── Essentieel override: als wachten maar net levert aan essentiële lasten → ontladen ─
// Geldt in beide modi. Vuurt alleen als beslissing = wachten, grid importeert en
// batterij heeft genoeg reserve (> BAT_MIN_PCT + 10%).
function essentieelOverride(beslissing, reden, batterijPct, essentieelW, gridW) {
  if (
    beslissing === 'wachten' &&
    essentieelW != null && essentieelW > 50 &&
    gridW       != null && gridW       > 50 &&
    (batterijPct === null || batterijPct > BAT_MIN_PCT + 10)
  ) {
    return {
      beslissing: 'ontladen',
      reden: `Essentieel: batterij dekt ${essentieelW}W (net levert anders ${gridW}W)`,
    };
  }
  return { beslissing, reden };
}

// ── HANDEL modus v2: dag-cyclus bewust ────────────────────────────────────
// Strategie:
//   Nacht/vroeg  → laden bij lage prijs
//   Ochtend piek → ontladen, maar ALLEEN als zon+goedkope uren daarna kunnen
//                  herladen voor de avondpiek
//   Middag       → laden via zon of lage prijs (herwapening voor avond)
//   Avondpiek    → ontladen tot AVOND_RESERVE_PCT
//   Na 20:00     → AVOND_RESERVE_PCT beschermen voor warmtepomp + huisverbruik
//
// prijzenPerNlUur: array[24] met consumentenprijs per NL-uur (null = onbekend)
function bepaalBeslissing(
  huidigUur, consumerPrijs, batterijPct, prijzenPerNlUur,
  laadDrempel, ontlaadDrempel, solarRestKwh, solarW
) {
  // ── Harde grenzen ─────────────────────────────────────────────
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT)
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  if (consumerPrijs < 0)
    return { beslissing: 'laden', reden: `Negatieve prijs (€${consumerPrijs.toFixed(4)}) — gratis stroom` };

  // ── Na 20:00: avondreserve bewaken ────────────────────────────
  if (huidigUur >= AVOND_RESERVE_START) {
    if (batterijPct !== null && batterijPct <= AVOND_RESERVE_PCT) {
      const z = solarW > 100 ? ` · zon ${(solarW/1000).toFixed(1)} kW` : '';
      return { beslissing: 'wachten', reden: `Avondreserve (${batterijPct}% ≤ ${AVOND_RESERVE_PCT}%) — bewaken voor nacht${z}` };
    }
    // Na 20:00 mag nog wel ontladen als prijs hoog en boven reserve
    if (consumerPrijs >= ontlaadDrempel && (batterijPct === null || batterijPct > AVOND_RESERVE_PCT))
      return { beslissing: 'ontladen', reden: `Late piek (${huidigUur}:00): €${consumerPrijs.toFixed(4)} → tot ${AVOND_RESERVE_PCT}%` };
  }

  // ── Bereken herlaadpotentieel voor rest van dag ────────────────
  // Zon + goedkope uren die nog komen — hoeveel kWh kan batterij bijkomen?
  const solarKwhRest = solarRestKwh ?? 0;
  const goedkopeUrenRest = prijzenPerNlUur
    .slice(huidigUur + 1)
    .filter(p => p !== null && p <= laadDrempel).length;
  const socKwh = (batterijPct ?? 50) / 100 * BATTERIJ_CAPACITEIT_KWH;
  const maxHerlaadKwh = Math.min(
    solarKwhRest + goedkopeUrenRest * LAAD_VERMOGEN_KW,
    BATTERIJ_CAPACITEIT_KWH * (BAT_MAX_PCT - (batterijPct ?? 50)) / 100
  );

  // ── Avondpiek uren die nog komen ──────────────────────────────
  const avondPiekUrenNog = prijzenPerNlUur
    .slice(huidigUur + 1)
    .filter((p, i) => {
      const uur = huidigUur + 1 + i;
      return p !== null && uur >= AVOND_PIEK_START && uur < AVOND_PIEK_EIND && p >= ontlaadDrempel;
    }).length;
  const avondReserveKwh    = AVOND_RESERVE_PCT / 100 * BATTERIJ_CAPACITEIT_KWH;
  const bewaarVoorAvondKwh = avondPiekUrenNog * ONTLAAD_VERMOGEN_KW;

  // ── Avondpiek zelf (16-20): ontladen naar reserve ─────────────
  const isAvondPiek = huidigUur >= AVOND_PIEK_START && huidigUur < AVOND_PIEK_EIND;
  if (isAvondPiek && consumerPrijs >= ontlaadDrempel && (batterijPct === null || batterijPct > AVOND_RESERVE_PCT))
    return { beslissing: 'ontladen', reden: `Avondpiek (${huidigUur}:00): €${consumerPrijs.toFixed(4)} → ontladen tot ${AVOND_RESERVE_PCT}%` };

  // ── Vóór avondpiek: ontladen alleen als herladen daarna kan ───
  // +5% buffer boven reserve om te voorkomen dat we te vroeg ontladen bij calibratie-drift
  if (consumerPrijs >= ontlaadDrempel && huidigUur < AVOND_PIEK_START && (batterijPct === null || batterijPct > AVOND_RESERVE_PCT + 5)) {
    const naOntlaadKwh = Math.max(0, socKwh - ONTLAAD_VERMOGEN_KW);
    const naHerlaadKwh = Math.min(naOntlaadKwh + maxHerlaadKwh, BATTERIJ_CAPACITEIT_KWH * BAT_MAX_PCT / 100);
    const beschikbaarVoorAvond = naHerlaadKwh - avondReserveKwh;

    if (avondPiekUrenNog === 0 || beschikbaarVoorAvond >= bewaarVoorAvondKwh) {
      const avondNoot = avondPiekUrenNog > 0
        ? ` · herlaad ~${maxHerlaadKwh.toFixed(1)} kWh (zon + ${goedkopeUrenRest} goedkope uren)`
        : '';
      return { beslissing: 'ontladen', reden: `Hoge prijs (€${consumerPrijs.toFixed(4)})${avondNoot}` };
    }
    return {
      beslissing: 'wachten',
      reden: `Prijs hoog maar bewaar voor avondpiek (${avondPiekUrenNog}u) · herlaad ~${maxHerlaadKwh.toFixed(1)} kWh via zon+goedkoop`,
    };
  }

  // ── Laden via zon ─────────────────────────────────────────────
  if (solarW !== null && solarW >= SOLAR_LADEN_DREMPEL && (batterijPct === null || batterijPct < BAT_MAX_PCT))
    return { beslissing: 'laden', reden: `Zon schijnt goed (${(solarW/1000).toFixed(1)} kW) — laden voor avondpiek` };

  // ── Laden via lage prijs ──────────────────────────────────────
  if (consumerPrijs <= laadDrempel && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    const doel = avondPiekUrenNog > 0 ? ` — laden voor ${avondPiekUrenNog} avondpiekuur` : '';
    return { beslissing: 'laden', reden: `Prijs laag (€${consumerPrijs.toFixed(4)})${doel}` };
  }

  // ── Wachten ───────────────────────────────────────────────────
  const zonNoot   = solarW !== null && solarW > 100 ? ` · zon laadt (${(solarW/1000).toFixed(1)} kW)` : '';
  const avondNoot = avondPiekUrenNog > 0 ? ` · ${avondPiekUrenNog} avondpiekuur verwacht` : '';
  return { beslissing: 'wachten', reden: `Prijs neutraal (€${consumerPrijs.toFixed(4)})${zonNoot}${avondNoot}` };
}

// ── GROEN modus: zelfconsumptie is prio, surplus mag verkocht bij hoge prijs ──
function bepaalBeslissingGroen(huidigUur, consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel, zonResterendKwh, morgenKwh, solarW) {
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT) {
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  }
  if (consumerPrijs < 0) {
    return { beslissing: 'laden', reden: `Negatieve prijs (€${consumerPrijs.toFixed(4)}) — gratis stroom` };
  }
  // Na 20:00: avondreserve ook in groen modus bewaken
  if (huidigUur >= AVOND_RESERVE_START && batterijPct !== null && batterijPct <= AVOND_RESERVE_PCT) {
    return { beslissing: 'wachten', reden: `Groen: avondreserve (${batterijPct}%) bewaken` };
  }
  // Surplus ontladen: batterij >75% + hoge prijs + morgen of vandaag nog genoeg zon
  const heeftSurplus  = (batterijPct ?? 0) >= 75;
  const morgenZonnig  = (morgenKwh ?? 0) >= 8;
  const nogZonVandaag = (zonResterendKwh ?? 0) >= 3;
  if (heeftSurplus && consumerPrijs >= ontlaadDrempel && (morgenZonnig || nogZonVandaag)) {
    const zonReden = morgenZonnig
      ? `morgen ${morgenKwh.toFixed(1)} kWh zon verwacht`
      : `nog ${zonResterendKwh.toFixed(1)} kWh zon vandaag`;
    return { beslissing: 'ontladen', reden: `Groen surplus: ${batterijPct}% vol, hoge prijs · ${zonReden}` };
  }
  // Zon schijnt echt goed → laden via zon
  if (solarW !== null && solarW >= SOLAR_LADEN_DREMPEL && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    return { beslissing: 'laden', reden: `Zon schijnt goed (${(solarW/1000).toFixed(1)} kW) — laden via zon` };
  }
  // Zon vult batterij vandaag nog → laden (van zon)
  if (zonResterendKwh !== null && batterijPct !== null) {
    const ruimteKwh = BATTERIJ_CAPACITEIT_KWH * (BAT_MAX_PCT - batterijPct) / 100;
    if (zonResterendKwh >= ruimteKwh * 0.8) {
      return { beslissing: 'laden', reden: `Zon vult batterij vandaag (${zonResterendKwh.toFixed(1)} kWh verwacht)` };
    }
  }
  // Goedkoop + batterij heeft ruimte + geen zon op komst → laden van net
  if (consumerPrijs <= laadDrempel && (batterijPct === null || batterijPct < GROEN_MAX_LADEN_PCT)) {
    return { beslissing: 'laden', reden: `Groen: prijs laag (€${consumerPrijs.toFixed(4)}) en batterij < ${GROEN_MAX_LADEN_PCT}%` };
  }
  // Middenzone: zon laadt batterij automatisch
  const zonNoot = (solarW !== null && solarW > 100)
    ? ` · zon laadt batterij (${(solarW/1000).toFixed(1)} kW)`
    : '';
  return { beslissing: 'wachten', reden: `Groen: wachten op zon of lage prijs${zonNoot}` };
}

// ── Setpunt berekening met veiligheidslagen ───────────────────────────────
// beslissing van het algoritme → watt-waarde voor het ESS grid setpunt
// Veiligheidslagen worden in volgorde gecontroleerd vóór algoritme-beslissing
function berekenSetpunt(beslissing, batterijPct, socTijdstip) {
  const dataOudMs  = socTijdstip ? Date.now() - new Date(socTijdstip).getTime() : Infinity;
  const dataVers   = dataOudMs < 5 * 60 * 1000; // sensordata minder dan 5 minuten oud

  // Laag 1: SOC te laag → forceer laden ongeacht algoritme
  if (batterijPct !== null && batterijPct < 12)
    return { watt: 9000, veiligheid: `Noodladen: SOC ${batterijPct}% < 12%` };

  // Laag 2: SOC te hoog → stop laden ongeacht algoritme
  if (batterijPct !== null && batterijPct > 92)
    return { watt: 50, veiligheid: `SOC vol: ${batterijPct}% > 92%` };

  // Laag 3: ontladen zonder verse sensordata is te riskant
  if (beslissing === 'ontladen' && (!dataVers || batterijPct === null)) {
    const minOud = Math.round(dataOudMs / 60000);
    return { watt: 50, veiligheid: `Ontladen gepauzeerd: sensordata ${minOud === Infinity ? '?' : minOud} min oud` };
  }

  // Algoritme-beslissing → setpunt
  switch (beslissing) {
    case 'laden':    return { watt:  9000, veiligheid: null };
    case 'ontladen': return { watt: -9000, veiligheid: null };
    case 'stop':     return { watt:  9000, veiligheid: 'Noodladen: stop-beslissing' };
    default:         return { watt:    50, veiligheid: null }; // wachten
  }
}

// TenneT geeft prijzen in EUR/MWh — omrekenen naar EUR/kWh
function mwhNaarKwh(mwh) {
  return mwh / 1000;
}

function formatTenneTDatum(date) {
  const d  = String(date.getUTCDate()).padStart(2, '0');
  const m  = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y  = date.getUTCFullYear();
  const h  = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s  = String(date.getUTCSeconds()).padStart(2, '0');
  return `${d}-${m}-${y} ${h}:${mi}:${s}`;
}

async function haalTenneTData(nu) {
  const apiKey = process.env.TENNET_API_KEY;
  if (!apiKey) return null; // optioneel — geen fout als key ontbreekt

  // Fetch de hele dag in 1 call (limiet: 25 calls/dag op productie)
  const dagStart = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate(), 0, 0, 0));
  const res = await fetch(
    `https://api.tennet.eu/publications/v1/settlement-prices?date_from=${encodeURIComponent(formatTenneTDatum(dagStart))}&date_to=${encodeURIComponent(formatTenneTDatum(nu))}`,
    { headers: { apikey: apiKey, Accept: 'application/json' } }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`TenneT API fout ${res.status}: ${body.slice(0, 300)}`);
    return null;
  }
  const data = await res.json();
  console.log('TenneT response keys:', Object.keys(data));
  return data;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const nu      = new Date();
    const vandaag = nu.toISOString().split('T')[0];
    const sql     = getDb();

    // 1. Uurprijzen ophalen via Frank Energie, fallback naar EnergyZero
    let frankPrijzen = [];
    let prijsBron = 'frank';
    try {
      frankPrijzen = await haalFrankEnergiePrijzen(vandaag);
    } catch (e) {
      console.error('Frank Energie mislukt, fallback naar EnergyZero:', e.message);
      prijsBron = 'energyzero';
      const ezRes  = await fetch(`https://api.energyzero.nl/v1/energyprices?fromDate=${vandaag}T00:00:00.000Z&tillDate=${vandaag}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`);
      const ezData = await ezRes.json();
      frankPrijzen = (ezData?.Prices || []).map(p => ({
        from:                p.readingDate,
        till:                new Date(new Date(p.readingDate).getTime() + 3600000).toISOString(),
        marketPrice:         p.price,
        priceIncludingMarkup: (p.price + 0.03 + 0.13),
      }));
    }
    // Huidig NL uur + prijzen per NL uur (day-ahead array voor beslissingslogica)
    const huidigNlUur = getNlUur(nu);
    const prijzenPerNlUur = new Array(24).fill(null);
    for (const p of frankPrijzen) {
      const nlUur = getNlUur(new Date(p.from));
      if (nlUur >= 0 && nlUur < 24) prijzenPerNlUur[nlUur] = frankNaarConsumer(p);
    }

    const huidigUurObj  = frankPrijzen.find(p => {
      const van = new Date(p.from);
      const tot = new Date(p.till);
      return van <= nu && tot > nu;
    }) || frankPrijzen[frankPrijzen.length - 1];

    const spotPrijs     = huidigUurObj ? parseFloat(huidigUurObj.marketPrice) : null;
    const consumerPrijs = huidigUurObj ? frankNaarConsumer(huidigUurObj)      : null;

    // Dynamische drempels berekenen op basis van vandaag
    const consumerPrijzenVandaag = frankPrijzen.map(p => frankNaarConsumer(p));
    const { laadDrempel, ontlaadDrempel } = berekenDrempels(consumerPrijzenVandaag);

    // 2. Zonneprognose ophalen via Forecast.Solar (parallel met TenneT)
    const [tennетData, zonPrognose] = await Promise.all([
      haalTenneTData(nu),
      haalZonnePrognose(nu, sql),
    ]);
    const tennетPoints  = tennетData?.TimeSeries?.[0]?.Period?.Points || [];
    const huidigTennet = tennетPoints.find(p => {
      const start = new Date(p.timeInterval_start);
      const eind  = new Date(p.timeInterval_end);
      return start <= nu && eind > nu;
    }) || tennетPoints[tennетPoints.length - 1];
    const tennetShortage = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.shortage)) : null;
    const tennetSurplus  = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.surplus))  : null;

    // 3. Modus + controle kill switch ophalen
    let modus = 'handel';
    let controleActief = false;
    try {
      const instRows = await sql`SELECT sleutel, waarde FROM instellingen WHERE sleutel IN ('modus', 'controle_actief')`;
      for (const r of instRows) {
        if (r.sleutel === 'modus')           modus          = r.waarde ?? 'handel';
        if (r.sleutel === 'controle_actief') controleActief = r.waarde === 'true';
      }
    } catch { /* instellingen tabel bestaat nog niet */ }

    // 4. Realtime sensordata ophalen uit database (gestuurd door Node-RED)
    // SOC en sensor data apart opvragen: onbalans INSERT heeft geen solar/grid/verbruik
    // bron = 'nodered' markeert rijen van Node-RED — fallback op solar_w als kolom nog niet bestaat
    let sensorRow;
    try {
      sensorRow = await sql`
        SELECT batterij_pct, solar_w, grid_w, verbruik_w, essentieel_w, tijdstip
        FROM onbalans_log
        WHERE bron = 'nodered'
        ORDER BY tijdstip DESC
        LIMIT 1
      `;
    } catch {
      sensorRow = await sql`
        SELECT batterij_pct, solar_w, grid_w, verbruik_w, tijdstip
        FROM onbalans_log
        WHERE solar_w IS NOT NULL
        ORDER BY tijdstip DESC
        LIMIT 1
      `;
    }
    const r            = sensorRow[0] ?? null;
    const batterijPct = r ? parseFloat(r.batterij_pct)                                    : null;
    const solarW      = r ? Math.round(parseFloat(r.solar_w))                              : null;
    const gridW       = r ? Math.round(parseFloat(r.grid_w))                               : null;
    const verbruikW   = r ? Math.round(parseFloat(r.verbruik_w))                           : null;
    const essentieelW = r?.essentieel_w != null ? Math.round(parseFloat(r.essentieel_w))  : null;
    const socTijdstip = r ? r.tijdstip                                                     : null;

    // 5. Beslissing bepalen (prijs + zonprognose + modus)
    const zonResterendKwh = zonPrognose?.vandaagResterendKwh ?? null;
    const morgenKwh = zonPrognose?.morgenKwh ?? null;
    const rawResultaat = consumerPrijs !== null
      ? modus === 'groen'
        ? bepaalBeslissingGroen(huidigNlUur, consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel, zonResterendKwh, morgenKwh, solarW)
        : bepaalBeslissing(huidigNlUur, consumerPrijs, batterijPct, prijzenPerNlUur, laadDrempel, ontlaadDrempel, zonResterendKwh, solarW)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // Essentieel override: als wachten maar essentiële lasten trekken van net → ontladen
    const { beslissing, reden } = essentieelOverride(
      rawResultaat.beslissing, rawResultaat.reden,
      batterijPct, essentieelW, gridW
    );

    // 6. Setpunt berekenen met veiligheidslagen
    const { watt: setpuntWatt, veiligheid: setpuntVeiligheid } = berekenSetpunt(beslissing, batterijPct, socTijdstip);

    // 7. Als auto-besturing aan: schrijf commando naar DB (Node-RED pollt dit)
    // Alleen schrijven als het setpunt veranderd is t.o.v. het laatste commando
    if (controleActief) {
      const laatste = await sql`
        SELECT watt FROM ess_commando ORDER BY aangemaakt DESC LIMIT 1
      `.catch(() => []);
      const vorigeWatt = laatste[0]?.watt ?? null;
      if (vorigeWatt !== setpuntWatt) {
        await sql`
          INSERT INTO ess_commando (watt, reden, bron)
          VALUES (
            ${setpuntWatt},
            ${setpuntVeiligheid ?? reden},
            'algoritme'
          )
        `.catch(e => console.error('ess_commando write mislukt:', e.message));
      }
    }

    // 8. Opslaan in database — alleen prijs + beslissing
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing)
      VALUES (${nu.toISOString()}, ${consumerPrijs}, ${beslissing})
    `;

    // 5b. Daadwerkelijk gemeten zonne-energie vandaag (uit onze eigen DB)
    let solarVandaagGemeten = null;
    try {
      const solarRows = await sql`
        SELECT ROUND(
          SUM(solar_w * EXTRACT(EPOCH FROM (
            LEAD(tijdstip) OVER (ORDER BY tijdstip) - tijdstip
          )) / 3600000.0)::numeric
        , 2) AS kwh
        FROM onbalans_log
        WHERE bron = 'nodered'
          AND solar_w IS NOT NULL
          AND tijdstip >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Amsterdam') AT TIME ZONE 'Europe/Amsterdam'
      `;
      solarVandaagGemeten = solarRows[0]?.kwh != null ? parseFloat(solarRows[0].kwh) : null;
    } catch { /* negeer als query faalt */ }

    // 6. Alle prijzen van vandaag voor grafiek — incl. zone per uur
    // Bouw een snelle lookup: tijdlabel → verwacht zonnewatt (voor zon-override markering)
    const zonWattPerTijd = {};
    if (zonPrognose?.grafiekData) {
      for (const { tijd, watt, dag } of zonPrognose.grafiekData) {
        if (dag === 'vandaag') zonWattPerTijd[tijd] = watt;
      }
    }

    const allePrijzen = frankPrijzen.map(p => {
      const consP = frankNaarConsumer(p);
      const tijdLabel = new Date(p.from).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
      const zonWatt = zonWattPerTijd[tijdLabel] ?? 0;

      let zone;
      // Beide modi: laden bij lage prijs (zon-override), ontladen bij hoge prijs
      // Groen ontlaadt alleen bij surplus (batterij >75% + morgen zon) — zelfde kleur, andere drempel
      if (consP >= ontlaadDrempel)   zone = 'ontladen';
      else if (consP <= laadDrempel) zone = zonWatt > 500 ? 'zon' : 'laden';
      else                           zone = 'wachten';

      return {
        tijd:  tijdLabel,
        prijs: +consP.toFixed(4),
        spot:  +parseFloat(p.marketPrice).toFixed(4),
        zone,
      };
    });

    // Exacte tijd-label van het huidige uur (matcht altijd met grafiekdata)
    const huidigeTijd = huidigUurObj
      ? new Date(huidigUurObj.from).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
      : null;

    return Response.json({
      success:     true,
      modus,
      prijsBron,
      tijdstip:    nu.toISOString(),
      prijs:       consumerPrijs,
      spotprijs:   spotPrijs,
      huidigeTijd,
      batterijPct,
      solarW,
      gridW,
      verbruikW,
      essentieelW,
      socTijdstip: socTijdstip ? new Date(socTijdstip).toISOString() : null,
      beslissing,
      reden,
      setpuntWatt,
      setpuntVeiligheid,
      controleActief,
      tennet: tennetShortage !== null ? {
        shortage: tennetShortage,
        surplus:  tennetSurplus,
      } : null,
      drempels: {
        ontladen:   +ontlaadDrempel.toFixed(4),
        laden:      +laadDrempel.toFixed(4),
        batMin:     BAT_MIN_PCT,
        batMax:     BAT_MAX_PCT,
        percentiel: { laden: PERCENTIEL_LADEN, ontladen: PERCENTIEL_ONTLADEN },
      },
      prijzenVandaag: allePrijzen,
      zonPrognose: zonPrognose ? {
        vandaagKwh:          +zonPrognose.vandaagKwh.toFixed(2),
        morgenKwh:           +zonPrognose.morgenKwh.toFixed(2),
        vandaagGemeten:      solarVandaagGemeten,
        grafiekData:          zonPrognose.grafiekData,
      } : null,
    });

  } catch (err) {
    console.error('Onbalans fout:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT tijdstip, prijs_kwh, beslissing, batterij_pct
      FROM onbalans_log
      WHERE tijdstip > NOW() - INTERVAL '24 hours'
      ORDER BY tijdstip DESC
      LIMIT 100
    `;
    return Response.json({ success: true, data: rows });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}