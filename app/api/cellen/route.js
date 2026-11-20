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

    const [statsRes, diagRes] = await Promise.all([
      fetch(
        `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=custom&attributeCodes[]=mcV&attributeCodes[]=McV&attributeCodes[]=SOC&interval=${interval}&start=${start}&end=${eind}`,
        { headers }
      ),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/diagnostics?count=1000`, { headers }),
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

    return Response.json({ success: true, dagen, interval, nu, reeks });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
