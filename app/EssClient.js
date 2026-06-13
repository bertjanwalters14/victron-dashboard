'use client';
import { useState, useTransition } from 'react';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { setLaadVanNet, setKeepCharged } from './actions';

const KLEUR = { kopen: '#3b82f6', verkopen: '#22c55e', normaal: '#f59e0b', gratis: '#06b6d4' };

function modeColor(m) {
  m = m || '';
  if (m.startsWith('VERKOPEN')) return '#22c55e';
  if (m.startsWith('KOPEN') || m.startsWith('NEG')) return '#3b82f6';
  if (m.startsWith('VOL') || m.startsWith('BALANCEREN') || m.startsWith('ACCU VOL')) return '#f59e0b';
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
      <div style={{ color: '#a855f7' }}>SOC: {d.soc}%</div>
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

export default function EssClient({ status, forecast, bijgewerkt, laadVanNet, keepCharged }) {
  const data = (forecast || []).map(d => ({ ...d }));
  const nuUur = ('0' + new Date().getHours()).slice(-2) + ':00';   // huidig uur, bijv. "14:00"
  const dataMaxPv = Math.max(1, ...data.map(d => Number(d.pv) || 0)) * 1.15;   // kop voor de zonnelijn
  const s = status || {};
  const [aan, setAan] = useState(!!laadVanNet);
  const [vol, setVol] = useState(!!keepCharged);
  const [pending, startTransition] = useTransition();

  function toggleLaden() {
    const next = !aan;
    setAan(next);
    startTransition(() => setLaadVanNet(next));
  }

  function toggleVol() {
    const next = !vol;
    setVol(next);
    startTransition(() => setKeepCharged(next));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Terug naar dashboard</a>
        <h1 className="text-2xl md:text-3xl font-bold mb-1 mt-2">⚡ ESS Sturing (live)</h1>
        <p className="text-gray-500 text-xs mb-4">
          Laatste update: {bijgewerkt ? new Date(bijgewerkt).toLocaleString('nl-NL') : '—'}
        </p>

        <div className="flex items-center gap-3 mb-5 bg-gray-800 rounded-xl p-3">
          <button
            onClick={toggleLaden}
            disabled={pending}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${aan ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-600 hover:bg-gray-500'} ${pending ? 'opacity-60' : ''}`}
          >
            Laden uit net: {aan ? 'AAN' : 'UIT'}
          </button>
          <span className="text-xs text-gray-400">
            {aan ? '⚠️ Grid-arbitrage actief (koopt uit net op goedkope uren)' : 'Alleen PV-laden (saldering-vriendelijk)'}
          </span>
        </div>

        <div className="flex items-center gap-3 mb-5 bg-gray-800 rounded-xl p-3">
          <button
            onClick={toggleVol}
            disabled={pending}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${vol ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-gray-600 hover:bg-gray-500'} ${pending ? 'opacity-60' : ''}`}
          >
            Accu altijd vol: {vol ? 'AAN' : 'UIT'}
          </button>
          <span className="text-xs text-gray-400">
            {vol ? '🔋 Accu wordt vol gehouden (geen verkoop/ontlading) — handel gepauzeerd' : 'Normale handel/zelfverbruik'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
          <div className="rounded-xl p-4 text-white" style={{ background: modeColor(s.mode) }}>
            <div className="text-xs opacity-80">Modus</div>
            <div className="text-base font-bold leading-tight">{s.mode || '—'}</div>
          </div>
          <Card label="Accu SOC" value={s.soc != null ? `${s.soc}%` : '—'} />
          <Card label="Inkoop nu" value={s.buy != null ? `€${Number(s.buy).toFixed(3)}` : '—'} />
          <Card label="Teruglever nu" value={s.sell != null ? `€${Number(s.sell).toFixed(3)}` : '—'} />
          <Card label="Laatste 100% (balans)" value={s.balansDagen != null ? `${s.balansDagen} dgn geleden` : '—'} />
        </div>

        {s.balansDoel ? (
          <div className="flex items-center gap-2 mb-6 bg-amber-900/40 border border-amber-700 rounded-xl p-3 text-sm text-amber-200">
            🔋 Balancering nodig ({s.balansDagen} dagen geen 100%) — gepland op zonnigste dag: <b>{s.balansDoel}</b>
          </div>
        ) : <div className="mb-3" />}

        <div className="bg-gray-800 rounded-xl p-4 md:p-5">
          <h2 className="font-semibold text-gray-200 mb-3">📊 Voorspelling vandaag + morgen</h2>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="prijs" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis yAxisId="pv" hide domain={[0, dataMaxPv]} />
              <Tooltip content={<EssTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="prijs" x={nuUur} stroke="#ffffff" strokeDasharray="4 3" strokeOpacity={0.7}
                label={{ value: '▼ nu', position: 'top', fill: '#ffffff', fontSize: 11 }} />
              <Bar yAxisId="prijs" dataKey="prijs" name="Prijs all-in (€)" maxBarSize={16} radius={[3, 3, 0, 0]} fillOpacity={0.9}>
                {data.map((d, i) => (
                  <Cell key={i} fill={KLEUR[d.cat] || '#f59e0b'}
                    stroke={d.uur === nuUur ? '#ffffff' : 'none'} strokeWidth={d.uur === nuUur ? 2 : 0}
                    fillOpacity={d.uur === nuUur ? 1 : 0.9} />
                ))}
              </Bar>
              <Line yAxisId="pv" type="monotone" dataKey="pv" name="Zon (kWh)" stroke="#fde047" dot={false} strokeWidth={2} strokeDasharray="5 3" />
              <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC %" stroke="#a855f7" dot={false} strokeWidth={2.5} />
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
