'use client';
import { useEffect, useState } from 'react';
import { ComposedChart, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import TabBar from './TabBar';

const KAART = 'rounded-2xl border border-gray-800 bg-gray-900/60';
const PERIODES = [1, 3, 7, 14];
const KLEUR_MIN = '#f59e0b';   // laagste cel
const KLEUR_MAX = '#3b82f6';   // hoogste cel
const KLEUR_SOC = '#a855f7';   // SOC (zelfde paars als op de Live-pagina)

// Het celverschil zegt alleen iets aan de uiteinden: tussen ongeveer 10% en 95% is de LFP-spanning zo vlak dat
// cellen met een ongelijke lading toch dicht bij elkaar liggen (zie ess_logic.js, onbalans-trigger).
const verschilBetekenisvol = (soc) => soc != null && (soc <= 40 || soc >= 97);

const v3 = (x) => (x == null ? '—' : x.toFixed(3).replace('.', ','));
const mv = (x) => (x == null ? '—' : `${Math.round(x * 1000)} mV`);

// "01::14" -> "pack 01, cel 14"
function celNaam(id) {
  const m = /^(\d+)::(\d+)$/.exec(id || '');
  return m ? `pack ${m[1]}, cel ${m[2]}` : (id || 'onbekend');
}

function verschilStand(verschil, soc) {
  if (verschil == null) return { kleur: 'text-gray-300', tekst: 'geen meting' };
  if (!verschilBetekenisvol(soc)) return { kleur: 'text-gray-300', tekst: 'zegt in het midden van het bereik weinig' };
  if (verschil < 0.03) return { kleur: 'text-green-300', tekst: 'in balans' };
  if (verschil < 0.07) return { kleur: 'text-amber-300', tekst: 'licht uit balans' };
  return { kleur: 'text-red-300', tekst: 'duidelijk uit balans' };
}

function laagsteStand(v) {
  if (v == null) return { kleur: 'text-gray-300', tekst: '' };
  if (v < 3.0) return { kleur: 'text-red-300', tekst: 'onder 3,0 V, bijna leeg' };
  if (v < 3.1) return { kleur: 'text-amber-300', tekst: 'laag, onderin het bereik' };
  if (v > 3.45) return { kleur: 'text-blue-300', tekst: 'op de top' };
  return { kleur: 'text-green-300', tekst: 'gezond' };
}

function Tegel({ label, waarde, sub, subKleur = 'text-gray-400' }) {
  return (
    <div className={`${KAART} p-4`}>
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{waarde}</div>
      {sub ? <div className={`mt-0.5 text-xs ${subKleur}`}>{sub}</div> : null}
    </div>
  );
}

// Dagen geleden op kalenderdag (Amsterdam), niet op 24-uursblokken: "gisteren" is gisteren, ook als het 20 uur terug is.
const nlDatum = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
function dagenGeleden(t) {
  return Math.round((Date.parse(nlDatum(Date.now())) - Date.parse(nlDatum(t))) / 86400000);
}
const wanneer = (n) => (n <= 0 ? 'vandaag' : n === 1 ? 'gisteren' : `${n} dagen geleden`);
const duur = (min) => (min >= 60 ? `${Math.floor(min / 60)} u${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
const dagMaand = (t) => new Date(t).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'numeric' });
const TOP_LANG_GENOEG_MIN = 120;   // zo lang telt een top voor de sturing als echte top (topLangGenoeg in ess_logic.js)

function TopRegel({ top, groot }) {
  const lang = top.minuten >= TOP_LANG_GENOEG_MIN;
  const eind = top.eindVerschil < 0.03 ? 'text-green-300' : top.eindVerschil < 0.07 ? 'text-amber-300' : 'text-red-300';
  return (
    <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 ${groot ? '' : 'px-3 py-2 text-sm'}`}>
      <span className={groot ? 'text-lg font-semibold' : 'text-gray-300'}>{groot ? `${wanneer(dagenGeleden(top.start))} (${dagMaand(top.start)})` : `${dagMaand(top.start)} · ${wanneer(dagenGeleden(top.start))}`}</span>
      <span className="text-gray-400">
        {duur(top.minuten)} boven 3,45 V · hoogste {v3(top.maxCel)} V · verschil {Math.round(top.maxVerschil * 1000)} → <span className={eind}>{Math.round(top.eindVerschil * 1000)} mV</span>
        {lang ? '' : ' · korter dan 2 uur'}
      </span>
    </div>
  );
}

const tijdKort = (t) => new Date(t).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
const dagTijd = (t) => new Date(t).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dagKort = (t) => new Date(t).toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric' });

