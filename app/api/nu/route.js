const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Live vermogens van dit moment (W) voor de kaartjes bovenaan Live sturing: zon, accu, net, huis.
// Bron: VRM-diagnostics, device "System overview" -- GEEN Neon (geen DB-belasting). Read-only en zonder
// secret (net als /api/ess-status); de VRM-fetch is 30 s gecachet zodat veel bezoekers VRM niet bestoken.
// Tekens: accu + = laden, net + = inkoop (- = teruglevering).
export async function GET() {
  try {
    const res = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/diagnostics?count=2000`,
      { headers: { 'x-authorization': `Token ${TOKEN}` }, next: { revalidate: 30 } }
    );
    if (!res.ok) return Response.json({ success: false, fout: `VRM ${res.status}` }, { status: 502 });
    const json = await res.json();
    const sys = {};
    for (const r of json?.records || []) {
      if (r.Device === 'System overview' && !(r.code in sys)) sys[r.code] = Number(r.rawValue);
    }
    const som = (...codes) => codes.reduce((t, c) => t + (Number.isFinite(sys[c]) ? sys[c] : 0), 0);
    return Response.json({
      success: true,
      zonW:  Math.round(som('P', 'P2', 'P3')),
      accuW: Math.round(Number.isFinite(sys.bp) ? sys.bp : 0),
      netW:  Math.round(som('g1', 'g2', 'g3')),
      huisW: Math.round(som('a1', 'a2', 'a3')),
      soc:   Number.isFinite(sys.bs) ? sys.bs : null,
    });
  } catch (err) {
    return Response.json({ success: false, fout: err.message }, { status: 500 });
  }
}
