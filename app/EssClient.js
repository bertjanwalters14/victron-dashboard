'use client';
import { useState, useEffect, useTransition } from 'react';
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { setLaadVanNet, setKeepCharged, setVerkoopPauze, setSchedule, setReserveSoc } from './actions';
import TabBar from './TabBar';

// Energiestromen-kleuren, losjes naar VRM's eigen palet (cyaan=accu->net, oranje=PV->net, groen=PV->accu,
// limoen=PV->verbruik, blauw=accu->verbruik, rood/paars=van het net -- die twee als NEGATIEF getoond,
// zelfde conventie als VRM: alles wat van het net komt zakt onder de nullijn).
const STROOM_KLEUR = { Bg: '#22d3ee', Pg: '#f97316', Pb: '#4ade80', Pc: '#a3e635', Bc: '#3b82f6', Gc: '#f87171', Gb: '#c084fc' };

// Gedeelde kaart-stijl (nieuwe look): vlak, subtiele rand, grote afronding.
const KAART = 'rounded-2xl border border-gray-800 bg-gray-900/60';

function Tegel({ label, waarde, sub, subKleur }) {
  return (
    <div className="rounded-xl bg-gray-800/60 px-3.5 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{waarde}</div>
      {sub && <div className={`text-xs ${subKleur || 'text-gray-400'}`}>{sub}</div>}
    </div>
  );
}

// Celverschil-tegel (max-cel - min-cel): dezelfde drempels als ess_logic.js (CEL_VERSCHIL_DREMPEL 0,05V
// triggert balanceren, CEL_VERSCHIL_HERSTELD 0,03V is weer gezond). Het verschil zegt alleen iets bij LEEG
// (<=40% SOC) of VOL (>=98%); in het midden is het altijd klein (VRM-historie: nooit > 0,03V tussen 40 en
// 98%), dus daar tonen we neutraal "alleen bij leeg of vol" i.p.v. een geruststellend groen.
// `celMeetmoment` ontbreekt zolang Node-RED op een oudere versie draait -> dan telt het wel gewoon.
function CelTegel({ dbg }) {
  if (!dbg || dbg.celVerschil == null) return <Tegel label="Celverschil" waarde="—" sub="geen meting" />;
  const v = dbg.celVerschil;
  const st = dbg.balansHoldActief ? ['vastgehouden op 100%', 'text-blue-300']
    : dbg.celMeetmoment === false ? ['alleen bij leeg of vol', 'text-gray-400']
    : v >= 0.05 ? ['balanceren nodig', 'text-red-300']
    : v >= 0.03 ? ['loopt op', 'text-amber-300']
    : ['gezond', 'text-green-300'];
  return <Tegel label="Celverschil" waarde={`${v.toFixed(3).replace('.', ',')} V`} sub={st[0]} subKleur={st[1]} />;
}

// Pakspanning-tegel: lage spanning voor de SOC is de tweede balans-trigger (ess_logic.js v50.9).
function PakTegel({ dbg }) {
  if (!dbg || dbg.vPack == null) return <Tegel label="Pakspanning" waarde="—" sub="geen meting" />;
  const st = dbg.vPackKritiek ? ['te laag voor de SOC', 'text-red-300'] : ['gezond', 'text-green-300'];
  return <Tegel label="Pakspanning" waarde={`${dbg.vPack.toFixed(1).replace('.', ',')} V`} sub={st[0]} subKleur={st[1]} />;
}


// Vaste assen i.p.v. per-dag meeschalend, zodat de balkhoogte/lijnpositie zelf al laat zien of het een
// zonnige/koude dag was -- met een dynamische as (die elke dag opnieuw naar de eigen max/min schaalt) ziet
// een bewolkte dag er even "vol" uit als een stralende, en dat is precies wat je niet wil kunnen zien.
// Legendatekst in themakleur (recharts kleurt hem anders in de serie-kleur, o.a. geel op wit onleesbaar).
const legendTekst = (v) => <span style={{ color: 'var(--chart-tick)' }}>{v}</span>;

const PV_MAX_KWH_PER_UUR = 7;   // ~6,6 kWp AC-gekoppelde PV (zie CLAUDE.md), + kleine marge
const TEMP_MIN_C = -5;
const TEMP_MAX_C = 35;

function StroomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: 'var(--chart-tip-bg)', border: '1px solid var(--chart-tip-border)', borderRadius: 8, padding: '8px 11px', color: 'var(--chart-tip-text)', fontSize: 12, lineHeight: 1.6 }}>
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

// Dagtotalen onder de grafiek (kWh, som over de getoonde uren), dezelfde indeling als VRM (Naar net, Van net,
// Verbruik, Totaal zon) plus wat de accu zelf leverde. Gc/Gb staan in `uren` negatief (onder de nullijn
// getekend), daarom abs(). Bij "vandaag" is het het lopende totaal tot en met het laatste uur met data.
const kwhTxt = (v) => v.toFixed(1).replace('.', ',') + ' kWh';
function StroomTotalen({ uren }) {
  const som = (k) => uren.reduce((t, u) => t + Math.abs(Number(u[k]) || 0), 0);
  const Bc = som('Bc'), Bg = som('Bg'), Gb = som('Gb'), Gc = som('Gc'), Pb = som('Pb'), Pc = som('Pc'), Pg = som('Pg');
  const tegels = [
    { label: 'Van het net', waarde: Gc + Gb, sub: `huis ${kwhTxt(Gc)} · accu ${kwhTxt(Gb)}`, punt: STROOM_KLEUR.Gc },
    { label: 'Van de accu', waarde: Bc + Bg, sub: `huis ${kwhTxt(Bc)} · net ${kwhTxt(Bg)}`, punt: STROOM_KLEUR.Bc },
    { label: 'Naar het net', waarde: Pg + Bg, sub: `zon ${kwhTxt(Pg)} · accu ${kwhTxt(Bg)}`, punt: STROOM_KLEUR.Pg },
    { label: 'Verbruik', waarde: Pc + Bc + Gc, sub: `zon ${kwhTxt(Pc)} · accu ${kwhTxt(Bc)} · net ${kwhTxt(Gc)}`, punt: STROOM_KLEUR.Pc },
    { label: 'Totaal zon', waarde: Pb + Pc + Pg, sub: `huis ${kwhTxt(Pc)} · accu ${kwhTxt(Pb)} · net ${kwhTxt(Pg)}`, punt: '#facc15' },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {tegels.map(t => (
        <div key={t.label} className="rounded-xl bg-gray-800/60 px-3.5 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-400"><span className="h-2 w-2 rounded-full" style={{ background: t.punt }} />{t.label}</div>
          <div className="text-xl font-semibold tabular-nums">{kwhTxt(t.waarde)}</div>
          <div className="text-xs text-gray-400">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function EnergieStromenChart() {
  const [datum, setDatum] = useState(vandaagNL());
  const [uren, setUren] = useState(null);
  const [fout, setFout] = useState(false);
  const isVandaag = datum === vandaagNL();

  useEffect(() => {
    let genegeerd = false;
    fetch(`/api/energiestromen?datum=${datum}`)
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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="uur" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
        <Tooltip content={<StroomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={legendTekst} />
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
    <StroomTotalen uren={uren} />
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

// Valt dit forecast-uur ("14:00" of "+1 14:00") binnen het [start, end)-venster van een schema?
// Zelfde regel als scheduleActiveAt() in ess_logic.js (loopt het venster over midnacht, dan OF).
function inSchema(uurLabel, sched) {
  if (!sched || !sched.enabled) return false;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const t = Number(String(uurLabel).replace('+1 ', '').slice(0, 2)) * 60;
  const s = toMin(sched.start), e = toMin(sched.end);
  return s <= e ? (t >= s && t < e) : (t >= s || t < e);
}

// Waarom koopt de sturing? De forecast zegt zelf alleen cat 'kopen', dus leiden we de reden hier af:
// uren binnen je "Accu altijd vol"-schema komen door die INSTELLING (niet door de planning), dan een
// handmatig aangezette "Accu altijd vol", dan een balans-dag, en pas daarna gewone prijs-arbitrage.
// (Vroeger stond hier altijd "piekverbruik opvangen", ook als het gewoon het schema was.)
function koopReden(koopUren, ctx) {
  const schema = koopUren.filter(d => inSchema(d.uur, ctx.keepSchedule)).length;
  const rest = koopUren.length - schema;
  const restTxt = ctx.keepManual ? '"Accu altijd vol" staat aan'
    : ctx.balans ? 'om te balanceren'
    : 'goedkoop inkopen voor de dure uren erna';
  const schemaTxt = schema
    ? `${schema > 0 && rest > 0 ? schema + ' ' : ''}door je "Accu altijd vol"-schema ${ctx.keepSchedule.start}–${ctx.keepSchedule.end}`
    : '';
  if (schema && rest) return `${schemaTxt}, ${rest} ${restTxt}`;
  return schema ? schemaTxt : restTxt;
}

function dagContext(data, ctx = {}) {
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

  const impact = koopUren > 0 ? `${koopUren} uur inkoop gepland (${koopReden(data.filter(d => d.cat === 'kopen'), ctx)})`
    : verkoopUren > 0 ? `${verkoopUren} uur verkoop gepland`
    : 'vooral zelfverbruik';

  return `${tempTxt} en ${pvTxt} → ${impact}`;
}

function EssTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--chart-tip-bg)', border: '1px solid var(--chart-tip-border)', borderRadius: 8, padding: '8px 11px', color: 'var(--chart-tip-text)', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{d.uur}</div>
      <div>Prijs all-in: <b>€{Number(d.prijs).toFixed(3)}</b></div>
      <div style={{ color: '#a855f7' }}>SOC: {d.soc}%</div>
      <div style={{ color: 'var(--chart-tick)', marginTop: 2 }}>{CAT_LABEL[d.cat] || d.cat}</div>
    </div>
  );
}

function WeerTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--chart-tip-bg)', border: '1px solid var(--chart-tip-border)', borderRadius: 8, padding: '8px 11px', color: 'var(--chart-tip-text)', fontSize: 12, lineHeight: 1.5 }}>
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
          className="bg-gray-700 rounded px-1.5 py-0.5 text-gray-50 disabled:opacity-40 w-full"
        />
        <span>tot</span>
        <input
          type="time" value={cfg.end} disabled={!cfg.enabled}
          onChange={e => update({ end: e.target.value })}
          className="bg-gray-700 rounded px-1.5 py-0.5 text-gray-50 disabled:opacity-40 w-full"
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
      <div className="text-sm font-semibold text-gray-50 mb-1">Verkoop-bodem: {pct}%</div>
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

// Statuskaart: modus, SOC groot, voortgangsbalk met de verkoop-bodem (reserve) als streepje erin.
function HeroKaart({ s, bijgewerkt, reserveSoc }) {
  const soc = s.soc != null ? Math.round(s.soc) : null;
  const kwh = soc != null ? (soc / 100) * 32 : null;
  const balkKleur = soc == null ? 'bg-gray-600' : soc < 20 ? 'bg-red-500' : soc < 50 ? 'bg-amber-500' : 'bg-green-500';
  const mk = modeColor(s.mode);
  const tijd = bijgewerkt ? new Date(bijgewerkt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '—';
  return (
    <div className={`${KAART} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium" style={{ background: mk + '26', color: mk }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: mk }} />{s.mode || '—'}
        </span>
        <span className="text-xs text-gray-500">bijgewerkt {tijd}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-5xl font-semibold leading-none tabular-nums">{soc ?? '—'}</span>
        <span className="text-xl text-gray-400">%</span>
        {kwh != null && <span className="ml-3 text-sm text-gray-400">{kwh.toFixed(0)} kWh in de accu</span>}
      </div>
      <div className="relative mt-4 h-2 rounded-full bg-gray-800">
        <div className={`h-full rounded-full ${balkKleur}`} style={{ width: `${soc ?? 0}%` }} />
        <div className="absolute -top-1 h-4 w-px bg-gray-300" style={{ left: `${reserveSoc}%` }} />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-gray-500">
        <span className="absolute left-0">0%</span>
        <span className="absolute -translate-x-1/2 text-gray-400" style={{ left: `${reserveSoc}%` }}>reserve {reserveSoc}%</span>
        <span className="absolute right-0">100%</span>
      </div>
      {s.balansDagen != null && <div className="mt-2 text-xs text-gray-500">Laatste 100%: {s.balansDagen === 0 ? 'vandaag' : `${s.balansDagen} dgn geleden`}</div>}
    </div>
  );
}

// Eén knop als kaart met een schakelaar. De regel eronder (sub) wordt amber zodra er een schema aan staat,
// zodat een vergeten schema meteen opvalt. De ScheduleEditor eronder blijft de plek om het venster in te stellen.
function SchakelKaart({ titel, sub, subKleur, aan, onToggle, bezig, aanKleur, children }) {
  return (
    <div className={`${KAART} flex flex-col gap-2 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{titel}</div>
          <div className={`mt-0.5 text-xs ${subKleur || 'text-gray-400'}`}>{sub}</div>
        </div>
        <button type="button" role="switch" aria-checked={aan} aria-label={titel} onClick={onToggle} disabled={bezig}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${aan ? aanKleur : 'bg-gray-700'} ${bezig ? 'opacity-60' : ''}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${aan ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {children}
    </div>
  );
}

const schemaTxt = (sch) => (sch && sch.enabled ? `Schema ${sch.start}–${sch.end} staat aan` : null);

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
  // Een effectief-AAN "Accu altijd vol" terwijl het schema NU niet actief is = handmatig aangezet.
  const keepManual = !!keepCharged && !inSchema(nuUur, keepChargedSchedule);
  const contextZin = dagContext(data, { keepSchedule: keepChargedSchedule, keepManual, balans: !!s.dbg?.balansOnbalans });

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

  const prijsNu = s.buy != null ? `€${Number(s.buy).toFixed(3).replace('.', ',')}` : '—';

  return (
    <main className="min-h-screen bg-gray-950 text-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-5 md:py-8">
        <TabBar />

        <section className="mb-3 grid gap-3 md:grid-cols-[1.4fr_1fr]">
          <HeroKaart s={s} bijgewerkt={bijgewerkt} reserveSoc={reserveSoc} />
          <div className="grid grid-cols-2 content-start gap-3">
            <Tegel label="Prijs nu" waarde={prijsNu} sub="inkoop all-in" />
            <Tegel label="Verkoop nu" waarde={s.sell != null ? `€${Number(s.sell).toFixed(3).replace('.', ',')}` : '—'} sub="teruglevering" />
            <CelTegel dbg={s.dbg} />
            <PakTegel dbg={s.dbg} />
          </div>
        </section>

        <section className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SchakelKaart titel="Laden uit net" aan={aan} onToggle={toggleLaden} bezig={pending} aanKleur="bg-blue-600"
            sub={schemaTxt(laadVanNetSchedule) || (aan ? 'Grid-arbitrage actief' : 'Alleen PV-laden')}
            subKleur={schemaTxt(laadVanNetSchedule) ? 'text-amber-300' : aan ? 'text-blue-300' : 'text-gray-400'}>
            <ScheduleEditor scheduleKey="laad_van_net" initial={laadVanNetSchedule} />
          </SchakelKaart>
          <SchakelKaart titel="Accu altijd vol" aan={vol} onToggle={toggleVol} bezig={pending} aanKleur="bg-amber-500"
            sub={schemaTxt(keepChargedSchedule) || (vol ? 'Vol gehouden, geen verkoop' : 'Normale handel')}
            subKleur={schemaTxt(keepChargedSchedule) || vol ? 'text-amber-300' : 'text-gray-400'}>
            <ScheduleEditor scheduleKey="keep_charged" initial={keepChargedSchedule} />
          </SchakelKaart>
          <SchakelKaart titel="Verkopen pauzeren" aan={pauze} onToggle={togglePauze} bezig={pending} aanKleur="bg-red-600"
            sub={schemaTxt(verkoopPauzeSchedule) || (pauze ? 'Verkopen stilgezet' : 'Verkopen loopt normaal')}
            subKleur={schemaTxt(verkoopPauzeSchedule) ? 'text-amber-300' : pauze ? 'text-red-300' : 'text-gray-400'}>
            <ScheduleEditor scheduleKey="verkoop_pauze" initial={verkoopPauzeSchedule} />
          </SchakelKaart>
          <div className={`${KAART} flex flex-col gap-2 p-4`}>
            <div className="text-sm font-semibold">Verkoop-bodem</div>
            <div className="text-xs text-gray-400">Onder dit niveau verkoopt hij niet</div>
            <ReserveEditor initial={reserveSoc} />
          </div>
        </section>

        {s.balansDoel ? (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-amber-800/60 bg-amber-900/30 p-3 text-sm text-amber-200">
            Balancering nodig ({s.balansDagen} dagen geen 100%), gepland op de zonnigste dag: <b>{s.balansDoel}</b>
          </div>
        ) : null}

        <section className={`${KAART} mb-3 p-4 md:p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-200">Voorspelling</h2>
            <div className="inline-flex gap-1 rounded-full bg-gray-800/80 p-1 text-sm">
              {[['vandaag', 'Vandaag'], ['morgen', 'Morgen'], ['alles', 'Alles']].map(([k, label]) => (
                <button key={k} onClick={() => setDag(k)}
                  disabled={k === 'morgen' && !heeftMorgen}
                  className={`rounded-full px-3 py-1 font-medium transition-colors ${dag === k ? 'bg-gray-600 text-gray-50' : 'text-gray-400 hover:text-gray-200'} ${k === 'morgen' && !heeftMorgen ? 'cursor-not-allowed opacity-40' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {contextZin && (
            <div className="mb-4 rounded-xl bg-gray-800/50 px-3 py-2 text-sm text-gray-300">
              {contextZin}
            </div>
          )}

          <h3 className="mb-1 text-xs font-semibold text-gray-400">Laden en prijs</h3>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="prijs" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
              <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
              <Tooltip content={<EssTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendTekst} />
              <ReferenceLine yAxisId="prijs" x={nuUur} stroke="var(--chart-ref)" strokeDasharray="4 3" strokeOpacity={0.7}
                label={{ value: '▼ nu', position: 'top', fill: 'var(--chart-ref)', fontSize: 11 }} />
              <Bar yAxisId="prijs" dataKey="prijs" name="Prijs all-in (€)" maxBarSize={16} radius={[3, 3, 0, 0]} fillOpacity={0.9}>
                {data.map((d, i) => (
                  <Cell key={i} fill={KLEUR[d.cat] || '#f59e0b'}
                    stroke={d.uur === nuUur ? 'var(--chart-ref)' : 'none'} strokeWidth={d.uur === nuUur ? 2 : 0}
                    fillOpacity={d.uur === nuUur ? 1 : 0.9} />
                ))}
              </Bar>
              <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC %" stroke="#a855f7" dot={false} strokeWidth={2.5} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-gray-500">
            <span style={{ color: '#3b82f6' }}>■</span> kopen ·
            <span style={{ color: '#22c55e' }}> ■</span> verkopen ·
            <span style={{ color: '#f59e0b' }}> ■</span> normaal ·
            <span style={{ color: '#06b6d4' }}> ■</span> gratis (negatief) ·
            <span style={{ color: '#c084fc' }}> ■</span> PV → net
          </p>
        </section>

        <section className={`${KAART} mb-3 p-4 md:p-5`}>
          <h2 className="mb-1 font-semibold text-gray-200">Weer en zon</h2>
          <p className="mb-2 text-xs text-gray-500">Zon per uur op een vaste as van 0 tot {PV_MAX_KWH_PER_UUR} kWh, zodat een zonnige en een sombere dag er ook echt anders uitzien</p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="uur" tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis yAxisId="zon" domain={[0, PV_MAX_KWH_PER_UUR]} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
              <YAxis yAxisId="temp" orientation="right" domain={[TEMP_MIN_C, TEMP_MAX_C]} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
              <Tooltip content={<WeerTooltip />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendTekst} />
              <ReferenceLine yAxisId="zon" x={nuUur} stroke="var(--chart-ref)" strokeDasharray="4 3" strokeOpacity={0.7} />
              <Bar yAxisId="zon" dataKey="pv" name="Zon (kWh)" fill="#fde047" fillOpacity={0.85} maxBarSize={16} radius={[3, 3, 0, 0]} />
              <Line yAxisId="temp" type="monotone" dataKey="temp" name="Temperatuur (°C)" stroke="#f87171" dot={false} strokeWidth={2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </section>

        <section className={`${KAART} p-4 md:p-5`}>
          <h2 className="mb-1 font-semibold text-gray-200">Energiestromen</h2>
          <p className="mb-2 text-xs text-gray-500">Wat de accu, zon en het net daadwerkelijk deden (werkelijke VRM-data, geen planning)</p>
          <EnergieStromenChart />
        </section>
      </div>
    </main>
  );
}
