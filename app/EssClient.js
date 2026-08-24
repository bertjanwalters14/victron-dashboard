'use client';
import { useState, useTransition } from 'react';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { setLaadVanNet, setKeepCharged, setVerkoopPauze, setSchedule, setReserveSoc } from './actions';

const KLEUR = { kopen: '#3b82f6', verkopen: '#22c55e', normaal: '#f59e0b', gratis: '#06b6d4', pvnet: '#c084fc' };

function modeColor(m) {
  m = m || '';
  if (m.startsWith('VERKOPEN')) return '#22c55e';
  if (m.startsWith('KOPEN') || m.startsWith('NEG')) return '#3b82f6';
  if (m.startsWith('VOL') || m.startsWith('BALANCEREN') || m.startsWith('ACCU VOL')) return '#f59e0b';
  return '#64748b';
}

const CAT_LABEL = { kopen: 'Kopen', verkopen: 'Verkopen', normaal: 'Zelfverbruik', gratis: 'Gratis laden (negatief)', pvnet: 'PV → net (accu vol)' };

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

// Compacte batterij-indicator (telefoon-stijl) voor de SOC, met kleur op ladingsniveau.
function BatteryBadge({ pct }) {
  const p = pct != null ? Math.max(0, Math.min(100, Math.round(pct))) : null;
  const color = p == null ? '#6b7280' : p < 20 ? '#ef4444' : p < 50 ? '#f59e0b' : '#22c55e';
  return (
    <div className="flex items-center gap-1.5" title="Accu SOC">
      <div className="relative w-7 h-3.5 border-2 border-gray-400 rounded-[2px] p-0.5">
        <div className="h-full rounded-[1px]" style={{ width: p != null ? `${Math.max(8, p)}%` : '0%', background: color }} />
        <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 w-[2px] h-[6px] bg-gray-400 rounded-r-sm" />
      </div>
      <span className="text-sm font-semibold">{p != null ? `${p}%` : '—'}</span>
    </div>
  );
}

// Compact 24-uurs-balkje: laat het [start, end)-venster in één oogopslag zien.
// Loopt het venster over midnacht (bv. 22:00-06:00), dan toont het twee stukjes.
function DayBlock({ start, end }) {
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const s = toMin(start), e = toMin(end);
  const pct = (min) => (min / 1440) * 100;
  const segments = s <= e
    ? [{ left: pct(s), width: pct(e) - pct(s) }]
    : [{ left: pct(s), width: pct(1440) - pct(s) }, { left: 0, width: pct(e) }];
  return (
    <div className="relative w-36 h-3.5 bg-gray-700 rounded overflow-hidden shrink-0" title={`${start} – ${end}`}>
      {segments.map((seg, i) => (
        <div key={i} className="absolute inset-y-0 bg-emerald-500" style={{ left: `${seg.left}%`, width: `${seg.width}%` }} />
      ))}
    </div>
  );
}

// Kleine dropdown die over de kaart heen zweeft (absolute) i.p.v. de pagina naar onder te duwen.
// De trigger blijft altijd zichtbaar zodat een actief schema/afwijkende bodem in één oogopslag
// te zien is, zonder dat je hoeft te klikken.
function Dropdown({ trigger, open, onToggle, children }) {
  return (
    <div className="relative">
      <button type="button" onClick={onToggle}
        className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1">
        {trigger}
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl text-xs text-gray-300">
          {children}
        </div>
      )}
    </div>
  );
}

