'use client';
import { useCallback, useEffect, useState } from 'react';
import { verschilKleur, celStand, isZwakkeCel, leeftijdTekst, normaliseerCellen, PACK_ROL, OUD_NA_MS } from '@/lib/cellen';

const KAART = 'rounded-2xl border border-gray-800 bg-gray-900/60';
const VERVERS_MS = 20 * 60000;   // gelijk aan de push-interval: vaker ophalen levert niets nieuws en houdt Neon wakker

const v3 = (x) => (x == null ? '—' : x.toFixed(3).replace('.', ','));
const nl1 = (x) => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const tijdKort = (t) => new Date(t).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });

const DIFF_KLEUR = {
  groen: 'border-green-700/60 bg-green-900/30 text-green-300',
  oranje: 'border-amber-700/60 bg-amber-900/30 text-amber-300',
  rood: 'border-red-700/60 bg-red-900/30 text-red-300',
  grijs: 'border-gray-700 bg-gray-800/60 text-gray-300',
};

function Cel({ pack, nr, v, min, max, minCel, maxCel }) {
  const stand = celStand(v);
  // Bij gelijke waarden (3 decimalen) telt alleen de cel die de meetflow als laagste/hoogste aanwees; zonder die aanwijzing de eerste met die waarde.
  const verschilt = min !== null && max !== null && max !== min;
  const isMin = verschilt && v !== null && (minCel != null ? nr === minCel : v === min);
  const isMax = verschilt && v !== null && (maxCel != null ? nr === maxCel : v === max);
  const zwak = isZwakkeCel(pack, nr);
  // Rand: laagste = amber, hoogste = blauw; een cel onder 3,05 V of boven 3,45 V krijgt een felle rode rand en een uitroepteken.
  const rand = stand === 'laag' || stand === 'top' ? 'border-red-500 bg-red-900/40'
    : isMin ? 'border-amber-500/80 bg-gray-800/60'
    : isMax ? 'border-blue-500/80 bg-gray-800/60'
    : 'border-gray-700 bg-gray-800/40';
  const mvBoven = v !== null && min !== null ? Math.round((v - min) * 1000) : null;
  return (
    <div className={`relative rounded-lg border px-1.5 py-1.5 text-center ${rand}`} title={zwak ? 'De zwakke cel (cel 14 van pack 01)' : undefined}>
      <div className="flex items-center justify-center gap-1 text-[10px] text-gray-400">
        <span>cel {nr}</span>
        {stand === 'laag' || stand === 'top' ? <span className="text-red-300" aria-label={stand === 'laag' ? 'onder 3,05 V' : 'boven 3,45 V'}>⚠</span> : null}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${stand === 'laag' || stand === 'top' ? 'text-red-300' : ''}`}>{v3(v)}</div>
      <div className="text-[10px] tabular-nums text-gray-500">{mvBoven === null ? '—' : `+${mvBoven} mV`}</div>
      {isMin ? <span className="absolute -top-1.5 right-1 rounded bg-amber-500 px-1 text-[9px] font-semibold text-gray-950">laagste</span> : null}
      {isMax ? <span className="absolute -top-1.5 right-1 rounded bg-blue-500 px-1 text-[9px] font-semibold text-white">hoogste</span> : null}
      {zwak ? <span className="absolute -bottom-1.5 left-1 rounded bg-fuchsia-600 px-1 text-[9px] font-semibold text-white">zwak</span> : null}
    </div>
  );
}

function PackKaart({ p, nu }) {
  const kleur = verschilKleur(p.diff);
  const bekend = p.cellen.some(x => x !== null);
  const leeftijd = p.t != null ? nu - p.t : null;
  const rol = PACK_ROL[p.pack];
  return (
    <div className={`${KAART} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Pack {p.pack}{rol ? <span className="ml-2 text-xs font-normal text-gray-400">{rol}</span> : null}</h3>
        <span className={`rounded-lg border px-2.5 py-1 text-sm font-semibold tabular-nums ${DIFF_KLEUR[kleur]}`} title="Verschil tussen hoogste en laagste cel">
          {p.diff == null ? 'verschil —' : `verschil ${Math.round(p.diff * 1000)} mV`}
        </span>
      </div>

      {!p.online ? (
        <div className="mb-3 rounded-xl border border-amber-800/60 bg-amber-900/30 p-3 text-sm text-amber-200">
          Dit pack geeft geen gegevens door{p.t != null ? ` (laatste teken van leven ${tijdKort(p.t)}, ${leeftijdTekst(leeftijd)})` : ''}.
        </div>
      ) : null}

      {bekend ? (
        <div className="grid grid-cols-4 gap-2.5 pb-1.5 pt-1.5 sm:grid-cols-8">
          {p.cellen.map((v, k) => <Cel key={k} pack={p.pack} nr={k + 1} v={v} min={p.min} max={p.max} minCel={p.minCel} maxCel={p.maxCel} />)}
        </div>
      ) : (
        <div className="rounded-xl bg-gray-800/40 p-3 text-sm text-gray-400">Geen celspanningen beschikbaar voor dit pack.</div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
        <span>SOC <b className="tabular-nums">{p.soc == null ? '—' : `${Math.round(p.soc)}%`}</b></span>
        <span><b className="tabular-nums">{nl1(p.v)}</b> V</span>
        <span title="Positief is laden, negatief is ontladen"><b className="tabular-nums">{p.i == null ? '—' : `${p.i > 0 ? '+' : ''}${nl1(p.i)}`}</b> A</span>
        <span><b className="tabular-nums">{p.temp == null ? '—' : Math.round(p.temp)}</b> °C</span>
        <span>Balanceert: <b className={p.balancing ? 'text-blue-300' : ''}>{p.balancing === null ? 'onbekend' : p.balancing ? 'ja' : 'nee'}</b></span>
      </div>
      {p.minCel != null && p.maxCel != null ? (
        <div className="mt-1 text-xs text-gray-500">Laagste cel {p.minCel} ({v3(p.min)} V), hoogste cel {p.maxCel} ({v3(p.max)} V).</div>
      ) : null}
    </div>
  );
}

export default function CelKaart() {
  const [cellen, setCellen] = useState(undefined);   // undefined = laden, null = geen data, object = data
  const [bijgewerkt, setBijgewerkt] = useState(null);
  const [fout, setFout] = useState(null);
  const [nu, setNu] = useState(() => Date.now());

  const haal = useCallback(async () => {
    try {
      const res = await fetch('/api/ess-status');
      const j = await res.json();
      setCellen(normaliseerCellen(j.cellen));
      setBijgewerkt(j.bijgewerkt || null);
      setFout(null);
    } catch (e) {
      setFout(e.message || 'Laden mislukt');
      setCellen(prev => (prev === undefined ? null : prev));
    }
  }, []);

  useEffect(() => {
    haal();
    const t = setInterval(haal, VERVERS_MS);
    const k = setInterval(() => setNu(Date.now()), 30000);   // alleen de klok voor "x min geleden", geen netwerk
    return () => { clearInterval(t); clearInterval(k); };
  }, [haal]);

  const meting = cellen?.t ?? null;
  const oud = meting != null && nu - meting > OUD_NA_MS;

  return (
    <section className="mb-4" aria-label="Celspanningen per pack">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Cellen per pack</h2>
          <p className="text-xs text-gray-400">
            {meting != null ? `Gemeten om ${tijdKort(meting)} (${leeftijdTekst(nu - meting)}).` : 'Alle 16 celspanningen per pack, uit de meetflow op de Cerbo.'}
            {' '}Komt mee met de status-push (elke 20 minuten of via "Ververs nu" op de Live-pagina).
          </p>
        </div>
        <button type="button" onClick={haal} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200">Opnieuw laden</button>
      </div>

      {fout ? <div className={`${KAART} mb-3 p-3 text-sm text-red-300`}>Het laden is mislukt: {fout}</div> : null}

      {cellen === undefined ? <div className={`${KAART} p-4 text-sm text-gray-400`}>Even laden…</div> : null}

      {cellen === null ? (
        <div className={`${KAART} p-4 text-sm text-gray-400`}>
          Nog geen celdata ontvangen. De meetflow "Celspanningen" moet draaien en de push-node moet de celdata meesturen; daarna verschijnt hier binnen 20 minuten de eerste meting.
          {bijgewerkt ? ` (Laatste status-push: ${tijdKort(bijgewerkt)}.)` : ''}
        </div>
      ) : null}

      {cellen ? (
        <>
          {oud ? (
            <div className="mb-3 rounded-2xl border border-amber-800/60 bg-amber-900/30 p-3 text-sm text-amber-200">
              De meting is {leeftijdTekst(nu - meting).replace(' geleden', '')} oud. De push of de meetflow staat mogelijk stil.
            </div>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {cellen.packs.map(p => <PackKaart key={p.pack} p={p} nu={nu} />)}
          </div>
          <p className="mt-2 px-1 text-xs text-gray-500">
            Het verschil is groen onder 30 mV, oranje tot 100 mV en rood daarboven. Een cel onder 3,05 V (knik onderin) of boven 3,45 V (top, de BMS balanceert vanaf 3,40 V) krijgt een rode rand.
            In het midden van het bereik zijn LFP-cellen toch vlak, dus dan zegt een klein verschil weinig. Er is bewust geen geschiedenis per cel in de app; die staat in de CSV van de meetflow.
          </p>
        </>
      ) : null}
    </section>
  );
}
