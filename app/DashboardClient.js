'use client';
import { useState, useEffect } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

const BATTERIJ_KOSTEN   = 11252;
const INSTALLATIE_DATUM = new Date('2026-04-04');
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
            <p className="text-gray-400 mt-1">Installatie: 4 april 2026 · Investering: €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')} <span className="text-green-600 text-xs">(incl. BTW teruggave)</span></p>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

        <ImportExportWidget data={data} />

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
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
            <div className="h-16 flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
          )}
        </div>

        <ZonTegel energieData={data} />

        <p className="text-center text-gray-600 text-xs mt-6">
          Data wordt elke nacht om 00:01 automatisch bijgewerkt
        </p>
      </div>
    </main>
  );
}

function ZonTegel({ energieData = [] }) {
  const [zon,     setZon]     = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchZon() {
    try {
      const res  = await fetch(`/api/solcast?secret=Nummer14!`);
      const json = await res.json();
      if (json.success) setZon({
        vandaagKwh:           json.vandaagKwh,
        vandaagGemeten:       json.vandaagGeproduceerdKwh ?? null,
        morgenKwh:            json.morgenKwh,
        grafiekData:          json.grafiekData || [],
        estimatedActualsDagen: json.estimatedActualsDagen || [],
      });
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => {
    fetchZon();
    const iv = setInterval(fetchZon, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <p className="text-gray-500 text-sm">☀️ Zonneprognose laden…</p>
    </div>
  );

  if (!zon) return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <p className="text-gray-500 text-sm text-center py-4">Geen zonneprognose beschikbaar</p>
    </div>
  );

  // Bouw vergelijkingsdata: Solcast satellite vs VRM actuals
  const vrmMap = Object.fromEntries(
    energieData.map(d => [d.datum, +parseFloat(d.solar_yield_kwh || 0).toFixed(2)])
  );
  const vergelijkData = zon.estimatedActualsDagen
    .map(d => ({
      dag:      d.datum.slice(5),           // MM-DD
      datum:    d.datum,
      solcast:  d.kwh,
      vrm:      vrmMap[d.datum] ?? null,
    }))
    .filter(d => d.vrm !== null);           // alleen dagen met VRM data

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6 space-y-5">
      <ZonPrognose zon={zon} />
      {vergelijkData.length > 0 && <ZonVergelijk data={vergelijkData} />}
    </div>
  );
}

// ── Solcast vs VRM vergelijkingsgrafiek ──────────────────────────────────────
function ZonVergelijk({ data }) {
  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const diff = d.vrm != null && d.solcast > 0
      ? Math.round((d.vrm / d.solcast - 1) * 100)
      : null;
    return (
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F9FAFB', minWidth: 170 }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>{d.datum}</p>
        <p style={{ color: '#FB923C' }}>Solcast schatting: <strong>{d.solcast} kWh</strong></p>
        {d.vrm != null && <p style={{ color: '#34D399' }}>VRM werkelijk: <strong>{d.vrm} kWh</strong></p>}
        {diff != null && (
          <p style={{ color: diff >= 0 ? '#34D399' : '#F87171', marginTop: 4 }}>
            {diff >= 0 ? `+${diff}%` : `${diff}%`} t.o.v. voorspelling
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="border-t border-gray-700 pt-4">
      <div className="flex flex-wrap justify-between items-baseline gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-200">📊 Voorspelling vs werkelijkheid</p>
        <div className="flex gap-4 text-xs text-gray-400">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-orange-400"/>Solcast schatting</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500"/>VRM werkelijk</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="dag" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
          <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} width={30} unit=" kWh" />
          <Tooltip content={tip} />
          <Bar dataKey="solcast" name="Solcast" radius={[2,2,0,0]} fill="#FB923C" isAnimationActive={false} />
          <Bar dataKey="vrm"     name="VRM"     radius={[2,2,0,0]} fill="#10B981" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-600 mt-1">Solcast = satellietschatting · VRM = gemeten opbrengst · alleen volledige dagen</p>
    </div>
  );
}

function ZonPrognose({ zon }) {
  if (!zon) return null;

  // Vandaag gevolgd door morgen op één doorlopende tijdas
  const asAnkers = ['00:00','03:00','06:00','09:00','12:00','15:00','18:00','21:00','23:30'];
  const bouwData = (data, prefix) => {
    const punten = Object.fromEntries(data.filter(d => d.dag === (prefix === 'V' ? 'vandaag' : 'morgen')).map(d => [d.tijd, d.watt]));
    // Voeg ankers toe zodat de X-as altijd de volle dag toont
    asAnkers.forEach(t => { if (!(t in punten)) punten[t] = 0; });
    return Object.entries(punten).sort(([a],[b]) => a.localeCompare(b)).map(([t, watt]) => ({ label: `${prefix} ${t}`, watt, dag: prefix === 'V' ? 'vandaag' : 'morgen' }));
  };
  const aaneengesloten = [...bouwData(zon.grafiekData || [], 'V'), ...bouwData(zon.grafiekData || [], 'M')];

  return (
    <div className="border-t border-gray-700 pt-4 space-y-3">
      {/* Header + totalen */}
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-200">☀️ Zonneprognose</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-1 text-gray-500"><span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />Vandaag&nbsp;<span className="text-amber-400 font-semibold">{zon.vandaagKwh} kWh</span></span>
          <span className="text-gray-500">Gemeten&nbsp;<span className="text-green-400 font-semibold">{zon.vandaagGemeten != null ? `${zon.vandaagGemeten} kWh` : '—'}</span></span>
          <span className="flex items-center gap-1 text-gray-500"><span className="inline-block w-3 h-3 rounded-sm bg-orange-400" />Morgen&nbsp;<span className="text-orange-400 font-semibold">{zon.morgenKwh} kWh</span></span>
        </div>
      </div>

      {/* Doorlopende grafiek: vandaag → morgen, gedeelde Y-as */}
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={aaneengesloten} barCategoryGap="10%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#6B7280' }}
            ticks={['V 00:00','V 03:00','V 06:00','V 09:00','V 12:00','V 15:00','V 18:00','V 21:00','M 00:00','M 03:00','M 06:00','M 09:00','M 12:00','M 15:00','M 18:00','M 21:00']}
            tickFormatter={v => v.slice(2)} />
          <YAxis tick={{ fontSize: 9, fill: '#6B7280' }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} width={28} />
          <Tooltip
            contentStyle={{ background: '#1F2937', border: '1px solid #4B5563', borderRadius: '8px', fontSize: 12, color: '#F9FAFB' }}
            labelStyle={{ color: '#D1D5DB', fontWeight: 600, marginBottom: 2 }}
            itemStyle={{ color: '#FCD34D' }}
            labelFormatter={l => `${l.startsWith('V') ? 'Vandaag' : 'Morgen'} ${l.slice(2)}`}
            formatter={v => [v >= 1000 ? `${(v/1000).toFixed(2)} kW` : `${Math.round(v)} W`]}
          />
          <ReferenceLine x={`M 00:00`} stroke="#4B5563" strokeDasharray="4 2" label={{ value: 'morgen', position: 'insideTopRight', fontSize: 9, fill: '#6B7280' }} />
          <Bar dataKey="watt" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {aaneengesloten.map((d, i) => (
              <Cell key={i} fill={d.dag === 'vandaag' ? '#F59E0B' : '#FB923C'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-xs text-gray-600">📍 Harkstede · 18 × 370Wp · Zuid 0° · 35° helling · Solcast</p>
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

// P1 slimme meter data 2025 (zonder batterij)
const P1_2025 = [
  { maand: 'jan', imp: 810, exp: 76  },
  { maand: 'feb', imp: 650, exp: 224 },
  { maand: 'mrt', imp: 325, exp: 692 },
  { maand: 'apr', imp: 201, exp: 713 },
  { maand: 'mei', imp: 150, exp: 744 },
  { maand: 'jun', imp: 126, exp: 615 },
  { maand: 'jul', imp: 124, exp: 574 },
  { maand: 'aug', imp: 114, exp: 698 },
  { maand: 'sep', imp: 166, exp: 534 },
  { maand: 'okt', imp: 284, exp: 283 },
  { maand: 'nov', imp: 474, exp: 147 },
  { maand: 'dec', imp: 651, exp: 64  },
];

// Alle maanden van 2026-01 t/m huidige maand
function alleMaandenTotNu() {
  const now = new Date();
  const result = [];
  let jaar = 2026, m = 1;
  while (jaar < now.getFullYear() || (jaar === now.getFullYear() && m <= now.getMonth() + 1)) {
    result.push(`${jaar}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; jaar++; }
  }
  return result;
}
const ALLE_MAANDEN = alleMaandenTotNu();

function ImportExportWidget({ data }) {
  const [view, setView] = useState('jaar');

  const huidigeMaand = new Date().toISOString().slice(0, 7);
  const [selectedMaand, setSelectedMaand] = useState(huidigeMaand);
  const [selectedDag,   setSelectedDag]   = useState(new Date().toISOString().slice(0, 10));

  const maandIdx = ALLE_MAANDEN.indexOf(selectedMaand);

  function openDag(datum) { setSelectedDag(datum); setView('dag'); }

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-200">📊 Import &amp; Export</h2>
        <div className="flex gap-1">
          {['jaar', 'maand', 'dag'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                ${view === v ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view === 'jaar' && <JaarView data={data} />}
      {view === 'maand' && (
        <MaandView
          data={data}
          selectedMaand={selectedMaand}
          setSelectedMaand={setSelectedMaand}
          maandIdx={maandIdx}
          onDagClick={openDag}
        />
      )}
      {view === 'dag' && (
        <DagView
          data={data}
          selectedDag={selectedDag}
          setSelectedDag={setSelectedDag}
        />
      )}
    </div>
  );
}

// ── Jaaroverzicht: maandelijkse import/export 2025 vs 2026 ──────────────────
function JaarView({ data }) {
  const act = {};
  for (const d of data) {
    const key = MAAND_NAMEN[new Date(d.datum).getMonth()];
    if (!act[key]) act[key] = { imp: 0, exp: 0 };
    act[key].imp += parseFloat(d.net_import_kwh || 0);
    act[key].exp += parseFloat(d.net_export_kwh || 0);
  }
  const chartData = P1_2025.map(m => ({
    maand: m.maand, imp25: m.imp, exp25: m.exp,
    imp26: act[m.maand] ? +act[m.maand].imp.toFixed(0) : null,
    exp26: act[m.maand] ? +act[m.maand].exp.toFixed(0) : null,
  }));
  const maanden26 = P1_2025.filter(m => act[m.maand]);
  const totImp25 = maanden26.reduce((s, m) => s + m.imp, 0);
  const totExp25 = maanden26.reduce((s, m) => s + m.exp, 0);
  const totImp26 = maanden26.reduce((s, m) => s + (act[m.maand]?.imp || 0), 0);
  const totExp26 = maanden26.reduce((s, m) => s + (act[m.maand]?.exp || 0), 0);
  const impRed = totImp25 > 0 ? Math.round((1 - totImp26 / totImp25) * 100) : null;
  const expRed = totExp25 > 0 ? Math.round((1 - totExp26 / totExp25) * 100) : null;
  const heeft26 = maanden26.length > 0;

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const m = payload[0].payload;
    return (
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F9FAFB', minWidth: 180 }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>{m.maand}</p>
        <p style={{ color: '#94A3B8' }}>Import 2025: <strong>{m.imp25} kWh</strong></p>
        {m.imp26 != null && <p style={{ color: '#60A5FA' }}>Import 2026: <strong>{m.imp26} kWh</strong>
          {m.imp25 > 0 && <span style={{ color: '#34D399', marginLeft: 6 }}>−{Math.round((1 - m.imp26/m.imp25)*100)}%</span>}
        </p>}
        <p style={{ color: '#94A3B8', marginTop: 4 }}>Export 2025: <strong>{m.exp25} kWh</strong></p>
        {m.exp26 != null && <p style={{ color: '#34D399' }}>Export 2026: <strong>{m.exp26} kWh</strong>
          {m.exp25 > 0 && <span style={{ color: '#F59E0B', marginLeft: 6 }}>{m.exp26 >= m.exp25 ? '+' : '−'}{Math.abs(Math.round((1 - m.exp26/m.exp25)*100))}%</span>}
        </p>}
      </div>
    );
  };

  return (
    <>
      <p className="text-xs text-gray-500 mb-4">Maandtotalen — 2025 (zonder batterij) vs 2026 (met batterij)</p>
      {heeft26 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Import 2025</p>
            <p className="text-lg font-bold text-slate-300">{Math.round(totImp25)} kWh</p>
            <p className="text-xs text-gray-500 mt-0.5">dezelfde maanden</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Import 2026</p>
            <p className="text-lg font-bold text-blue-400">{Math.round(totImp26)} kWh</p>
            {impRed != null && <p className="text-xs text-emerald-400 mt-0.5">−{impRed}% minder van net</p>}
          </div>
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Export 2025</p>
            <p className="text-lg font-bold text-slate-300">{Math.round(totExp25)} kWh</p>
            <p className="text-xs text-gray-500 mt-0.5">dezelfde maanden</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 mb-1">Export 2026</p>
            <p className="text-lg font-bold text-emerald-400">{Math.round(totExp26)} kWh</p>
            {expRed != null && <p className="text-xs text-gray-400 mt-0.5">{expRed > 0 ? `−${expRed}%` : `+${Math.abs(expRed)}%`} vs 2025</p>}
          </div>
        </div>
      ) : (
        <p className="text-xs text-yellow-500 mb-4">⚠️ Nog geen 2026-data — wordt gevuld na backfill op 1 mei</p>
      )}
      <div className="flex flex-wrap gap-4 mb-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-slate-500"/>Import 2025</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500"/>Import 2026</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-gray-400"/>Export 2025</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500"/>Export 2026</span>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="15%" barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="maand" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
          <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} width={36} unit=" kWh" />
          <Tooltip content={tip} />
          <Bar dataKey="imp25" radius={[2,2,0,0]} fill="#64748B" isAnimationActive={false} />
          <Bar dataKey="imp26" radius={[2,2,0,0]} fill="#3B82F6" isAnimationActive={false} />
          <Bar dataKey="exp25" radius={[2,2,0,0]} fill="#9CA3AF" isAnimationActive={false} />
          <Bar dataKey="exp26" radius={[2,2,0,0]} fill="#10B981" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-600 mt-2">2025 = P1 slimme meter · 2026 = Victron VRM · Import = van net · Export = teruggeleverd</p>
    </>
  );
}

// ── Maandoverzicht: dagelijkse import/export voor één maand ──────────────────
function MaandView({ data, selectedMaand, setSelectedMaand, maandIdx, onDagClick }) {
  const maandData = data
    .filter(d => d.datum.startsWith(selectedMaand))
    .map(d => ({
      dag:   parseInt(d.datum.slice(8), 10),
      datum: d.datum,
      imp:   +parseFloat(d.net_import_kwh || 0).toFixed(2),
      exp:   +parseFloat(d.net_export_kwh || 0).toFixed(2),
      zon:   +parseFloat(d.solar_yield_kwh || 0).toFixed(2),
      winst: +parseFloat(d.winst_euro || 0).toFixed(2),
    }));

  const [jaar, maandNr] = selectedMaand.split('-');
  const maandLabel = `${MAAND_NAMEN[parseInt(maandNr, 10) - 1]} ${jaar}`;
  const totImp = maandData.reduce((s, d) => s + d.imp, 0).toFixed(1);
  const totExp = maandData.reduce((s, d) => s + d.exp, 0).toFixed(1);

  const tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F9FAFB' }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>{d.datum}</p>
        <p style={{ color: '#60A5FA' }}>Import: <strong>{d.imp} kWh</strong></p>
        <p style={{ color: '#10B981' }}>Export: <strong>{d.exp} kWh</strong></p>
        <p style={{ color: '#FBBF24' }}>Zon: <strong>{d.zon} kWh</strong></p>
        <p style={{ color: '#34D399', marginTop: 4 }}>Winst: <strong>€{d.winst}</strong></p>
        <p style={{ color: '#6B7280', marginTop: 4, fontSize: 11 }}>Klik voor dagdetail →</p>
      </div>
    );
  };

  return (
    <>
      {/* Navigatie — door alle maanden van 2026-01 t/m nu */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setSelectedMaand(ALLE_MAANDEN[maandIdx - 1])} disabled={maandIdx <= 0}
          className="px-2 py-1 rounded bg-gray-700 text-gray-300 disabled:opacity-30 hover:bg-gray-600 text-sm">‹</button>
        <div className="text-center">
          <select
            value={selectedMaand}
            onChange={e => setSelectedMaand(e.target.value)}
            className="bg-gray-700 text-gray-200 text-sm font-semibold rounded px-2 py-1 border border-gray-600 focus:outline-none"
          >
            {ALLE_MAANDEN.map(m => {
              const [j, mn] = m.split('-');
              return <option key={m} value={m}>{MAAND_NAMEN[parseInt(mn,10)-1]} {j}</option>;
            })}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            {maandData.length > 0 ? `${maandData.length} dagen · imp ${totImp} kWh · exp ${totExp} kWh` : 'geen data'}
          </p>
        </div>
        <button onClick={() => setSelectedMaand(ALLE_MAANDEN[maandIdx + 1])} disabled={maandIdx >= ALLE_MAANDEN.length - 1}
          className="px-2 py-1 rounded bg-gray-700 text-gray-300 disabled:opacity-30 hover:bg-gray-600 text-sm">›</button>
      </div>

      {maandData.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-10">Geen data beschikbaar voor {maandLabel}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 mb-3 text-xs text-gray-400">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500"/>Import</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500"/>Export</span>
            <span className="text-gray-600 ml-auto">Klik op een dag voor detail</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={maandData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}
              onClick={e => e?.activePayload?.[0] && onDagClick(e.activePayload[0].payload.datum)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="dag" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} width={36} unit=" kWh" />
              <Tooltip content={tip} />
              <Bar dataKey="imp" radius={[2,2,0,0]} fill="#3B82F6" isAnimationActive={false} cursor="pointer" />
              <Bar dataKey="exp" radius={[2,2,0,0]} fill="#10B981" isAnimationActive={false} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </>
  );
}

// ── Dagdetail: KPI-kaartjes voor één dag ─────────────────────────────────────
function DagView({ data, selectedDag, setSelectedDag }) {
  const dagMap = Object.fromEntries(data.map(d => [d.datum, d]));
  const dag = dagMap[selectedDag] ?? null;

  const vandaag = new Date().toISOString().slice(0, 10);
  const vroegste = '2026-01-01';

  function nav(delta) {
    const d = new Date(selectedDag);
    d.setDate(d.getDate() + delta);
    const nieuw = d.toISOString().slice(0, 10);
    if (nieuw >= vroegste && nieuw <= vandaag) setSelectedDag(nieuw);
  }

  const fmt = iso => new Date(iso).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      {/* Navigatie met datumkiezer */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => nav(-1)} disabled={selectedDag <= vroegste}
          className="px-2 py-1 rounded bg-gray-700 text-gray-300 disabled:opacity-30 hover:bg-gray-600 text-sm">‹</button>
        <div className="text-center">
          <input
            type="date"
            value={selectedDag ?? ''}
            min={vroegste}
            max={vandaag}
            onChange={e => e.target.value && setSelectedDag(e.target.value)}
            className="bg-gray-700 text-gray-200 text-sm font-semibold rounded px-2 py-1 border border-gray-600 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1 capitalize">{selectedDag ? fmt(selectedDag) : ''}</p>
        </div>
        <button onClick={() => nav(1)} disabled={selectedDag >= vandaag}
          className="px-2 py-1 rounded bg-gray-700 text-gray-300 disabled:opacity-30 hover:bg-gray-600 text-sm">›</button>
      </div>

      {!dag ? (
        <p className="text-gray-500 text-sm text-center py-8">Geen data beschikbaar voor deze dag</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-700 rounded-xl p-4 text-center">
            <p className="text-xs text-amber-400 mb-1">☀️ Zonproductie</p>
            <p className="text-2xl font-bold text-amber-300">{parseFloat(dag.solar_yield_kwh || 0).toFixed(1)}</p>
            <p className="text-xs text-gray-500 mt-0.5">kWh</p>
          </div>
          <div className="bg-gray-700 rounded-xl p-4 text-center">
            <p className="text-xs text-blue-400 mb-1">⬇️ Import</p>
            <p className="text-2xl font-bold text-blue-300">{parseFloat(dag.net_import_kwh || 0).toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-0.5">kWh van net</p>
          </div>
          <div className="bg-gray-700 rounded-xl p-4 text-center">
            <p className="text-xs text-emerald-400 mb-1">⬆️ Export</p>
            <p className="text-2xl font-bold text-emerald-300">{parseFloat(dag.net_export_kwh || 0).toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-0.5">kWh naar net</p>
          </div>
          <div className="bg-gray-700 rounded-xl p-4 text-center">
            <p className="text-xs text-green-400 mb-1">💶 Batterijwinst</p>
            <p className="text-2xl font-bold text-green-300">€{parseFloat(dag.winst_euro || 0).toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-0.5">die dag</p>
          </div>
          {dag.verbruik_kwh != null && (
            <div className="bg-gray-700 rounded-xl p-4 text-center sm:col-span-2">
              <p className="text-xs text-gray-400 mb-1">🏠 Totaalverbruik</p>
              <p className="text-2xl font-bold text-white">{parseFloat(dag.verbruik_kwh).toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-0.5">kWh</p>
            </div>
          )}
          {dag.bat_meerwaarde != null && (
            <div className="bg-gray-700 rounded-xl p-4 text-center sm:col-span-2">
              <p className="text-xs text-purple-400 mb-1">🔋 Batterij meerwaarde</p>
              <p className="text-2xl font-bold text-purple-300">€{parseFloat(dag.bat_meerwaarde).toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-0.5">t.o.v. zonder batterij</p>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-gray-600 mt-4">Gebruik ‹ › om door de dagen te navigeren</p>
    </>
  );
}

