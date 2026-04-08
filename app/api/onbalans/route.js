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

async function haalZonnePrognose(nu) {
  const vandaag = nu.toISOString().split('T')[0];
  const morgen  = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate() + 1));
  const morgenStr = morgen.toISOString().split('T')[0];

  try {
    // Forecast.Solar: lat=53.20, lon=6.75, dec=35°, az=45 (ZW), 6.66 kWp
    const res = await fetch('https://api.forecast.solar/estimate/53.20/6.75/35/45/6.66', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Forecast.Solar HTTP ${res.status}`);
    const data = await res.json();

    const wattHoursDay    = data.result?.watt_hours_day    || {};
    const wattHoursPeriod = data.result?.watt_hours_period || {};
    const watts           = data.result?.watts             || {};

    const vandaagKwh = (wattHoursDay[vandaag]  || 0) / 1000;
    const morgenKwh  = (wattHoursDay[morgenStr] || 0) / 1000;

    // Forecast.Solar geeft tijden in lokale tijd van de locatie (Amsterdam = UTC+2 in april)
    const nuAms    = new Date(nu.getTime() + 2 * 3600000);
    const nuAmsStr = nuAms.toISOString().replace('T', ' ').slice(0, 19);

    let vandaagResterendKwh = 0;
    for (const [tijdStr, wh] of Object.entries(wattHoursPeriod)) {
      if (tijdStr.startsWith(vandaag) && tijdStr > nuAmsStr) {
        vandaagResterendKwh += wh / 1000;
      }
    }

    // Grafiekdata vandaag + morgen gesorteerd op tijd
    const grafiekData = [];
    for (const [tijdStr, w] of Object.entries(watts)) {
      const isVandaag = tijdStr.startsWith(vandaag);
      const isMorgen  = tijdStr.startsWith(morgenStr);
      if (isVandaag || isMorgen) {
        grafiekData.push({
          tijd: tijdStr.slice(11, 16),
          watt: w,
          dag:  isVandaag ? 'vandaag' : 'morgen',
        });
      }
    }
    grafiekData.sort((a, b) => {
      const dagOrd = (d) => (d === 'vandaag' ? 0 : 1);
      if (dagOrd(a.dag) !== dagOrd(b.dag)) return dagOrd(a.dag) - dagOrd(b.dag);
      return a.tijd.localeCompare(b.tijd);
    });

    return { vandaagKwh, morgenKwh, vandaagResterendKwh, grafiekData };
  } catch (e) {
    console.error('Forecast.Solar mislukt:', e.message);
    return null;
  }
}

function bepaalBeslissing(consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel, zonResterendKwh) {
  if (batterijPct !== null && batterijPct < BAT_MIN_PCT) {
    return { beslissing: 'stop', reden: `Batterij te laag (${batterijPct}%)` };
  }
  if (consumerPrijs < 0) {
    return { beslissing: 'laden', reden: `Negatieve prijs (€${consumerPrijs.toFixed(4)}) — gratis stroom` };
  }
  if (consumerPrijs >= ontlaadDrempel && (batterijPct === null || batterijPct > BAT_MIN_PCT)) {
    return { beslissing: 'ontladen', reden: `Prijs hoog (€${consumerPrijs.toFixed(4)} ≥ €${ontlaadDrempel.toFixed(4)})` };
  }
  if (consumerPrijs <= laadDrempel && (batterijPct === null || batterijPct < BAT_MAX_PCT)) {
    // Als er genoeg zon verwacht wordt om de batterij zelf te vullen → niet laden van net
    if (zonResterendKwh !== null && batterijPct !== null) {
      const ruimteKwh = BATTERIJ_CAPACITEIT_KWH * (BAT_MAX_PCT - batterijPct) / 100;
      if (zonResterendKwh >= ruimteKwh * 0.8) {
        return {
          beslissing: 'wachten',
          reden: `Zon vult batterij (${zonResterendKwh.toFixed(1)} kWh verwacht, ${ruimteKwh.toFixed(1)} kWh ruimte)`,
        };
      }
    }
    return { beslissing: 'laden', reden: `Prijs laag (€${consumerPrijs.toFixed(4)} ≤ €${laadDrempel.toFixed(4)})` };
  }
  return { beslissing: 'wachten', reden: `Prijs neutraal (€${consumerPrijs.toFixed(4)})` };
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
    const huidigUur    = frankPrijzen.find(p => {
      const van = new Date(p.from);
      const tot = new Date(p.till);
      return van <= nu && tot > nu;
    }) || frankPrijzen[frankPrijzen.length - 1];

    const spotPrijs     = huidigUur ? parseFloat(huidigUur.marketPrice) : null;
    const consumerPrijs = huidigUur ? frankNaarConsumer(huidigUur)      : null;

    // Dynamische drempels berekenen op basis van vandaag
    const consumerPrijzenVandaag = frankPrijzen.map(p => frankNaarConsumer(p));
    const { laadDrempel, ontlaadDrempel } = berekenDrempels(consumerPrijzenVandaag);

    // 2. Zonneprognose ophalen via Forecast.Solar (parallel met TenneT)
    const [tennетData, zonPrognose] = await Promise.all([
      haalTenneTData(nu),
      haalZonnePrognose(nu),
    ]);
    const tennетPoints  = tennетData?.TimeSeries?.[0]?.Period?.Points || [];
    const huidigTennet = tennетPoints.find(p => {
      const start = new Date(p.timeInterval_start);
      const eind  = new Date(p.timeInterval_end);
      return start <= nu && eind > nu;
    }) || tennетPoints[tennетPoints.length - 1];
    const tennetShortage = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.shortage)) : null;
    const tennetSurplus  = huidigTennet ? mwhNaarKwh(parseFloat(huidigTennet.surplus))  : null;

    // 3. Realtime sensordata ophalen uit database (gestuurd door Node-RED)
    // SOC en sensor data apart opvragen: onbalans INSERT heeft geen solar/grid/verbruik
    const sql = getDb();
    const [socRow, sensorRow] = await Promise.all([
      sql`SELECT batterij_pct, tijdstip FROM onbalans_log
          WHERE batterij_pct IS NOT NULL
          ORDER BY tijdstip DESC LIMIT 1`,
      sql`SELECT solar_w, grid_w, verbruik_w, tijdstip FROM onbalans_log
          WHERE solar_w IS NOT NULL
          ORDER BY tijdstip DESC LIMIT 1`,
    ]);
    const batterijPct    = socRow.length > 0    ? parseFloat(socRow[0].batterij_pct)           : null;
    const socTijdstip    = socRow.length > 0    ? socRow[0].tijdstip                           : null;
    const solarW         = sensorRow.length > 0 ? Math.round(parseFloat(sensorRow[0].solar_w))    : null;
    const gridW          = sensorRow.length > 0 ? Math.round(parseFloat(sensorRow[0].grid_w))     : null;
    const verbruikW      = sensorRow.length > 0 ? Math.round(parseFloat(sensorRow[0].verbruik_w)) : null;
    const sensorTijdstip = sensorRow.length > 0 ? sensorRow[0].tijdstip                          : null;

    // 4. Beslissing bepalen (prijs + zonprognose)
    const zonResterendKwh = zonPrognose?.vandaagResterendKwh ?? null;
    const { beslissing, reden } = consumerPrijs !== null
      ? bepaalBeslissing(consumerPrijs, batterijPct, laadDrempel, ontlaadDrempel, zonResterendKwh)
      : { beslissing: 'wachten', reden: 'Geen prijsdata beschikbaar' };

    // 5. Opslaan in database (consumer prijs)
    await sql`
      INSERT INTO onbalans_log (tijdstip, prijs_kwh, beslissing, batterij_pct)
      VALUES (${nu.toISOString()}, ${consumerPrijs}, ${beslissing}, ${batterijPct})
    `;

    // 6. Alle prijzen van vandaag voor grafiek
    const allePrijzen = frankPrijzen.map(p => ({
      tijd:  new Date(p.from).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }),
      prijs: +frankNaarConsumer(p).toFixed(4),
      spot:  +parseFloat(p.marketPrice).toFixed(4),
    }));

    // Exacte tijd-label van het huidige uur (matcht altijd met grafiekdata)
    const huidigeTijd = huidigUur
      ? new Date(huidigUur.from).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
      : null;

    return Response.json({
      success:     true,
      prijsBron,
      tijdstip:    nu.toISOString(),
      prijs:       consumerPrijs,
      spotprijs:   spotPrijs,
      huidigeTijd,
      batterijPct,
      solarW,
      gridW,
      verbruikW,
      socTijdstip:    socTijdstip    ? new Date(socTijdstip).toISOString()    : null,
      sensorTijdstip: sensorTijdstip ? new Date(sensorTijdstip).toISOString() : null,
      beslissing,
      reden,
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
        vandaagResterendKwh: +zonPrognose.vandaagResterendKwh.toFixed(2),
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