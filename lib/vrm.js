import { unstable_cache } from 'next/cache';

// Het Minimum SOC van de ESS in VRM (code H4ms, "ESS Minimum SOC (unless grid fails)"). De sturing gebruikt het als vloer van de prognose: de accu ontlaadt daaronder nooit,
// het huis draait dan op het net. Het verandert zelden, dus een uur gecachet (één VRM-aanroep per uur, niet per minuut-poll van Node-RED).
// Een fout gooit door en wordt niet gecachet; de aanroeper vangt hem op (dan krijgt Node-RED null en geldt het gedrag zonder VRM-minimum).
export const VRM_MIN_TAG = 'vrm-min';

export const haalVrmMinSoc = unstable_cache(
  async () => {
    const site = process.env.VICTRON_SITE_ID;
    const token = process.env.VICTRON_API_TOKEN;
    if (!site || !token) return null;
    const res = await fetch(`https://vrmapi.victronenergy.com/v2/installations/${site}/diagnostics?count=1000`, {
      headers: { 'x-authorization': `Token ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`VRM diagnostics ${res.status}`);
    const records = (await res.json())?.records || [];
    const r = records.find((x) => x.code === 'H4ms');
    const v = r ? Number(r.rawValue) : NaN;
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  },
  ['vrm-min-soc'],
  { tags: [VRM_MIN_TAG], revalidate: 3600 }
);
