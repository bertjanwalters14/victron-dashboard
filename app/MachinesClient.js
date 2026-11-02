'use client';
import { useState, useSyncExternalStore } from 'react';
import TabBar from './TabBar';
import { bepaalAdvies, dagNaam, uurTekst, euro } from '@/lib/machines';

const KAART = 'rounded-2xl border border-gray-800 bg-gray-900/60';

// De klok loopt client-side mee (elke minuut), zodat "nu" en "vandaag/morgen" kloppen zonder dat de pagina opnieuw
// gerenderd hoeft te worden. Op de server is er geen klok: daar tonen we een neutrale laadtekst.
const abonneerOpMinuut = (cb) => { const t = setInterval(cb, 60000); return () => clearInterval(t); };
const minuutNu = () => Math.floor(Date.now() / 60000) * 60000;

const STAND = {
  beste:  { punt: 'bg-green-400', tekst: 'text-green-300', zin: 'Nu is een goed moment om te starten' },
  goed:   { punt: 'bg-green-400', tekst: 'text-green-300', zin: 'Nu is een goed moment' },
  matig:  { punt: 'bg-amber-300', tekst: 'text-amber-300', zin: 'Gaat wel, maar later is goedkoper' },
  duur:   { punt: 'bg-red-400',   tekst: 'text-red-300',   zin: 'Liever even wachten, dit is een duur uur' },
  vlak:   { punt: 'bg-gray-500',  tekst: 'text-gray-300',  zin: 'De prijzen liggen vlak, het maakt weinig uit' },
};

function tijdVan(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit' }) : null;
}