function Tip({ active, payload, label, eenheid }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: 'var(--chart-tip-bg)', border: '1px solid var(--chart-tip-border)', borderRadius: 8, padding: '8px 11px', color: 'var(--chart-tip-text)', fontSize: 12, lineHeight: 1.6 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4, fontSize: 13 }}>{dagTijd(label)}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.stroke }}>
          {p.name}: {p.dataKey === 'soc' ? `${p.value}%` : eenheid === 'mv' ? `${Math.round(p.value * 1000)} mV` : `${p.value.toFixed(3).replace('.', ',')} V`}
        </div>
      ))}
    </div>
  );
}

export default function CellenClient() {
  const [dagen, setDagen] = useState(3);
  const [data, setData] = useState(null);
  const [fout, setFout] = useState(null);
  const [laden, setLaden] = useState(true);

  useEffect(() => {
    let weg = false;
    async function haal() {
      try {
        const res = await fetch(`/api/cellen?dagen=${dagen}`);
        const json = await res.json();
        if (weg) return;
        if (!res.ok || !json.success) throw new Error(json.error || 'Laden mislukt');
        setData(json); setFout(null);
      } catch (e) {
        if (!weg) setFout(e.message);
      }
      if (!weg) setLaden(false);
    }
    setLaden(true);
    haal();
    const t = setInterval(haal, 5 * 60000);   // elke 5 minuten vers zolang de pagina openstaat
    return () => { weg = true; clearInterval(t); };
  }, [dagen]);

  const nu = data?.nu;
  const reeks = data?.reeks || [];
  const stand = nu ? verschilStand(nu.hoogste.v != null && nu.laagste.v != null ? nu.hoogste.v - nu.laagste.v : null, nu.soc) : null;
  const verschilNu = nu && nu.hoogste.v != null && nu.laagste.v != null ? nu.hoogste.v - nu.laagste.v : null;
  const laagsteS = nu ? laagsteStand(nu.laagste.v) : null;

  // Tijd-as: bij één dag uren, anders dag + datum
  const tickFmt = (t) => (dagen <= 1 ? tijdKort(t) : dagKort(t));

  return (
    <main className="min-h-screen bg-gray-950 text-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-5 md:py-8">
        <TabBar />
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Cellen</h1>
            <p className="text-sm text-gray-400">Laagste en hoogste celspanning van de accu, rechtstreeks uit VRM.</p>
          </div>
          <div className="inline-flex gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1" role="group" aria-label="Periode">
            {PERIODES.map(n => (
              <button key={n} type="button" onClick={() => setDagen(n)} aria-pressed={dagen === n}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${dagen === n ? 'bg-gray-800 text-gray-50' : 'text-gray-400 hover:text-gray-200'}`}>{n === 1 ? '1 dag' : `${n} dagen`}</button>
            ))}
          </div>
        </div>

        {fout ? (
          <div className={`${KAART} mb-3 p-4 text-sm text-red-300`}>Het laden is mislukt: {fout}</div>
        ) : null}

        {laden && !data ? (
          <div className={`${KAART} p-5 text-sm text-gray-400`}>Even laden…</div>
        ) : null}

        {nu ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tegel label="Laagste cel" waarde={`${v3(nu.laagste.v)} V`} sub={`${celNaam(nu.laagste.id)}${laagsteS.tekst ? ` · ${laagsteS.tekst}` : ''}`} subKleur={laagsteS.kleur} />
              <Tegel label="Hoogste cel" waarde={`${v3(nu.hoogste.v)} V`} sub={celNaam(nu.hoogste.id)} />
              <Tegel label="Verschil" waarde={mv(verschilNu)} sub={stand.tekst} subKleur={stand.kleur} />
              <Tegel label="Accu" waarde={nu.soc != null ? `${Math.round(nu.soc)}%` : '—'}
                sub={`${nu.spanning != null ? nu.spanning.toFixed(1).replace('.', ',') + ' V' : ''}${nu.stroom != null ? ` · ${nu.stroom.toFixed(1).replace('.', ',')} A` : ''}${nu.tempMin != null ? ` · ${Math.round(nu.tempMin)}${nu.tempMax != null && Math.round(nu.tempMax) !== Math.round(nu.tempMin) ? '-' + Math.round(nu.tempMax) : ''} °C` : ''}`} />
            </div>
            <p className="mb-4 px-1 text-xs text-gray-500">
              Stand van {nu.tijd ? tijdKort(nu.tijd) : 'nu'}. VRM geeft alleen de laagste en de hoogste cel door, niet alle cellen afzonderlijk.
              Het verschil is vooral onderin (onder ± 40% SOC) en aan de top (vanaf ± 97%) zinvol; in het midden zijn de celspanningen bij LFP zo vlak dat ongelijke cellen toch dicht bij elkaar liggen.
            </p>
          </>
        ) : null}

        {data ? (
          <div className={`${KAART} mb-3 p-4`}>
            <h2 className="mb-2 text-sm font-semibold text-gray-300">Laatste top boven 3,45 V</h2>
            {data.tops && data.tops.length ? (
              <>
                <TopRegel top={data.tops[0]} groot />
                <p className="mt-1 text-xs text-gray-500">
                  Het verschil gaat van het grootste verschil tijdens de top naar wat er aan het eind overbleef. Alleen boven 3,45 V balanceert de BMS; een top van minstens 2 uur telt voor de sturing als echte balans.
                </p>
                {data.tops.length > 1 ? (
                  <div className="mt-3 divide-y divide-gray-800 rounded-xl border border-gray-800">
                    {data.tops.slice(1).map(t => <TopRegel key={t.start} top={t} />)}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-gray-400">In de afgelopen 30 dagen kwam geen enkele cel boven 3,45 V.</p>
            )}
          </div>
        ) : null}

        {reeks.length > 1 ? (
          <>
            <div className={`${KAART} mb-3 p-4`}>
              <h2 className="mb-1 text-sm font-semibold text-gray-300">Laagste en hoogste cel</h2>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={reeks} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} minTickGap={36} />
                  <YAxis yAxisId="v" domain={[2.8, 3.6]} ticks={[2.8, 3.0, 3.2, 3.4, 3.6]} tickFormatter={(x) => x.toFixed(1).replace('.', ',')} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
                  <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} />
                  <Tooltip content={<Tip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'var(--chart-tick)' }}>{v}</span>} />
                  <ReferenceLine yAxisId="v" y={3.0} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: '3,0 V', position: 'insideTopLeft', fill: '#ef4444', fontSize: 10 }} />
                  <ReferenceLine yAxisId="v" y={3.45} stroke="var(--chart-ref)" strokeDasharray="4 3" strokeOpacity={0.4} label={{ value: '3,45 V top', position: 'insideBottomLeft', fill: 'var(--chart-tick)', fontSize: 10 }} />
                  <Line yAxisId="soc" type="monotone" dataKey="soc" name="SOC %" stroke={KLEUR_SOC} dot={false} strokeWidth={1.5} strokeOpacity={0.6} isAnimationActive={false} />
                  <Line yAxisId="v" type="monotone" dataKey="max" name="Hoogste cel (V)" stroke={KLEUR_MAX} dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Line yAxisId="v" type="monotone" dataKey="min" name="Laagste cel (V)" stroke={KLEUR_MIN} dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-gray-500">Onder 3,0 V (rode lijn) komt de zwakste cel in de knik; boven 3,45 V is de top en balanceert de BMS.</p>
            </div>

            <div className={`${KAART} mb-3 p-4`}>
              <h2 className="mb-1 text-sm font-semibold text-gray-300">Verschil tussen hoogste en laagste cel</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={reeks} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={tickFmt} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} minTickGap={36} />
                  <YAxis domain={[0, (max) => Math.max(0.15, Math.ceil(max * 20) / 20)]} tickFormatter={(x) => `${Math.round(x * 1000)}`} tick={{ fontSize: 10, fill: 'var(--chart-tick)' }} unit=" mV" width={52} />
                  <Tooltip content={<Tip eenheid="mv" />} />
                  <ReferenceLine y={0.03} stroke="#22c55e" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: '30 mV', position: 'insideTopRight', fill: '#22c55e', fontSize: 10 }} />
                  <ReferenceLine y={0.07} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.6} label={{ value: '70 mV', position: 'insideTopRight', fill: '#f59e0b', fontSize: 10 }} />
                  <Line type="monotone" dataKey="verschil" name="Verschil" stroke="#ef4444" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-gray-500">Let op de context: een piek in het midden van het SOC-bereik is meestal belasting (stroom trekt de spanning), alleen onderin en aan de top zegt het verschil iets over balans.</p>
            </div>
          </>
        ) : null}

        {!laden && data && reeks.length <= 1 ? (
          <div className={`${KAART} p-5 text-sm text-gray-400`}>VRM heeft voor deze periode geen celspanningen teruggegeven.</div>
        ) : null}
      </div>
    </main>
  );
}