// Tijdschema-dropdown onder een knop: zet de knop automatisch AAN binnen [start, end); buiten dat
// venster geldt gewoon de handmatige stand van de knop erboven. De trigger toont het venster zelf
// (bv. "12:00–18:00") als het schema aan staat, dus je ziet dat al zonder open te klikken.
function ScheduleEditor({ scheduleKey, initial }) {
  const [cfg, setCfg] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function update(patch) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    startTransition(() => setSchedule(scheduleKey, next));
  }

  return (
    <Dropdown open={open} onToggle={() => setOpen(o => !o)}
      trigger={<>⏰ {cfg.enabled ? `${cfg.start}–${cfg.end}` : 'Schema'}</>}>
      <label className="flex items-center gap-1.5 cursor-pointer mb-2">
        <input type="checkbox" checked={cfg.enabled} onChange={e => update({ enabled: e.target.checked })} />
        Automatisch AAN van
      </label>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="time" value={cfg.start} disabled={!cfg.enabled}
          onChange={e => update({ start: e.target.value })}
          className="bg-gray-700 rounded px-1.5 py-0.5 text-white disabled:opacity-40 w-full"
        />
        <span>tot</span>
        <input
          type="time" value={cfg.end} disabled={!cfg.enabled}
          onChange={e => update({ end: e.target.value })}
          className="bg-gray-700 rounded px-1.5 py-0.5 text-white disabled:opacity-40 w-full"
        />
      </div>
      {cfg.enabled && <DayBlock start={cfg.start} end={cfg.end} />}
      <div className="flex items-center justify-between mt-2">
        {pending && <span className="opacity-60">opslaan…</span>}
        <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 ml-auto">Sluiten</button>
      </div>
    </Dropdown>
  );
}

// Verkoop-bodem (RESERVE_SOC): normaal 25%, lager tijdens bv. vakantie (minder huisverbruik nodig als
// nachtbuffer, dus mag de accu verder doorverkopen). Sleepbalk committeert pas bij loslaten (niet per
// pixel tijdens het slepen) om de DB niet met een schrijf-per-frame te bestoken.
function ReserveEditor({ initial }) {
  const [pct, setPct] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const commit = (v) => startTransition(() => setReserveSoc(v));

  return (
    <Dropdown open={open} onToggle={() => setOpen(o => !o)} trigger={<>🔋 {pct}%</>}>
      <div className="text-sm font-semibold text-white mb-1">Verkoop-bodem: {pct}%</div>
      <input
        type="range" min={10} max={40} step={1} value={pct}
        onChange={e => setPct(Number(e.target.value))}
        onMouseUp={e => commit(Number(e.target.value))}
        onTouchEnd={e => commit(Number(e.target.value))}
        onKeyUp={e => commit(Number(e.target.value))}
        className="w-full accent-emerald-500 mb-1"
      />
      <div>Normaal 25% — lager (bv. vakantie) verkoopt verder door, hoger houdt meer buffer aan</div>
      <div className="flex items-center justify-between mt-2">
        {pending && <span className="opacity-60">opslaan…</span>}
        <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 ml-auto">Sluiten</button>
      </div>
    </Dropdown>
  );
}

