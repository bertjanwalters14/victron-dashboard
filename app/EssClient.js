'use client';
import { useState, useEffect, useTransition } from 'react';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { setLaadVanNet, setKeepCharged, setVerkoopPauze, setSchedule, setReserveSoc } from './actions';
import BatteryBadge from './BatteryBadge';

// Energiestromen-kleuren, losjes naar VRM's eigen palet (cyaan=accu->net, oranje=PV->net, groen=PV->accu,
// limoen=PV->verbruik, blauw=accu->verbruik, rood/paars=van het net -- die twee als NEGATIEF getoond,
// zelfde conventie als VRM: alles wat van het net komt zakt onder de nullijn).
const STROOM_KLEUR = { Bg: '#22d3ee', Pg: '#f97316', Pb: '#4ade80', Pc: '#a3e635', Bc: '#3b82f6', Gc: '#f87171', Gb: '#c084fc' };

// Celverschil-badge (max-cel - min-cel): dezelfde drempels als ess_logic.js v49 (CEL_VERSCHIL_DREMPEL
// 0,05V triggert balanceren, CEL_VERSCHIL_HERSTELD 0,03V is weer gezond), zodat je in één oogopslag ziet
// of balanceren eraan zit te komen -- data komt al mee in status.dbg, geen aparte call nodig.
// v50.7: het verschil zegt alleen iets bij LEEG (<=40% SOC) of VOL (>=98%); in het midden is het altijd
// klein (VRM-historie: nooit > 0,03V tussen 40 en 98%), dus daar tonen we neutraal "niet representatief"
// i.p.v. een geruststellend groen. `celMeetmoment` ontbreekt zolang Node-RED nog op een oudere versie draait.
function CelBalansBadge({ dbg }) {
  if (!dbg || dbg.celVerschil == null) return null;
  const v = dbg.celVerschil;
  const meetmoment = dbg.celMeetmoment !== false;
  const stijl = dbg.balansHoldActief
    ? { kleur: 'text-blue-300 bg-blue-950/40 border-blue-800', label: 'balanceren: vastgehouden op 100%' }
    : !meetmoment ? { kleur: 'text-gray-300 bg-gray-800/60 border-gray-600', label: 'niet representatief: meet bij leeg of vol' }
    : v >= 0.05 ? { kleur: 'text-red-300 bg-red-950/40 border-red-800', label: 'balanceren nodig/actief' }
    : v >= 0.03 ? { kleur: 'text-amber-300 bg-amber-950/40 border-amber-800', label: 'loopt op' }
    : { kleur: 'text-green-300 bg-green-950/40 border-green-800', label: 'gezond' };
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border mb-2 ${stijl.kleur}`}
      title={`min ${dbg.celMin?.toFixed(3)}V / max ${dbg.celMax?.toFixed(3)}V`}>
      🔋 Celverschil: <b>{v.toFixed(3)}V</b> ({stijl.label})
    </div>
  );
}

// Vaste assen i.p.v. per-dag meeschalend, zodat de balkhoogte/lijnpositie zelf al laat zien of het een
// zonnige/koude dag was -- met een dynamische as (die elke dag opnieuw naar de eigen max/min schaalt) ziet
// een bewolkte dag er even "vol" uit als een stralende, en dat is precies wat je niet wil kunnen zien.
const PV_MAX_KWH_PER_UUR = 7;   // ~6,6 kWp AC-gekoppelde PV (zie CLAUDE.md), + kleine marge
const TEMP_MIN_C = -5;
const TEMP_MAX_C = 35;

function StroomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '8px 11px', color: '#fff', fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{label}</div>
      {payload.filter(p => Math.abs(p.value) > 0.01).map(p => (
        <div key={p.dataKey} style={{ color: p.fill }}>{p.name}: {Math.abs(p.value).toFixed(2)} kWh</div>
      ))}
    </div>
  );
}

// Haalt de echte, gerealiseerde energiestromen van vandaag op (VRM-uurdata, zelfde bron als /api/live en
// /api/sync) -- in tegenstelling tot de andere twee grafieken hierboven is dit geen planning/forecast maar
// wat de accu/PV/net daadwerkelijk hebben gedaan. Client-side fetch (eenmalig bij laden), net als de
// AccuBadge/LiveVandaag-widgets op het hoofddashboard. Dag-navigatie (vorige/volgende) laat je ook
// eerdere dagen bekijken -- VRM bewaart de geschiedenis gewoon, alleen "vandaag" was hardcoded.
function vandaagNL() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });   // YYYY-MM-DD
}
function dagVerschuiven(datum, delta) {
  const d = new Date(datum + 'T12:00:00');   // 12:00 als anker, zodat DST-overgangen nooit een dag overslaan
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('sv-SE');
}
function formatDagLabel(datum) {
  const vandaag = vandaagNL();
  if (datum === vandaag) return 'Vandaag';
  if (datum === dagVerschuiven(vandaag, -1)) return 'Gisteren';
  return new Date(datum + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
}

function EnergieStromenChart() {
  const [datum, setDatum] = useState(vandaagNL());
  const [uren, setUren] = useState(null);
  const [fout, setFout] = useState(false);
  const isVandaag = datum === vandaagNL();

  useEffect(() => {
    let genegeerd = false;
    fetch(`/api/energiestromen?secret=Nummer14!&datum=${datum}`)
      .then(r => r.json())
      .then(j => {
        if (genegeerd) return;
        if (j.success) { setUren(j.uren.map(u => ({ ...u, Gc: -u.Gc, Gb: -u.Gb }))); setFout(false); }
        else setFout(true);
      })
      .catch(() => { if (!genegeerd) setFout(true); });
    return () => { genegeerd = true; };
  }, [datum]);

  const nav = (
    <div className="flex items-center gap-2 mb-2">
      <button type="button" onClick={() => setDatum(d => dagVerschuiven(d, -1))}
        className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-200">← Vorige dag</button>
      <span className="text-xs text-gray-400 min-w-[90px] text-center">{formatDagLabel(datum)}</span>
      <button type="button" onClick={() => setDatum(d => dagVerschuiven(d, 1))} disabled={isVandaag}
        className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed">Volgende dag →</button>
    </div>
  );

  if (fout) return <>{nav}<p className="text-xs text-gray-500">Energiestromen nu niet beschikbaar.</p></>;
  if (!uren) return <>{nav}<p className="text-xs text-gray-500">Laden…</p></>;
  if (!uren.length) return <>{nav}<p className="text-xs text-gray-500">Geen data voor deze dag.</p></>;

  return (
    <>
    {nav}
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={uren} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="15%" stackOffset="sign">
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="uur" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
        <Tooltip content={<StroomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#6b7280" />
        <Bar dataKey="Bg" name="Accu → net" stackId="stroom" fill={STROOM_KLEUR.Bg} />
        <Bar dataKey="Pg" name="PV → net" stackId="stroom" fill={STROOM_KLEUR.Pg} />
        <Bar dataKey="Pb" name="PV → accu" stackId="stroom" fill={STROOM_KLEUR.Pb} />
        <Bar dataKey="Pc" name="PV → verbruik" stackId="stroom" fill={STROOM_KLEUR.Pc} />
        <Bar dataKey="Bc" name="Accu → verbruik" stackId="stroom" fill={STROOM_KLEUR.Bc} />
        <Bar dataKey="Gc" name="Net → verbruik" stackId="stroom" fill={STROOM_KLEUR.Gc} />
        <Bar dataKey="Gb" name="Net → accu" stackId="stroom" fill={STROOM_KLEUR.Gb} />
      </ComposedChart>
    </ResponsiveContainer>
    </>
  );
}

const KLEUR = { kopen: '#3b82f6', verkopen: '#22c55e', normaal: '#f59e0b', gratis: '#06b6d4', pvnet: '#c084fc' };

function modeColor(m) {
  m = m || '';
  if (m.startsWith('VERKOPEN')) return '#22c55e';
  if (m.startsWith('KOPEN') || m.startsWith('NEG')) return '#3b82f6';
  if (m.startsWith('VOL') || m.startsWith('BALANCEREN') || m.startsWith('ACCU VOL')) return '#f59e0b';
  return '#64748b';
}

const CAT_LABEL = { kopen: 'Kopen', verkopen: 'Verkopen', normaal: 'Zelfverbruik', gratis: 'Gratis laden (negatief)', pvnet: 'PV → net (accu vol)' };

// Vat de geselecteerde periode samen in gewone taal (temperatuur + zon + wat de sturing daarmee doet),
// puur afgeleid van de forecast-data zelf -- geen apart backend-veld nodig, werkt dus hetzelfde voor
// vandaag/morgen/alles. TEMP_BALANS is hetzelfde omslagpunt als het graaddagen-model in ess_logic.js.
const TEMP_BALANS = 13.5;
function dagContext(data) {
  const temps = data.map(d => d.temp).filter(t => t != null);
  if (!temps.length) return null;   // geen forecast-data (Node-RED nog niet bijgewerkt, of geen dekking)
  const avgTemp = temps.reduce((s, t) => s + t, 0) / temps.length;
  const totalPv = data.reduce((s, d) => s + (Number(d.pv) || 0), 0);
  const koopUren = data.filter(d => d.cat === 'kopen').length;
  const verkoopUren = data.filter(d => d.cat === 'verkopen').length;

  const tempTxt = avgTemp < TEMP_BALANS ? `❄️ Koud (gem. ${avgTemp.toFixed(0)}°C)` : `🌤️ Mild (gem. ${avgTemp.toFixed(0)}°C)`;
  const pvTxt = totalPv < 5 ? `weinig zon (${totalPv.toFixed(0)} kWh)`
    : totalPv < 20 ? `wat zon (${totalPv.toFixed(0)} kWh)`
    : `veel zon (${totalPv.toFixed(0)} kWh)`;

  const impact = koopUren > 0 ? `${koopUren} uur inkoop gepland (piekverbruik opvangen)`
    : verkoopUren > 0 ? `${verkoopUren} uur verkoop gepland`
    : 'vooral zelfverbruik';

  return `${tempTxt} en ${pvTxt} → ${impact}`;
}

function EssTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '8px 11px', color: '#fff', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{d.uur}</div>
      <div>Prijs all-in: <b>€{Number(d.prijs).toFixed(3)}</b></div>
      <div style={{ color: '#a855f7' }}>SOC: {d.soc}%</div>
      <div style={{ color: '#9ca3af', marginTop: 2 }}>{CAT_LABEL[d.cat] || d.cat}</div>
    </div>
  );
}

function WeerTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '8px 11px', color: '#fff', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{d.uur}</div>
      <div style={{ color: '#fde047' }}>Zon: {Number(d.pv).toFixed(1)} kWh</div>
      {d.temp != null && <div style={{ color: '#f87171' }}>Temperatuur: {Number(d.temp).toFixed(1)}°C</div>}
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
  const contextZin = dagContext(data);

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
          {contextZin && (
            <div className="text-sm text-gray-300 bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 mb-3">
              {contextZin}
            </div>
          )}

          <h3 className="text-xs font-semibold text-gray-400 mb-1">🔋 Laden &amp; prijs</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="prijs" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
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
              <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC %" stroke="#a855f7" dot={false} strokeWidth={2.5} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2 mb-5">
            <span style={{ color: '#3b82f6' }}>■</span> kopen ·
            <span style={{ color: '#22c55e' }}> ■</span> verkopen ·
            <span style={{ color: '#f59e0b' }}> ■</span> normaal ·
            <span style={{ color: '#06b6d4' }}> ■</span> gratis (negatief) ·
            <span style={{ color: '#c084fc' }}> ■</span> PV → net
          </p>

          <h3 className="text-xs font-semibold text-gray-400 mb-1">🌤️ Weer</h3>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: '#9ca3af' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="zon" domain={[0, PV_MAX_KWH_PER_UUR]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis yAxisId="temp" orientation="right" domain={[TEMP_MIN_C, TEMP_MAX_C]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<WeerTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine yAxisId="zon" x={nuUur} stroke="#ffffff" strokeDasharray="4 3" strokeOpacity={0.7} />
              <Bar yAxisId="zon" dataKey="pv" name="Zon (kWh)" fill="#fde047" fillOpacity={0.85} maxBarSize={16} radius={[3, 3, 0, 0]} />
              <Line yAxisId="temp" type="monotone" dataKey="temp" name="Temperatuur (°C)" stroke="#f87171" dot={false} strokeWidth={2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>

          <h3 className="text-xs font-semibold text-gray-400 mb-1 mt-5">🔋 Energiestromen</h3>
          <p className="text-xs text-gray-500 mb-1">Wat de accu, zon en het net daadwerkelijk deden (werkelijke VRM-data, geen planning)</p>
          <CelBalansBadge dbg={s.dbg} />
          <EnergieStromenChart />
        </div>
      </div>
    </main>
  );
}
