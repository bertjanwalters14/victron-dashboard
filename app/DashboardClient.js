'use client';
import { useState, useEffect } from 'react';
import BatteryBadge from './BatteryBadge';

const BATTERIJ_KOSTEN   = 11252;
const INSTALLATIE_DATUM = new Date('2026-04-04');

const INFO = {
  meerwaarde:   'Wat de batterij écht heeft opgeleverd t.o.v. geen batterij: exportopbrengst + vermeden inkoop − laadkosten − slijtage, min de gemiste exportwaarde van zon die de accu in ging i.p.v. het net op (gewaardeerd tegen de kale marktprijs, zonder opslag/belasting/BTW — dat is geen netstroom-transactie). Dit groeit elke dag automatisch en is leidend voor ROI en terugverdientijd hieronder.',
  roi:          'Hoeveel procent van je €11.252 investering je al hebt terugverdiend, op basis van de batterij-meerwaarde. Stijgt naarmate de batterij meer oplevert.',
  dagwinst:     'Het gemiddelde bedrag dat de batterij per dag écht oplevert (batterij-meerwaarde). Wordt nauwkeuriger naarmate er meer data beschikbaar is.',
  terugverdien: 'De geschatte datum waarop je je volledige investering van €11.252 hebt terugverdiend. Gebaseerd op de huidige gemiddelde dagwinst (batterij-meerwaarde).',
};

export default function DashboardClient({ data }) {
  // totaalWinst = ruwe batterij-actie-waarde (blijft in de DB, o.a. voor de nachtelijke sync), maar is
  // niet meer leidend op het dashboard: totaalMeerwaarde (t.o.v. geen batterij) is de eerlijkere maatstaf
  // en drijft ROI/dagwinst/terugverdientijd.
  const totaalWinst        = data.reduce((s, d) => s + parseFloat(d.winst_euro || 0), 0);
  const totaalMeerwaarde   = data.reduce((s, d) => s + parseFloat(d.bat_meerwaarde ?? d.winst_euro ?? 0), 0);
  const aantalDagenData    = data.length;
  const gemDagwinst        = aantalDagenData > 0 ? totaalMeerwaarde / aantalDagenData : 0;
  const dagenTerugverdiend = gemDagwinst > 0 ? BATTERIJ_KOSTEN / gemDagwinst : null;
  const terugverdienDatum  = dagenTerugverdiend
    ? new Date(INSTALLATIE_DATUM.getTime() + dagenTerugverdiend * 86400000)
    : null;
  const roiPct = (totaalMeerwaarde / BATTERIJ_KOSTEN) * 100;
  const gisterenMeerwaarde = aantalDagenData > 0 ? parseFloat(data[aantalDagenData - 1].bat_meerwaarde ?? data[aantalDagenData - 1].winst_euro ?? 0) : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">⚡ Victron Batterij ROI</h1>
            <p className="text-gray-400 mt-1">Installatie: 4 april 2026 · Investering: €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')} <span className="text-green-600 text-xs">(incl. BTW teruggave)</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RefreshButton />
            <a href="/jaaroverzicht" className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold whitespace-nowrap">📅 Jaaroverzicht →</a>
            <a href="/ess" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold whitespace-nowrap">⚡ Live sturing →</a>
            <AccuBadge />
          </div>
        </div>

        <LiveVandaag gisterenWinst={gisterenMeerwaarde} />

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
            <Card
              label="Batterij-meerwaarde" value={`€${totaalMeerwaarde.toFixed(2)}`} color="text-green-400"
              sub="t.o.v. geen batterij, sinds installatie"
              info={INFO.meerwaarde}
            />
            <Card label="ROI"           value={`${roiPct.toFixed(2)}%`}      color="text-blue-400"   sub="van €11.252" info={INFO.roi} />
            <Card label="Gem. dagwinst" value={`€${gemDagwinst.toFixed(2)}`} color="text-yellow-400" sub={`over ${aantalDagenData} dag${aantalDagenData !== 1 ? 'en' : ''} data`} info={INFO.dagwinst} />
            <Card
              label="Terugverdiend op"
              value={terugverdienDatum ? terugverdienDatum.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' }) : '—'}
              color="text-purple-400"
              sub={dagenTerugverdiend ? `over ${Math.round(dagenTerugverdiend / 365 * 10) / 10} jaar` : 'nog berekening nodig'}
              info={INFO.terugverdien}
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-gray-500 text-xs">Terugverdien-voortgang</span>
              <span className="text-gray-300 text-xs font-medium">€{totaalMeerwaarde.toFixed(0)} / €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2.5">
              <div className="bg-gradient-to-r from-green-500 to-emerald-400 h-2.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(roiPct, 100)}%` }} />
            </div>
          </div>
          {aantalDagenData < 14 && (
            <p className="text-xs text-yellow-500 mt-3">
              ⚠️ Nog maar {aantalDagenData} dag{aantalDagenData !== 1 ? 'en' : ''} data beschikbaar — cijfers worden betrouwbaarder na 14+ dagen.
            </p>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Data wordt elke nacht om 00:01 automatisch bijgewerkt
        </p>
      </div>
    </main>
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

// Haalt alleen de SOC op uit /api/ess-status (client-side, geen secret nodig, read-only) -- zodat
// de server-component z'n 6-uur-cache behoudt terwijl de accu-stand toch vers blijft. Eenmalig bij
// het laden van de pagina (geen interval): dit is een ROI-overzicht, geen live-monitoring -- daarvoor
// is er de "Live sturing"-link naar /ess.
function AccuBadge() {
  const [soc, setSoc] = useState(null);

  useEffect(() => {
    fetch('/api/ess-status')
      .then(r => r.json())
      .then(j => { if (j.success && j.status?.soc != null) setSoc(j.status.soc); })
      .catch(() => {});
  }, []);

  return <BatteryBadge pct={soc} />;
}

function LiveVandaag({ gisterenWinst }) {
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
    const iv = setInterval(fetchLive, 60 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const notes = [
    tijd ? `Bijgewerkt om ${tijd} · ververst elk uur` : null,
    gisterenWinst != null ? `Gisteren: €${gisterenWinst.toFixed(2)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="bg-gradient-to-r from-green-900 to-emerald-800 rounded-xl p-5 mb-6 flex justify-between items-center">
      <div>
        <p className="text-green-300 text-sm font-medium">⚡ Vandaag (lopend)</p>
        <p className="text-3xl font-bold text-white mt-1">{loading ? '...' : `€${winst}`}</p>
        {notes && <p className="text-green-400 text-xs mt-1">{notes}</p>}
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