export default function EssClient({ status, forecast, bijgewerkt, laadVanNet, keepCharged, verkoopPauze, laadVanNetSchedule, keepChargedSchedule, verkoopPauzeSchedule, reserveSoc }) {
  const alle = (forecast || []).map(d => ({ ...d }));
  const nuUur = ('0' + new Date().getHours()).slice(-2) + ':00';   // huidig uur, bijv. "14:00"
  const s = status || {};
  const [aan, setAan] = useState(!!laadVanNet);
  const [vol, setVol] = useState(!!keepCharged);
  const [pauze, setPauze] = useState(!!verkoopPauze);
  const [dag, setDag] = useState('vandaag');   // 'vandaag' | 'morgen' | 'alles'
  const [pending, startTransition] = useTransition();

  const heeftMorgen = alle.some(d => String(d.uur).startsWith('+1'));
  const data = alle.filter(d => {
    const morgen = String(d.uur).startsWith('+1');
    if (dag === 'vandaag') return !morgen;
    if (dag === 'morgen') return morgen;
    return true;
  });
  const dataMaxPv = Math.max(1, ...data.map(d => Number(d.pv) || 0)) * 1.15;   // kop voor de zonnelijn

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

  function togglePauze() {
    const next = !pauze;
    setPauze(next);
    startTransition(() => setVerkoopPauze(next));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <a href="/" className="text-sm text-blue-400 hover:text-blue-300">← Terug naar dashboard</a>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-1 mt-2">
          <h1 className="text-2xl md:text-3xl font-bold">⚡ ESS Sturing (live)</h1>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold text-white" style={{ background: modeColor(s.mode) }}>
              {s.mode || '—'}
            </span>
            <BatteryBadge pct={s.soc} />
          </div>
        </div>
        <p className="text-gray-500 text-xs mb-4">
          Laatste update: {bijgewerkt ? new Date(bijgewerkt).toLocaleString('nl-NL') : '—'}
          {s.balansDagen != null ? ` · Laatste 100%: ${s.balansDagen} dgn geleden` : ''}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
            <button
              onClick={toggleLaden}
              disabled={pending}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${aan ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-600 hover:bg-gray-500'} ${pending ? 'opacity-60' : ''}`}
            >
              Laden uit net: {aan ? 'AAN' : 'UIT'}
            </button>
            <span className="text-xs text-gray-400" title="Grid-arbitrage actief (koopt uit net op goedkope uren)">
              {aan ? '⚠️ Grid-arbitrage' : 'Alleen PV-laden'}
            </span>
            <ScheduleEditor scheduleKey="laad_van_net" initial={laadVanNetSchedule} />
          </div>

          <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
            <button
              onClick={toggleVol}
              disabled={pending}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${vol ? 'bg-amber-500 hover:bg-amber-400 text-black' : 'bg-gray-600 hover:bg-gray-500'} ${pending ? 'opacity-60' : ''}`}
            >
              Accu altijd vol: {vol ? 'AAN' : 'UIT'}
            </button>
            <span className="text-xs text-gray-400" title="Accu wordt vol gehouden (geen verkoop/ontlading) — handel gepauzeerd">
              {vol ? '🔋 Vol gehouden' : 'Normale handel'}
            </span>
            <ScheduleEditor scheduleKey="keep_charged" initial={keepChargedSchedule} />
          </div>

          <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
            <button
              onClick={togglePauze}
              disabled={pending}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${pauze ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-600 hover:bg-gray-500'} ${pending ? 'opacity-60' : ''}`}
            >
              Verkopen: {pauze ? 'GEPAUZEERD' : 'AAN'}
            </button>
            <span className="text-xs text-gray-400" title="Alleen verkopen stilgezet — laden/zelfverbruik gaan gewoon door">
              {pauze ? '⏸️ Stilgezet' : 'Normaal gedrag'}
            </span>
            <ScheduleEditor scheduleKey="verkoop_pauze" initial={verkoopPauzeSchedule} />
          </div>

          <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1.5">
            <div className="text-xs text-gray-400">Verkoop-bodem</div>
            <ReserveEditor initial={reserveSoc} />
          </div>
        </div>

        {s.balansDoel ? (
          <div className="flex items-center gap-2 mb-6 bg-amber-900/40 border border-amber-700 rounded-xl p-3 text-sm text-amber-200">
            🔋 Balancering nodig ({s.balansDagen} dagen geen 100%) — gepland op zonnigste dag: <b>{s.balansDoel}</b>
          </div>
        ) : <div className="mb-3" />}

        <div className="bg-gray-800 rounded-xl p-4 md:p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h2 className="font-semibold text-gray-200">📊 Voorspelling</h2>
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
              {[['vandaag', 'Vandaag'], ['morgen', 'Morgen'], ['alles', 'Alles']].map(([k, label]) => (
                <button key={k} onClick={() => setDag(k)}
                  disabled={k === 'morgen' && !heeftMorgen}
                  className={`px-3 py-1.5 font-medium transition ${dag === k ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} ${k === 'morgen' && !heeftMorgen ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
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
            <span style={{ color: '#06b6d4' }}> ■</span> gratis (negatief) ·
            <span style={{ color: '#c084fc' }}> ■</span> PV → net
          </p>
        </div>
      </div>
    </main>
  );
}
