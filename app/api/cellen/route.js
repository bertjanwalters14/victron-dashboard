import { magApi } from '@/lib/auth';

// Celspanningen uit VRM: laagste en hoogste cel (met hun nummer) nu, plus de reeks van de afgelopen dagen.
// VRM geeft alleen die twee cellen door (JK BMS via CAN), niet alle cellen afzonderlijk. Celnummers hebben
// het vorm "<pack>::<cel>", bijvoorbeeld "01::14" = pack 01, cel 14.
//
// De route draait per aanvraag (geen cache): de pagina haalt hem client-side op, een paar keer per sessie.
export const dynamic = 'force-dynamic';

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const TOP_V = 3.45;   // hoogste cel vanaf hier = echte top (zelfde grens als `topNu` in ess_logic.js)

// Tops: aaneengesloten stukken waarin de hoogste cel >= 3,45 V is, uit kwartierwaarden (gaten tot 30 min
// worden samengevoegd). Per top: begin, eind, duur, het grootste verschil tussen hoogste en laagste cel
// tijdens de top, en het kleinste verschil in het laatste uur (wat er na het balanceren van over is).
function bepaalTops(stats) {
  const min = new Map((stats.mcV || []).map(([t, v]) => [t, num(v)]));
  const punten = [];
  for (const [t, v] of stats.McV || []) {
    const hoog = num(v), laag = min.get(t);
    if (hoog != null && laag != null) punten.push({ t, hoog, verschil: hoog - laag });
  }
  punten.sort((a, b) => a.t - b.t);
  const tops = [];
  let cur = null;
  for (const p of punten) {
    if (p.hoog < TOP_V) continue;
    if (cur && p.t - cur.laatste <= 30 * 60000) { cur.punten.push(p); cur.laatste = p.t; }
    else { cur = { punten: [p], laatste: p.t }; tops.push(cur); }
  }
  return tops.map((x) => {
    const eersteT = x.punten[0].t;
    const staart = x.punten.slice(-4);
    return {
      start: eersteT,
      eind: x.laatste + 15 * 60000,
      minuten: Math.round((x.laatste - eersteT) / 60000) + 15,
      maxVerschil: Math.round(Math.max(...x.punten.map((p) => p.verschil)) * 1000) / 1000,
      eindVerschil: Math.round(Math.min(...staart.map((p) => p.verschil)) * 1000) / 1000,
      maxCel: Math.round(Math.max(...x.punten.map((p) => p.hoog)) * 1000) / 1000,
    };
  });
}

export async function GET(request) {
  if (!(await magApi(request))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const dagen = Math.min(14, Math.max(1, parseInt(searchParams.get('dagen') || '3', 10) || 3));
    const eind  = Math.floor(Date.now() / 1000);
    const start = eind - dagen * 86400;
    // Tot 3 dagen per kwartier, daarboven per uur (houdt de grafiek licht).
    const interval = dagen <= 3 ? '15mins' : 'hours';
    const headers = { 'x-authorization': `Token ${TOKEN}` };

    const [statsRes, diagRes, topsRes] = await Promise.all([
      fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=custom&attributeCodes[]=mcV&attributeCodes[]=McV&attributeCodes[]=SOC&interval=${interval}&start=${start}&end=${eind}`,
        { headers }
      ),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/diagnostics?count=1000`, { headers }),
      // De laatste 30 dagen per kwartier, los van de gekozen periode, voor de lijst met tops.
      fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=custom&attributeCodes[]=mcV&attributeCodes[]=McV&interval=15mins&start=${eind - 30 * 86400}&end=${eind}`,
        { headers }
      ),
    ]);
    if (!statsRes.ok) throw new Error(`VRM stats fout: ${statsRes.status}`);
    const stats = (await statsRes.json())?.records || {};

    // Reeks: per tijdstip laagste/hoogste cel en SOC samenvoegen.
    const perTijd = new Map();
    for (const [sleutel, veld] of [['mcV', 'min'], ['McV', 'max'], ['SOC', 'soc']]) {
      for (const [t, v] of stats[sleutel] || []) {
        const w = num(v);
        if (w == null) continue;
        const rij = perTijd.get(t) || { t };
        rij[veld] = veld === 'soc' ? Math.round(w * 10) / 10 : Math.round(w * 1000) / 1000;
        perTijd.set(t, rij);
      }
    }
    const reeks = [...perTijd.values()]
      .filter((r) => r.min != null && r.max != null)
      .sort((a, b) => a.t - b.t)
      .map((r) => ({ ...r, verschil: Math.round((r.max - r.min) * 1000) / 1000 }));

    // Stand nu uit de diagnostics (batterijservice, instance 512 heeft de celgegevens).
    let nu = null;
    if (diagRes.ok) {
      const records = (await diagRes.json())?.records || [];
      const bat = {};
      for (const x of records) {
        if (x.instance === 512) bat[x.code] = x;
      }
      if (bat.mcV && bat.McV) {
        nu = {
          laagste:  { v: num(bat.mcV.rawValue), id: bat.mcVCId?.formattedValue ?? null },
          hoogste:  { v: num(bat.McV.rawValue), id: bat.McVCId?.formattedValue ?? null },
          soc:      num(bat.SOC?.rawValue),
          spanning: num(bat.V?.rawValue),
          stroom:   num(bat.I?.rawValue),
          tempMin:  num(bat.mcT?.rawValue),
          tempMax:  num(bat.McT?.rawValue),
          tijd:     bat.mcV.timestamp ? bat.mcV.timestamp * 1000 : null,
        };
      }
    }

    // Tops van de laatste 30 dagen, nieuwste eerst (maximaal 8).
    let tops = [];
    if (topsRes.ok) {
      tops = bepaalTops((await topsRes.json())?.records || {}).reverse().slice(0, 8);
    }

    return Response.json({ success: true, dagen, interval, nu, reeks, tops });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
