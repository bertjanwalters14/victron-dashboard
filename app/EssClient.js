'use client';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const KLEUR = { kopen: '#3b82f6', verkopen: '#22c55e', normaal: '#f59e0b', gratis: '#06b6d4' };

function modeColor(m) {
  m = m || '';
  if (m.startsWith('VERKOPEN')) return '#22c55e';
  if (m.startsWith('KOPEN') || m.startsWith('NEG')) return '#3b82f6';
  if (m.startsWith('VOL')) return '#f59e0b';
  return '#64748b';
}

const CAT_LABEL = { kopen: 'Kopen', verkopen: 'Verkopen', normaal: 'Zelfverbruik', gratis: 'Gratis laden (negatief)' };

function EssTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '8px 11px', color: '#fff', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{d.uur}</div>
      <div>Prijs all-in: <b>€{Number(d.prijs).toFixed(3)}</b></div>
      <div style={{ color: '#fde047' }}>Zon: {Number(d.pv).toFixed(1)} kWh</div>
      <div style={{ color: '#22c55e' }}>SOC: {d.soc}%</div>
      <div style={{ color: '#9ca3af', marginTop: 2 }}>{CAT_LABEL[d.cat] || d.cat}</div>
    </div>
  );
}

function Card({ label, value }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

export default function EssClient({ status, forecast, bijgewerkt }) {
  const data = (forecast || []).map(d => ({ ...d }));
  const s = status || {};

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Terug naar dashboard</a>
        <h1 className="text-2xl md:text-3xl font-bold mb-1 mt-2">⚡ ESS Sturing (live)</h1>
        <p className="text-gray-500 text-xs mb-5">
          Laatste update: {bijgewerkt ? new Date(bijgewerkt).toLocaleString('nl-NL') : '—'}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl p-4 text-white" style={{ background: modeColor(s.mode) }}>
            <div className="text-xs opacity-80">Modus</div>
            <div className="text-base font-bold leading-tight">{s.mode || '—'}</div>
          </div>
          <Card label="Accu SOC" value={s.soc != null ? `${s.soc}%` : '—'} />
          <Card label="Inkoop nu" value={s.buy != null ? `€${Number(s.buy).toFixed(3)}` : '—'} />
          <Card label="Teruglever nu" value={s.sell != null ? `€${Number(s.sell).toFixed(3)}` : '—'} />
        </div>

        <div className="bg-gray-800 rounded-xl p-4 md:p-5">
          <h2 className="font-semibold text-gray-200 mb-3">📊 Voorspelling vandaag + morgen</h2>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="prijs" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<EssTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="prijs" dataKey="prijs" name="Prijs all-in (€)">
                {data.map((d, i) => <Cell key={i} fill={KLEUR[d.cat] || '#f59e0b'} />)}
              </Bar>
              <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC %" stroke="#16a34a" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2">
            <span style={{ color: '#3b82f6' }}>■</span> kopen ·
            <span style={{ color: '#22c55e' }}> ■</span> verkopen ·
            <span style={{ color: '#f59e0b' }}> ■</span> normaal ·
            <span style={{ color: '#06b6d4' }}> ■</span> gratis (negatief)
          </p>
        </div>
      </div>
    </main>
  );
}
