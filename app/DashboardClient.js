'use client';
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

const BATTERIJ_KOSTEN   = 11252;
const INSTALLATIE_DATUM = new Date('2026-04-03');
const MAAND_NAMEN       = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];

const INFO = {
  winst:        'Het totale bedrag dat de batterij heeft opgeleverd sinds installatie. Dit groeit elke dag automatisch.',
  roi:          'Hoeveel procent van je €11.252 investering je al hebt terugverdiend. Stijgt naarmate de batterij meer oplevert.',
  dagwinst:     'Het gemiddelde bedrag dat de batterij per dag oplevert. Wordt nauwkeuriger naarmate er meer data beschikbaar is.',
  terugverdien: 'De geschatte datum waarop je je volledige investering van €11.252 hebt terugverdiend. Gebaseerd op de huidige gemiddelde dagwinst.',
  projectie:    'Schatting op basis van het gemiddelde van alle beschikbare dagen. Wordt nauwkeuriger naarmate er meer data is.',
};

export default function DashboardClient({ data }) {
  const totaalWinst        = data.reduce((s, d) => s + parseFloat(d.winst_euro || 0), 0);
  const aantalDagenData    = data.length;
  const gemDagwinst        = aantalDagenData > 0 ? totaalWinst / aantalDagenData : 0;
  const dagenTerugverdiend = gemDagwinst > 0 ? BATTERIJ_KOSTEN / gemDagwinst : null;
  const terugverdienDatum  = dagenTerugverdiend
    ? new Date(INSTALLATIE_DATUM.getTime() + dagenTerugverdiend * 86400000)
    : null;
  const roiPct             = (totaalWinst / BATTERIJ_KOSTEN) * 100;
  const maandProjectie     = gemDagwinst * 30;
  const jaarProjectie      = gemDagwinst * 365;
  const terugverdienJaren  = gemDagwinst > 0 ? (BATTERIJ_KOSTEN / (gemDagwinst * 365)).toFixed(1) : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">

        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">⚡ Victron Batterij ROI</h1>
            <p className="text-gray-400 mt-1">Installatie: 3 april 2026 · Investering: €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')} <span className="text-green-600 text-xs">(incl. BTW teruggave)</span></p>
          </div>
          <RefreshButton />
        </div>

        <LiveVandaag />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card label="Totale winst"    value={`€${totaalWinst.toFixed(2)}`}  color="text-green-400"  sub="sinds installatie"      info={INFO.winst} />
          <Card label="ROI"             value={`${roiPct.toFixed(2)}%`}        color="text-blue-400"   sub="van €11.252"             info={INFO.roi} />
          <Card label="Gem. dagwinst"   value={`€${gemDagwinst.toFixed(2)}`}   color="text-yellow-400" sub={`over ${aantalDagenData} dag${aantalDagenData !== 1 ? 'en' : ''} data`} info={INFO.dagwinst} />
          <Card
            label="Terugverdiend op"
            value={terugverdienDatum ? terugverdienDatum.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' }) : '—'}
            color="text-purple-400"
            sub={dagenTerugverdiend ? `over ${Math.round(dagenTerugverdiend / 365 * 10) / 10} jaar` : 'nog berekening nodig'}
            info={INFO.terugverdien}
          />
        </div>

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold text-gray-200">📈 Projectie</h2>
            <span className="text-xs text-gray-500">op basis van {aantalDagenData} dag{aantalDagenData !== 1 ? 'en' : ''} data</span>
            <InfoIcon text={INFO.projectie} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <ProjectieCard label="Per maand"       value={`€${maandProjectie.toFixed(0)}`} sub="geschatte maandwinst" color="text-emerald-400" />
            <ProjectieCard label="Per jaar"         value={`€${jaarProjectie.toFixed(0)}`}  sub="geschatte jaarwinst" color="text-teal-400" />
            <ProjectieCard
              label="Terugverdientijd"
              value={terugverdienJaren ? `${terugverdienJaren} jaar` : '—'}
              sub={terugverdienJaren ? `≈ €${(gemDagwinst * 365).toFixed(0)}/jaar nodig` : 'nog geen data'}
              color={terugverdienJaren && parseFloat(terugverdienJaren) < 10 ? 'text-green-400' : 'text-orange-400'}
            />
          </div>
          {aantalDagenData < 14 && (
            <p className="text-xs text-yellow-500 mt-4">
              ⚠️ Nog maar {aantalDagenData} dag{aantalDagenData !== 1 ? 'en' : ''} data beschikbaar — projectie wordt betrouwbaarder na 14+ dagen.
            </p>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-300 font-medium">Terugverdien voortgang</span>
            <span className="text-white font-bold text-lg">{roiPct.toFixed(2)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-5">
            <div className="bg-gradient-to-r from-green-500 to-emerald-400 h-5 rounded-full transition-all duration-500" style={{ width: `${Math.min(roiPct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>€0</span>
            <span>€{(BATTERIJ_KOSTEN / 2).toLocaleString('nl-NL')}</span>
            <span>€{BATTERIJ_KOSTEN.toLocaleString('nl-NL')}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-gray-200 mb-4">Cumulatieve winst</h2>
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cumulatief(data)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="datum" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={d => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `€${v}`} />
                  <Tooltip formatter={v => [`€${v.toFixed(2)}`, 'Winst']} contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }} labelStyle={{ color: '#9CA3AF' }} />
                  <Line type="monotone" dataKey="cumulatief" stroke="#10B981" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
            )}
          </div>

          <div className="bg-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-gray-200 mb-4">Recente dagen</h2>
            {data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-gray-700">
                      <th className="text-left py-2">Datum</th>
                      <th className="text-right py-2">Zon (kWh)</th>
                      <th className="text-right py-2">Naar net</th>
                      <th className="text-right py-2">Winst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data].reverse().slice(0, 8).map(d => (
                      <tr key={d.datum} className="border-b border-gray-700">
                        <td className="py-2 text-gray-300">{new Date(d.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</td>
                        <td className="py-2 text-right text-yellow-400">{parseFloat(d.solar_yield_kwh || 0).toFixed(1)}</td>
                        <td className="py-2 text-right text-blue-400">{parseFloat(d.net_export_kwh || 0).toFixed(2)}</td>
                        <td className="py-2 text-right text-green-400 font-medium">€{parseFloat(d.winst_euro || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
            )}
          </div>
        </div>

        <OnbalansTegel />
        <P1Vergelijking />

        <p className="text-center text-gray-600 text-xs mt-6">
          Data wordt elke nacht om 00:01 automatisch bijgewerkt
        </p>
      </div>
    </main>
  );
}

function OnbalansTegel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [nu, setNu]           = useState('');

  async function fetchOnbalans() {
    try {
      const res = await fetch('/api/onbalans?secret=Nummer14!');
      const json = await res.json();
      if (json.success) setData(json);
    } catch(e) { console.error(e); }
    setLoading(false);
    setNu(new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }));
  }

  useEffect(() => {
    fetchOnbalans();
    const iv = setInterval(fetchOnbalans, 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const kleur = data?.beslissing === 'ontladen' ? 'text-green-400'
    : data?.beslissing === 'laden'    ? 'text-blue-400'
    : data?.beslissing === 'stop'     ? 'text-red-400'
    : 'text-yellow-400';

  const bgKleur = data?.beslissing === 'ontladen' ? 'from-green-900 to-emerald-800'
    : data?.beslissing === 'laden'    ? 'from-blue-900 to-blue-800'
    : data?.beslissing === 'stop'     ? 'from-red-900 to-red-800'
    : 'from-gray-800 to-gray-700';

  const emoji = data?.beslissing === 'ontladen' ? '🟢'
    : data?.beslissing === 'laden'    ? '🔵'
    : data?.beslissing === 'stop'     ? '🔴'
    : '🟡';

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h2 className="font-semibold text-gray-200 mb-4">⚡ Markt & Beslissing</h2>

      {/* Hoofd tegel */}
      <div className={`bg-gradient-to-r ${bgKleur} rounded-xl p-5 mb-4 flex justify-between items-center`}>
        <div>
          <p className="text-gray-300 text-sm font-medium mb-1">Huidig advies (simulatie)</p>
          <p className={`text-3xl font-bold ${kleur}`}>
            {loading ? '...' : `${emoji} ${data?.beslissing?.toUpperCase()}`}
          </p>
          <p className="text-gray-400 text-xs mt-1">{data?.reden}</p>
        </div>
        <div className="text-right">
          <p className="text-gray-400 text-xs mb-1">Consumentenprijs</p>
          <p className="text-2xl font-bold text-white">
            {data?.prijs != null ? `€${data.prijs.toFixed(4)}` : '—'}
          </p>
          <p className="text-gray-500 text-xs">
            EPEX spot: {data?.spotprijs != null ? `€${data.spotprijs.toFixed(4)}` : '—'}
          </p>
          <p className="text-gray-400 text-xs mt-1">
            Batterij: {data?.batterijPct != null ? `${data.batterijPct}%` : '—'}
          </p>
        </div>
      </div>

      {/* Drempels */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { l: 'Ontladen boven', v: `€${data?.drempels?.ontladen ?? 0.25}`, c: 'text-green-400' },
          { l: 'Laden onder',    v: `€${data?.drempels?.laden ?? 0.05}`,    c: 'text-blue-400' },
          { l: 'Bat. minimum',   v: `${data?.drempels?.batMin ?? 10}%`,     c: 'text-red-400' },
          { l: 'Bat. maximum',   v: `${data?.drempels?.batMax ?? 90}%`,     c: 'text-yellow-400' },
        ].map(d => (
          <div key={d.l} className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">{d.l}</p>
            <p className={`text-lg font-bold ${d.c}`}>{d.v}</p>
          </div>
        ))}
      </div>

      {/* TenneT onbalansprijzen */}
      {data?.tennet && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">TenneT shortage</p>
            <p className="text-lg font-bold text-orange-400">€{data.tennet.shortage.toFixed(4)}</p>
            <p className="text-gray-600 text-xs">grid tekort → verkoop prijs</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">TenneT surplus</p>
            <p className="text-lg font-bold text-cyan-400">€{data.tennet.surplus.toFixed(4)}</p>
            <p className="text-gray-600 text-xs">grid overschot → inkoop prijs</p>
          </div>
        </div>
      )}

      {/* Prijsgrafiek vandaag */}
      {data?.prijzenVandaag?.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">Prijzen vandaag (incl. BTW + opslag)</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data.prijzenVandaag}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="tijd" tick={{ fontSize: 9, fill: '#9CA3AF' }} interval={3} />
              <YAxis
                tick={{ fontSize: 9, fill: '#9CA3AF' }}
                tickFormatter={v => `€${v.toFixed(2)}`}
                domain={[
                  dataMin => Math.min(dataMin, data.drempels?.laden ?? 0.05) - 0.02,
                  dataMax => Math.max(dataMax, data.drempels?.ontladen ?? 0.25) + 0.02,
                ]}
              />
              <Tooltip
                formatter={(v, name) => [`€${v.toFixed(4)}`, name === 'prijs' ? 'Consumentenprijs' : 'EPEX spot']}
                contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }}
                labelStyle={{ color: '#9CA3AF' }}
              />
              <ReferenceLine y={data.drempels?.ontladen ?? 0.25} stroke="#10B981" strokeDasharray="4 4" label={{ value: 'ontladen', fill: '#10B981', fontSize: 8, position: 'insideTopRight' }} />
              <ReferenceLine y={data.drempels?.laden ?? 0.05} stroke="#3B82F6" strokeDasharray="4 4" label={{ value: 'laden', fill: '#3B82F6', fontSize: 8, position: 'insideBottomRight' }} />
              {nu && (() => {
                // Afronden naar dichtstbijzijnde 15 min om te matchen met grafiekdata
                const [h, m] = nu.split(':').map(Number);
                const mm = Math.floor(m / 15) * 15;
                const nuGerond = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                return <ReferenceLine x={nuGerond} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: 'nu', fill: '#F59E0B', fontSize: 8 }} />;
              })()}
              <Line type="monotone" dataKey="prijs" stroke="#60A5FA" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-xs text-gray-600 mt-3">Ververst elke minuut · DESS blijft actief · alleen simulatie</p>
    </div>
  );
}

function P1Vergelijking() {
  const [maanden, setMaanden] = useState([]);
  const [open, setOpen]       = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // P1 data (2025) en Victron data (2026) parallel ophalen
        const [p1Res, vrmRes] = await Promise.all([
          fetch('/api/p1?secret=Nummer14!'),
          fetch('/api/energie?secret=Nummer14!'),
        ]);
        const p1Json  = await p1Res.json();
        const vrmJson = await vrmRes.json();

        const byMaand = {};

        // 2025 data uit P1
        if (p1Json.success) {
          p1Json.data.forEach(r => {
            const datum   = String(r.datum).slice(0,10);
            const maandNr = parseInt(datum.slice(5,7));
            const dag     = parseInt(datum.slice(8,10));
            if (!byMaand[maandNr]) byMaand[maandNr] = {};
            if (!byMaand[maandNr]["2025"]) byMaand[maandNr]["2025"] = {};
            byMaand[maandNr]["2025"][dag] = { imp: parseFloat(r.import_kwh) };
          });
        }

        // 2026 data uit Victron (energie_data)
        if (vrmJson.success && Array.isArray(vrmJson.data)) {
          vrmJson.data.forEach(r => {
            const datum   = String(r.datum).slice(0,10);
            const maandNr = parseInt(datum.slice(5,7));
            const dag     = parseInt(datum.slice(8,10));
            if (!byMaand[maandNr]) byMaand[maandNr] = {};
            if (!byMaand[maandNr]["2026"]) byMaand[maandNr]["2026"] = {};
            byMaand[maandNr]["2026"][dag] = { imp: parseFloat(r.net_import_kwh || 0) };
          });
        }

        const result = Object.entries(byMaand).sort(([a],[b]) => parseInt(a)-parseInt(b))
          .filter(([, jaren]) => jaren["2025"] && jaren["2026"])
          .map(([nr, jaren]) => {
            const n   = parseInt(nr);
            const j25 = jaren["2025"] || {}, j26 = jaren["2026"] || {};
            const dagen = Array.from(new Set([...Object.keys(j25),...Object.keys(j26)].map(Number))).sort((a,b)=>a-b);
            return {
              nr: n, label: MAAND_NAMEN[n-1], dagen, j25, j26,
              tot25imp: Object.values(j25).reduce((s,v)=>s+v.imp,0),
              tot26imp: Object.values(j26).reduce((s,v)=>s+v.imp,0),
            };
          });
        setMaanden(result);
      } catch(e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="bg-gray-800 rounded-xl p-5 mb-6 text-gray-500 text-sm">P1 data laden...</div>;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h2 className="font-semibold text-gray-200 mb-1">⚡ Netverbruik vergelijking</h2>
      <p className="text-xs text-gray-500 mb-4">2025 (zonder batterij) vs 2026 (met batterij) · vanaf 3 april</p>
      <div className="flex gap-4 text-xs text-gray-400 mb-3">
        <span>🔴 Import 2025 → <span className="text-green-400">Import 2026</span> · minder is beter</span>
      </div>
      {maanden.map(m => (
        <div key={m.nr} className="mb-2 border border-gray-700 rounded-lg overflow-hidden">
          <div
            onClick={() => setOpen(o => ({...o, [m.nr]: !o[m.nr]}))}
            className="flex justify-between items-center px-4 py-3 bg-gray-700 cursor-pointer hover:bg-gray-600 select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{open[m.nr] ? "▼" : "▶"}</span>
              <span className="text-sm font-medium text-gray-200 capitalize">{m.label}</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <span className="text-gray-400">
                Import: <span className="text-red-400">{m.tot25imp.toFixed(1)}</span> → <span className="text-green-400">{m.tot26imp.toFixed(1)}</span> kWh
              </span>
              {m.tot26imp > 0 && m.tot25imp > 0 && (
                <span className={`font-bold text-base ${m.tot26imp < m.tot25imp ? 'text-green-400' : 'text-red-400'}`}>
                  {m.tot26imp < m.tot25imp ? "▼" : "▲"} {Math.abs(m.tot26imp - m.tot25imp).toFixed(1)} kWh
                </span>
              )}
            </div>
          </div>
          {open[m.nr] && (
            <div className="px-4 pb-3 overflow-x-auto">
              <table className="w-full text-xs mt-2">
                                  <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 text-gray-500 font-normal">Dag</th>
                    <th className="text-right py-2 text-red-400 font-normal">Import 2025</th>
                    <th className="text-right py-2 text-green-400 font-normal">Import 2026</th>
                    <th className="text-right py-2 text-gray-400 font-normal">Verschil</th>
                  </tr>
                </thead>
                <tbody>
                  {m.dagen.map(dag => {
                    const d25 = m.j25[dag], d26 = m.j26[dag];
                    const verschil = d25 && d26 ? (d26.imp - d25.imp).toFixed(2) : null;
                    return (
                      <tr key={dag} className="border-b border-gray-700">
                        <td className="py-1 text-gray-400">{dag}</td>
                        <td className="py-1 text-right text-red-400">{d25 ? d25.imp.toFixed(2) : "—"}</td>
                        <td className="py-1 text-right text-green-400">{d26 ? d26.imp.toFixed(2) : "—"}</td>
                        <td className={`py-1 text-right font-medium ${verschil < 0 ? 'text-green-400' : verschil > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {verschil !== null ? (verschil > 0 ? "+" : "") + verschil : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProjectieCard({ label, value, sub, color }) {
  return (
    <div className="bg-gray-700 rounded-lg p-4 text-center">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-1">{sub}</p>
    </div>
  );
}

function InfoIcon({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-gray-500 hover:text-gray-300 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-10 top-full left-0 mt-2 w-56 bg-gray-700 text-gray-200 text-xs rounded-lg p-3 shadow-lg">
          {text}
          <button onClick={() => setOpen(false)} className="mt-2 text-gray-400 hover:text-white block">Sluiten ✕</button>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, sub, info }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-gray-800 rounded-xl p-4 md:p-5 relative">
      <div className="flex justify-between items-start mb-1">
        <p className="text-gray-400 text-xs">{label}</p>
        <button onClick={() => setOpen(!open)} className="text-gray-500 hover:text-gray-300 transition-colors ml-1 flex-shrink-0" aria-label="Info">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </button>
      </div>
      <p className={`text-xl md:text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
      {open && (
        <div className="absolute z-10 top-full left-0 mt-2 w-56 bg-gray-700 text-gray-200 text-xs rounded-lg p-3 shadow-lg">
          {info}
          <button onClick={() => setOpen(false)} className="mt-2 text-gray-400 hover:text-white block">Sluiten ✕</button>
        </div>
      )}
    </div>
  );
}

function LiveVandaag() {
  const [winst, setWinst]     = useState(null);
  const [tijd, setTijd]       = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchLive() {
    try {
      const res  = await fetch('/api/live?secret=Nummer14!');
      const data = await res.json();
      if (data.success) { setWinst(data.winst); setTijd(data.bijgewerkt); }
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    fetchLive();
    const iv = setInterval(fetchLive, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="bg-gradient-to-r from-green-900 to-emerald-800 rounded-xl p-5 mb-6 flex justify-between items-center">
      <div>
        <p className="text-green-300 text-sm font-medium">⚡ Vandaag (lopend)</p>
        <p className="text-3xl font-bold text-white mt-1">{loading ? '...' : `€${winst}`}</p>
        {tijd && <p className="text-green-400 text-xs mt-1">Bijgewerkt om {tijd} · ververst elke 15 min</p>}
      </div>
      <button onClick={fetchLive} className="bg-green-700 hover:bg-green-600 text-white text-sm px-3 py-2 rounded-lg transition-colors">
        🔄 Nu verversen
      </button>
    </div>
  );
}

function RefreshButton() {
  const [status, setStatus] = useState('idle');

  async function handleRefresh() {
    setStatus('loading');
    try {
      const res  = await fetch('/api/sync?secret=Nummer14!');
      const data = await res.json();
      if (data.success) { setStatus('done'); setTimeout(() => window.location.reload(), 1000); }
      else { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
    } catch { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); }
  }

  return (
    <button onClick={handleRefresh} disabled={status === 'loading'}
      className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {status === 'idle' && 'Ververs'}{status === 'loading' && 'Bezig...'}{status === 'done' && '✓ Klaar!'}{status === 'error' && '✕ Fout'}
    </button>
  );
}

function cumulatief(data) {
  let som = 0;
  return data.map(d => ({ datum: d.datum, cumulatief: +(som += parseFloat(d.winst_euro || 0)).toFixed(2) }));
}