const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

// Actuele SOC rechtstreeks uit VRM (diagnostics, device "System overview", code "bs"). Bewust GEEN Neon:
// de status-push van Node-RED loopt maar elke 20 min, dit houdt het getal in de app vers zonder de
// database wakker te houden. De VRM-fetch is 30 s gecachet zodat meerdere schermen VRM niet bestoken.
// Toegang loopt via de proxy (sessiecookie of CRON_SECRET).
export async function GET() {
  try {
    const res = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/diagnostics?count=2000`,
      { headers: { 'x-authorization': `Token ${TOKEN}` }, next: { revalidate: 30 } }
    );
    if (!res.ok) return Response.json({ success: false, fout: `VRM ${res.status}` }, { status: 502 });
    const json = await res.json();
    const rec = (json?.records || []).find(r => r.Device === 'System overview' && r.code === 'bs');
    const soc = rec != null ? Number(rec.rawValue) : NaN;
    if (!Number.isFinite(soc)) return Response.json({ success: false, fout: 'SOC niet gevonden' }, { status: 502 });
    return Response.json({ success: true, soc, tijdstip: rec.timestamp ?? null });
  } catch (err) {
    return Response.json({ success: false, fout: err.message }, { status: 500 });
  }
}