function Balkjes({ advies }) {
  const rijen = advies.rijen.slice(0, 36);
  const prijzen = rijen.map(r => r.prijs);
  const min = Math.min(...prijzen), max = Math.max(...prijzen);
  const gesorteerd = prijzen.slice().sort((a, b) => a - b);
  const laag = gesorteerd[Math.floor((gesorteerd.length - 1) * 0.33)];
  const hoog = gesorteerd[Math.ceil((gesorteerd.length - 1) * 0.67)];
  const b = advies.beste;
  return (
    <div>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label="Prijs per uur, het beste blok is omlijnd">
        {rijen.map(r => {
          const hoogte = max > min ? 22 + Math.round(((r.prijs - min) / (max - min)) * 58) : 40;
          const kleur = r.prijs <= laag ? 'bg-green-400' : r.prijs >= hoog ? 'bg-amber-300' : 'bg-gray-600';
          const inBeste = r.i >= b.start && r.i < b.eind;
          return (
            <div key={r.i} title={`${dagNaam(Math.floor(r.i / 24) - advies.dagNu)} ${uurTekst(r.i)}: ${euro(r.net)} netprijs${r.net - r.prijs > 0.005 ? `, ${euro(r.prijs)} met zon` : ''}`}
              style={{ height: hoogte + 'px' }}
              className={`min-w-0 flex-1 rounded-sm ${kleur} ${inBeste ? 'opacity-100 ring-2 ring-gray-50' : 'opacity-50'}`} />
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[11px] text-gray-500">
        {rijen.map(r => <div key={r.i} className="min-w-0 flex-1 text-center">{r.i % 3 === 0 ? String(r.i % 24).padStart(2, '0') : ''}</div>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-green-400" />goedkoop</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gray-600" />normaal</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300" />duur</span>
      </div>
    </div>
  );
}

export default function MachinesClient({ forecast, bijgewerkt }) {
  const nu = useSyncExternalStore(abonneerOpMinuut, minuutNu, () => null);
  const [uren, setUren] = useState(3);
  const bijMs = bijgewerkt ? Date.parse(bijgewerkt) : NaN;
  const advies = nu == null ? null : bepaalAdvies(forecast, nu, bijMs, uren);
  const oud = nu != null && Number.isFinite(bijMs) && nu - bijMs > 90 * 60000;

  let inhoud;
  if (nu == null) {
    inhoud = <div className={`${KAART} p-5 text-sm text-gray-400`}>Even laden…</div>;
  } else if (!advies) {
    inhoud = (
      <div className={`${KAART} p-5`}>
        <div className="text-base font-medium">Nog geen goed moment om te tonen</div>
        <p className="mt-1 text-sm text-gray-400">
          {forecast && forecast.length
            ? 'Voor de rest van vandaag zijn er niet genoeg uren meer. De prijzen van morgen komen meestal rond 15:00 binnen.'
            : 'Er zijn nog geen prijzen binnengekomen. Probeer het over een paar minuten opnieuw.'}
        </p>
      </div>
    );
  } else {
    const b = advies.beste;
    const stand = advies.nuStand ? STAND[advies.nuStand] : null;
    const verschil = advies.duurste.prijs - b.prijs;
    const dagen = Object.keys(advies.perDag).map(Number).sort((x, y) => x - y);
    inhoud = (
      <>
        {stand ? (
          <div className={`${KAART} mb-3 flex items-center gap-3 p-4`}>
            <span className={`h-3 w-3 shrink-0 rounded-full ${stand.punt}`} />
            <div>
              <div className={`text-sm font-medium ${stand.tekst}`}>Nu: {stand.zin}</div>
              {advies.huidigNet != null ? <div className="text-xs text-gray-400">Dit uur kost {euro(advies.huidigNet)} per kWh{advies.huidigNet - advies.huidigePrijs > 0.005 ? ` (${euro(advies.huidigePrijs)} met zon)` : ''}</div> : null}
            </div>
          </div>
        ) : null}

        <div className={`${KAART} mb-3 p-5`}>
          <div className="text-sm text-gray-400">Beste moment</div>
          <div className="mt-0.5 text-2xl font-bold md:text-3xl">{dagNaam(Math.floor(b.start / 24) - advies.dagNu)} {uurTekst(b.start)} tot {uurTekst(b.eind)}</div>
          <div className="mt-1 text-sm text-gray-400">
            gemiddeld {euro(b.prijs)} per kWh · {b.zon >= 2 ? 'met zon erbij' : 'zon is er nauwelijks'}
            {b.net - b.prijs > 0.005 ? <span className="block text-xs text-gray-500">netprijs {euro(b.net)}, de zon scheelt {euro(b.net - b.prijs)} per kWh</span> : null}
          </div>

          <div className="mt-4 mb-4"><Balkjes advies={advies} /></div>

          {dagen.length > 1 ? (
            <div className="mb-4 divide-y divide-gray-800 rounded-xl border border-gray-800 text-sm">
              {dagen.map(d => {
                const x = advies.perDag[d];
                return (
                  <div key={d} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-gray-300">{dagNaam(d)} {uurTekst(x.start)} tot {uurTekst(x.eind)}</span>
                    <span className="text-gray-400">{euro(x.prijs)}{x === b ? ' · beste' : ''}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="border-t border-gray-800 pt-3 text-sm text-gray-400">
            {verschil < 0.03
              ? 'De prijzen liggen bijna vlak: het maakt weinig uit wanneer je de machines aanzet.'
              : <>Wasmachine (ca. 1 kWh): <span className="font-medium text-gray-100">{euro(verschil, 2)} goedkoper</span> dan op het duurste moment. Droger (ca. 2,5 kWh): {euro(verschil * 2.5, 2)}.</>}
          </div>
        </div>
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-5 md:py-8">
        <TabBar />
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Machines aanzetten</h1>
            <p className="text-sm text-gray-400">Het goedkoopste moment voor wasmachine, droger en vaatwasser.</p>
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">Duur van het programma</div>
            <div className="inline-flex gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1" role="group" aria-label="Duur van het programma">
              {[2, 3].map(n => (
                <button key={n} type="button" onClick={() => setUren(n)} aria-pressed={uren === n}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${uren === n ? 'bg-gray-800 text-gray-50' : 'text-gray-400 hover:text-gray-200'}`}>{n} uur</button>
              ))}
            </div>
          </div>
        </div>

        {inhoud}

        {oud ? (
          <div className="mb-3 rounded-2xl border border-amber-800/60 bg-amber-900/30 p-3 text-sm text-amber-200">
            De gegevens zijn van {tijdVan(bijgewerkt)}. De prijzen kunnen inmiddels zijn bijgewerkt.
          </div>
        ) : null}

        <p className="mt-3 text-xs text-gray-500">
          Gebaseerd op de uurprijzen en de zonverwachting{tijdVan(bijgewerkt) ? ` (bijgewerkt om ${tijdVan(bijgewerkt)})` : ''}. Zonnestroom die je zelf gebruikt telt zwaarder mee, uitgaand van de lagere terugleververgoeding na het einde van de saldering (1 januari 2027). Het advies verandert niets aan de sturing van de accu.
        </p>
      </div>
    </main>
  );
}
