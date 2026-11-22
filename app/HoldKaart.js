'use client';
import { useRouter } from 'next/navigation';
import { holdSamenvatting, HOLD } from '@/lib/hold';
import { useVerversNu, VERVERS_TEKST } from './useVerversNu';

const KAART = 'rounded-2xl border border-blue-800/60 bg-blue-900/20';
const tijdKort = (ms) => new Date(ms).toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' });
const duur = (min) => (min >= 60 ? `${Math.floor(min / 60)} u${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

// Kaart "Hold op de top" op de Live-pagina: laat zien dat de sturing de accu bewust op de top vasthoudt om te balanceren, hoe ver hij is en wanneer hij stopt.
// Alleen zichtbaar als de hold loopt (of net is afgerond); de gegevens komen uit status.dbg en de celdata per pack van dezelfde push.
export default function HoldKaart({ status, cellen, bijgewerkt }) {
  const router = useRouter();
  const { fase, vraag } = useVerversNu(async () => router.refresh());
  const h = holdSamenvatting(status, cellen, bijgewerkt);
  if (!h) return null;

  if (h.klaar) {
    return (
      <div className="mb-3 rounded-2xl border border-gray-700 bg-gray-800/40 p-3 text-sm text-gray-300">
        De hold op de top is voor vandaag afgerond. De accu volgt weer de gewone planning.
      </div>
    );
  }

  const topPct = h.topMin == null ? 0 : Math.min(100, Math.round((h.topMin / HOLD.TOP_MIN_MINUTEN) * 100));
  return (
    <section className={`${KAART} mb-3 p-4`} aria-label="Hold op de top">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-blue-300">Hold op de top</h2>
        <span className="text-xs text-gray-400">de accu wordt vastgehouden zodat de BMS kan balanceren</span>
        <button type="button" onClick={vraag} disabled={fase === 'wacht'} aria-live="polite"
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-70 ${fase === 'mislukt' ? 'border-red-700/60 bg-red-900/30 text-red-300' : fase === 'klaar' ? 'border-green-700/60 bg-green-900/30 text-green-300' : 'border-blue-700/60 bg-blue-900/30 text-blue-300 hover:text-blue-200'}`}>{VERVERS_TEKST[fase]}</button>
      </div>

      <div className="mt-2">
        <div className="mb-1 flex justify-between text-xs text-gray-400">
          <span>Op de top: {h.topMin == null ? 'onbekend' : duur(h.topMin)}</span>
          <span>{h.topVoldoende ? 'minimale duur gehaald' : h.topNog != null ? `nog minstens ${duur(h.topNog)}` : ''}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-800" role="progressbar" aria-valuenow={topPct} aria-valuemin={0} aria-valuemax={100} aria-label="Duur op de top">
          <div className={`h-full rounded-full ${h.topVoldoende ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${topPct}%` }} />
        </div>
      </div>

      {h.packs ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {h.packs.map(p => (
            <div key={p.naam} className="flex items-center justify-between gap-2 rounded-xl bg-gray-800/50 px-3 py-2 text-sm">
              <span className="text-gray-300">Pack {p.naam}</span>
              <span className="tabular-nums">
                <b className={p.goed ? 'text-green-300' : (p.mv != null && p.mv > 100 ? 'text-red-300' : 'text-amber-300')}>{p.mv == null ? '—' : `${p.mv} mV`}</b>
                <span className="ml-1 text-xs text-gray-500">doel ≤ {HOLD.PACK_GRENS_MV}</span>
                {p.balancing === 1 ? <span className="ml-2 text-xs text-blue-300">balanceert</span> : p.balancing === 0 ? <span className="ml-2 text-xs text-gray-500">balanceert niet</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-gray-800/50 px-3 py-2 text-sm text-gray-300">
          Geen celdata per pack beschikbaar: verschil over alle cellen {h.systeemMv == null ? '—' : <b className={h.allesGoed ? 'text-green-300' : 'text-amber-300'}>{h.systeemMv} mV</b>} <span className="text-xs text-gray-500">(doel &lt; {HOLD.SYSTEEM_GRENS_MV})</span>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        Eindigt zodra {h.packs ? 'beide packs' : 'de cellen'} {h.packs ? `binnen ${HOLD.PACK_GRENS_MV} mV` : `binnen ${HOLD.SYSTEEM_GRENS_MV} mV`} zijn en de top minstens {HOLD.TOP_MIN_MINUTEN / 60} uur heeft geduurd{h.uiterlijkMs != null ? `, uiterlijk rond ${tijdKort(h.uiterlijkMs)}` : ''}.
        {' '}Verkopen is zolang geblokkeerd, ook in een piekuur: de balans gaat eerst af.
        {' '}De cijfers komen uit de laatste status-push en lopen tot ongeveer 20 minuten achter.
      </p>
    </section>
  );
}
