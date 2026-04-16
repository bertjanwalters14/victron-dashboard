'use client';
import { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea, ComposedChart, Area } from 'recharts';

const BATTERIJ_KOSTEN   = 11252;
const INSTALLATIE_DATUM = new Date('2026-04-04');
const MAAND_NAMEN       = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];

const INFO = {
  winst:        'Het totale bedrag dat de batterij heeft opgeleverd sinds installatie. Dit groeit elke dag automatisch.',
  roi:          'Hoeveel procent van je €11.252 investering je al hebt terugverdiend. Stijgt naarmate de batterij meer oplevert.',
  dagwinst:     'Het gemiddelde bedrag dat de batterij per dag oplevert. Wordt nauwkeuriger naarmate er meer data beschikbaar is.',
  terugverdien: 'De geschatte datum waarop je je volledige investering van €11.252 hebt terugverdiend. Gebaseerd op de huidige gemiddelde dagwinst.',
  projectie:    'Schatting op basis van het gemiddelde van alle beschikbare dagen. Wordt nauwkeuriger naarmate er meer data is.',
};

export default function DashboardClient({ data }) {
  const totaalWinst        = data.reduce((s, d) => s + parseFloat(d.winst_euro || 0), 0);
  const aantalDagenData    = data.length;
  const gemDagwinst        = aantalDagenData > 0 ? totaalWinst / aantalDagenData : 0;
  const dagenTerugverdiend = gemDagwinst > 0 ? BATTERIJ_KOSTEN / gemDagwinst : null;
  const terugverdienDatum  = dagenTerugverdiend
    ? new Date(INSTALLATIE_DATUM.getTime() + dagenTerugverdiend * 86400000)
    : null;
  const roiPct             = (totaalWinst / BATTERIJ_KOSTEN) * 100;
  const maandProjectie     = gemDagwinst * 30;
  const jaarProjectie      = gemDagwinst * 365;
  const terugverdienJaren  = gemDagwinst > 0 ? (BATTERIJ_KOSTEN / (gemDagwinst * 365)).toFixed(1) : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">

        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">⚡ Victron Batterij ROI</h1>
            <p className="text-gray-400 mt-1">Installatie: 4 april 2026 · Investering: €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')} <span className="text-green-600 text-xs">(incl. BTW teruggave)</span></p>
          </div>
          <RefreshButton />
        </div>

        <LiveVandaag />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card label="Totale winst"    value={`€${totaalWinst.toFixed(2)}`}  color="text-green-400"  sub="sinds installatie"      info={INFO.winst} />
          <Card label="ROI"             value={`${roiPct.toFixed(2)}%`}        color="text-blue-400"   sub="van €11.252"             info={INFO.roi} />
          <Card label="Gem. dagwinst"   value={`€${gemDagwinst.toFixed(2)}`}   color="text-yellow-400" sub={`over ${aantalDagenData} dag${aantalDagenData !== 1 ? 'en' : ''} data`} info={INFO.dagwinst} />
          <Card
            label="Terugverdiend op"
            value={terugverdienDatum ? terugverdienDatum.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' }) : '—'}
            color="text-purple-400"
            sub={dagenTerugverdiend ? `over ${Math.round(dagenTerugverdiend / 365 * 10) / 10} jaar` : 'nog berekening nodig'}
            info={INFO.terugverdien}
          />
        </div>

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold text-gray-200">📈 Projectie</h2>
            <span className="text-xs text-gray-500">op basis van {aantalDagenData} dag{aantalDagenData !== 1 ? 'en' : ''} data</span>
            <InfoIcon text={INFO.projectie} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ProjectieCard label="Per maand"       value={`€${maandProjectie.toFixed(0)}`} sub="geschatte maandwinst" color="text-emerald-400" />
            <ProjectieCard label="Per jaar"         value={`€${jaarProjectie.toFixed(0)}`}  sub="geschatte jaarwinst" color="text-teal-400" />
            <ProjectieCard
              label="Terugverdientijd"
              value={terugverdienJaren ? `${terugverdienJaren} jaar` : '—'}
              sub={terugverdienJaren ? `≈ €${(gemDagwinst * 365).toFixed(0)}/jaar nodig` : 'nog geen data'}
              color={terugverdienJaren && parseFloat(terugverdienJaren) < 10 ? 'text-green-400' : 'text-orange-400'}
            />
          </div>
          {aantalDagenData < 14 && (
            <p className="text-xs text-yellow-500 mt-4">
              ⚠️ Nog maar {aantalDagenData} dag{aantalDagenData !== 1 ? 'en' : ''} data beschikbaar — projectie wordt betrouwbaarder na 14+ dagen.
            </p>
          )}
        </div>

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-300 font-medium">Terugverdien voortgang</span>
            <span className="text-white font-bold text-lg">{roiPct.toFixed(2)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-5">
            <div className="bg-gradient-to-r from-green-500 to-emerald-400 h-5 rounded-full transition-all duration-500" style={{ width: `${Math.min(roiPct, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>€0</span>
            <span>€{(BATTERIJ_KOSTEN / 2).toLocaleString('nl-NL')}</span>
            <span>€{BATTERIJ_KOSTEN.toLocaleString('nl-NL')}</span>
          </div>
        </div>

        <SeizoenProjectie maandActueel={maandActueel(data)} />

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-gray-200 mb-4">Recente dagen</h2>
          {data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-700">
                    <th className="text-left py-2">Datum</th>
                    <th className="text-right py-2">Zon (kWh)</th>
                    <th className="text-right py-2">Naar net</th>
                    <th className="text-right py-2">Winst</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data].reverse().slice(0, 8).map(d => (
                    <tr key={d.datum} className="border-b border-gray-700">
                      <td className="py-2 text-gray-300">{new Date(d.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}</td>
                      <td className="py-2 text-right text-yellow-400">{parseFloat(d.solar_yield_kwh || 0).toFixed(1)}</td>
                      <td className="py-2 text-right text-blue-400">{parseFloat(d.net_export_kwh || 0).toFixed(2)}</td>
                      <td className="py-2 text-right text-green-400 font-medium">€{parseFloat(d.winst_euro || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-16 flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
          )}
        </div>

        <OnbalansTegel />
        {/* <TennetOnbalans /> */}
        {/* <EssSetpuntControle /> */}
        <p className="text-center text-gray-600 text-xs mt-6">
          Data wordt elke nacht om 00:01 automatisch bijgewerkt
        </p>
      </div>
    </main>
  );
}

function wattLabel(w) {
  if (w == null) return '—';
  const abs = Math.abs(w);
  return abs >= 1000 ? `${(abs / 1000).toFixed(1)} kW` : `${abs} W`;
}

function minsGeleden(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)  return '< 1 min geleden';
  if (diff === 1) return '1 min geleden';
  if (diff < 60) return `${diff} min geleden`;
  return `${Math.floor(diff / 60)}u geleden`;
}

function OnbalansTegel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [modus, setModus]     = useState('handel');

  async function fetchOnbalans() {
    try {
      const res  = await fetch(`/api/onbalans?secret=Nummer14!&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
        if (json.modus) setModus(json.modus);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => {
    fetchOnbalans();
    const iv = setInterval(fetchOnbalans, 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const beslissing = data?.beslissing;
  const adviesKleur = beslissing === 'laden'    ? 'text-green-400'
    : beslissing === 'ontladen' ? 'text-red-400'
    : beslissing === 'stop'     ? 'text-red-600'
    : 'text-orange-400';
  const bgKleur = beslissing === 'laden'    ? 'from-green-950 to-emerald-900 border border-green-800'
    : beslissing === 'ontladen' ? 'from-red-950 to-red-900 border border-red-800'
    : beslissing === 'stop'     ? 'from-red-950 to-rose-950 border border-red-900'
    : 'from-orange-950 to-gray-900 border border-orange-900';
  const emoji = beslissing === 'laden'    ? '🟢'
    : beslissing === 'ontladen' ? '🔴'
    : beslissing === 'stop'     ? '🛑' : '🟠';

  const battPower    = (data?.solarW ?? 0) + (data?.gridW ?? 0) - (data?.verbruikW ?? 0);
  const battRichting = battPower > 150 ? '↑ laden' : battPower < -150 ? '↓ ontladen' : 'standby';
  const battKleur    = battPower > 150 ? 'text-green-400' : battPower < -150 ? 'text-orange-400' : 'text-gray-400';
  const gridImport   = (data?.gridW ?? 0) >= 0;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6 space-y-5">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-gray-100 text-lg">⚡ Markt &amp; Energieflow</h2>
        <ModusToggle modus={modus} onWissel={setModus} />
      </div>

      {/* ── Adviesblok ── */}
      <div className={`bg-gradient-to-r ${bgKleur} rounded-xl p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3`}>
        <div>
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-1">
            Huidig advies · {modus === 'groen' ? 'Groen modus' : 'Handel modus'}
          </p>
          <p className={`text-3xl font-extrabold tracking-tight ${adviesKleur}`}>
            {loading ? '…' : `${emoji} ${beslissing?.toUpperCase() ?? '—'}`}
          </p>
          <p className="text-gray-400 text-sm mt-1 leading-snug max-w-xs">{data?.reden ?? ''}</p>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-gray-500 text-xs uppercase tracking-wide">Consumentenprijs nu</p>
          <p className="text-3xl font-bold text-white mt-0.5">
            {data?.prijs != null ? `€\u00A0${data.prijs.toFixed(4)}` : '—'}
          </p>
          <p className="text-gray-500 text-xs mt-1">
            EPEX spot&nbsp;
            <span className="text-gray-300">{data?.spotprijs != null ? `€\u00A0${data.spotprijs.toFixed(4)}` : '—'}</span>
            &ensp;·&ensp;{data?.prijsBron ?? ''}
          </p>
        </div>
      </div>

      {/* ── Staleness waarschuwing ── */}
      {data?.socTijdstip && (() => {
        const oudheidMin = Math.floor((Date.now() - new Date(data.socTijdstip).getTime()) / 60000);
        if (oudheidMin >= 5) return (
          <div className="bg-yellow-900 border border-yellow-700 rounded-lg px-4 py-2 text-yellow-300 text-sm flex items-center gap-2">
            ⚠️ Sensordata is <strong>{oudheidMin} minuten oud</strong> — Node-RED stuurt mogelijk geen data meer.
            Controleer <a href="http://192.168.178.17:1881" target="_blank" rel="noreferrer" className="underline">Node-RED</a>.
          </div>
        );
        return null;
      })()}

      {/* ── Live energieflow ── */}
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Live energieflow</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <FlowCard icon="☀️" label="Zon"        value={wattLabel(data?.solarW)}    sub="productie"                            kleur="text-amber-400" />
          <FlowCard icon="🏠" label="Verbruik"   value={wattLabel(data?.verbruikW)}  sub="totaal huis"                          kleur="text-white" />
          <FlowCard icon="⚡" label="Essentieel" value={wattLabel(data?.essentieelW)} sub="op omvormer-uitgang"
            kleur={data?.essentieelW != null ? 'text-orange-300' : 'text-gray-600'}
            badge={data?.essentieelW != null && data?.verbruikW ? `${Math.round(data.essentieelW / data.verbruikW * 100)}% v/h totaal` : '— nog geen data'} />
          <FlowCard icon="🔌" label="Net"         value={wattLabel(data?.gridW)}      sub={gridImport ? 'import ↓' : 'export ↑'} kleur={gridImport ? 'text-red-400' : 'text-green-400'} />
          <FlowCard
            icon="🔋" label="Batterij"
            value={data?.batterijPct != null ? `${data.batterijPct}%` : '—'}
            sub={battRichting}
            kleur={battKleur}
            badge={data?.socTijdstip ? minsGeleden(data.socTijdstip) : null}
          />
        </div>
      </div>

      {/* ── Drempels ── */}
      <div className="bg-gray-750 rounded-lg px-4 py-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm border border-gray-700">
        <span className="text-gray-400">
          Ontladen boven&nbsp;
          <span className="text-green-400 font-semibold">
            {data?.drempels?.ontladen != null ? `€${data.drempels.ontladen.toFixed(4)}` : '—'}
          </span>
          <span className="text-gray-600 text-xs ml-1">(p{data?.drempels?.percentiel?.ontladen ?? 75})</span>
        </span>
        <span className="text-gray-600 hidden sm:inline">|</span>
        <span className="text-gray-400">
          Laden onder&nbsp;
          <span className="text-blue-400 font-semibold">
            {data?.drempels?.laden != null ? `€${data.drempels.laden.toFixed(4)}` : '—'}
          </span>
          <span className="text-gray-600 text-xs ml-1">(p{data?.drempels?.percentiel?.laden ?? 25})</span>
        </span>
        <span className="text-gray-600 hidden sm:inline">|</span>
        <span className="text-gray-400">
          Batterijgrens&nbsp;
          <span className="text-red-400 font-semibold">{data?.drempels?.batMin ?? 10}%</span>
          &nbsp;–&nbsp;
          <span className="text-yellow-400 font-semibold">{data?.drempels?.batMax ?? 90}%</span>
        </span>
      </div>

      {/* ── TenneT (indien beschikbaar) ── */}
      {data?.tennet && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">TenneT tekort</p>
            <p className="text-xl font-bold text-orange-400">€{data.tennet.shortage.toFixed(4)}</p>
            <p className="text-gray-500 text-xs mt-0.5">verkoopprijs onbalans</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-3 text-center">
            <p className="text-gray-500 text-xs mb-1">TenneT overschot</p>
            <p className="text-xl font-bold text-cyan-400">€{data.tennet.surplus.toFixed(4)}</p>
            <p className="text-gray-500 text-xs mt-0.5">inkoopprijs onbalans</p>
          </div>
        </div>
      )}

      {/* ── Prijsgrafiek ── */}
      {data?.prijzenVandaag?.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
              Prijzen vandaag (incl. BTW + opslag)
            </p>
            <div className="flex gap-3 text-xs text-gray-500">
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-800 mr-1"/>laden van net</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-800 mr-1"/>zon laadt</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-900 mr-1"/>ontladen</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={data.prijzenVandaag}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />

              {/* Gekleurde achtergrond per uur op basis van zone */}
              {data.prijzenVandaag.map((p, i) => {
                const next = data.prijzenVandaag[i + 1];
                if (!next || p.zone === 'wachten') return null;
                const fill = p.zone === 'ontladen' ? '#7f1d1d'
                  : p.zone === 'zon'    ? '#78350f'
                  : '#14532d'; // laden
                return (
                  <ReferenceArea key={i} x1={p.tijd} x2={next.tijd}
                    fill={fill} fillOpacity={0.35} stroke="none" />
                );
              })}

              <XAxis dataKey="tijd" tick={{ fontSize: 10, fill: '#6B7280' }} interval={3} />
              <YAxis
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickFormatter={v => `€${v.toFixed(2)}`}
                width={46}
                domain={[
                  dataMin => +(Math.min(dataMin, data.drempels?.laden  ?? 0.05) - 0.02).toFixed(2),
                  dataMax => +(Math.max(dataMax, data.drempels?.ontladen ?? 0.25) + 0.02).toFixed(2),
                ]}
              />
              <Tooltip
                formatter={(v, name) => [`€${v.toFixed(4)}`, name === 'prijs' ? 'Consumentenprijs' : 'Spot']}
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }}
                labelStyle={{ color: '#9CA3AF' }}
                labelFormatter={(label) => {
                  const p = data.prijzenVandaag.find(x => x.tijd === label);
                  const zoneLabel = p?.zone === 'ontladen' ? '🔴 ontladen'
                    : p?.zone === 'laden' ? '🟢 laden van net'
                    : p?.zone === 'zon'   ? '☀️ zon laadt'
                    : '🟠 wachten';
                  return `${label}  ${zoneLabel}`;
                }}
              />
              {data.huidigeTijd && (
                <ReferenceLine x={data.huidigeTijd} stroke="#F59E0B" strokeWidth={2}
                  label={{ value: 'nu', fill: '#F59E0B', fontSize: 10, position: 'insideTopLeft' }} />
              )}
              <Line type="monotone" dataKey="prijs" stroke="#93c5fd" dot={false} strokeWidth={2.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Zonneprognose ── */}
      <ZonPrognose zon={data?.zonPrognose} />

      <p className="text-xs text-gray-600 pt-1 border-t border-gray-700">
        Ververst elke minuut&ensp;·&ensp;
        {modus === 'groen' ? 'Groen modus actief' : 'Handel modus actief'}&ensp;·&ensp;
        {data?.tijdstip ? `API ${minsGeleden(data.tijdstip)}` : ''}
      </p>
    </div>
  );
}

function ModusToggle({ modus, onWissel }) {
  const [bezig, setBezig] = useState(false);
  const isGroen = modus === 'groen';

  async function wisselModus() {
    const nieuw = isGroen ? 'handel' : 'groen';
    setBezig(true);
    try {
      const res  = await fetch('/api/modus?secret=Nummer14!', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ modus: nieuw }),
      });
      const json = await res.json();
      if (json.success) onWissel(nieuw);
    } catch(e) { console.error('Modus wisselen mislukt:', e); }
    setBezig(false);
  }

  return (
    <button
      onClick={wisselModus}
      disabled={bezig}
      title={isGroen ? 'Klik om naar Handel modus te wisselen' : 'Klik om naar Groen modus te wisselen'}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
        disabled:opacity-50 select-none
        ${isGroen
          ? 'bg-green-950 border-green-700 text-green-300 hover:bg-green-900'
          : 'bg-blue-950 border-blue-700 text-blue-300 hover:bg-blue-900'
        }`}
    >
      {/* Toggle pill */}
      <span className={`relative inline-flex h-5 w-9 rounded-full transition-colors
        ${isGroen ? 'bg-green-500' : 'bg-blue-500'}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform
          ${isGroen ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
      {bezig ? '…' : isGroen ? 'Groen' : 'Handel'}
    </button>
  );
}

function FlowCard({ icon, label, value, sub, kleur, badge }) {
  return (
    <div className="bg-gray-700 rounded-xl p-3 text-center">
      <p className="text-gray-500 text-xs mb-1">{icon} {label}</p>
      <p className={`text-xl font-bold ${kleur}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-0.5">{sub}</p>
      {badge && <p className="text-gray-600 text-xs mt-0.5">{badge}</p>}
    </div>
  );
}

function ZonPrognose({ zon }) {
  if (!zon) return null;

  // Vandaag gevolgd door morgen op één doorlopende tijdas
  const asAnkers = ['00:00','03:00','06:00','09:00','12:00','15:00','18:00','21:00','23:30'];
  const bouwData = (data, prefix) => {
    const punten = Object.fromEntries(data.filter(d => d.dag === (prefix === 'V' ? 'vandaag' : 'morgen')).map(d => [d.tijd, d.watt]));
    // Voeg ankers toe zodat de X-as altijd de volle dag toont
    asAnkers.forEach(t => { if (!(t in punten)) punten[t] = 0; });
    return Object.entries(punten).sort(([a],[b]) => a.localeCompare(b)).map(([t, watt]) => ({ label: `${prefix} ${t}`, watt, dag: prefix === 'V' ? 'vandaag' : 'morgen' }));
  };
  const aaneengesloten = [...bouwData(zon.grafiekData || [], 'V'), ...bouwData(zon.grafiekData || [], 'M')];

  return (
    <div className="border-t border-gray-700 pt-4 space-y-3">
      {/* Header + totalen */}
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-200">☀️ Zonneprognose</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-1 text-gray-500"><span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />Vandaag&nbsp;<span className="text-amber-400 font-semibold">{zon.vandaagKwh} kWh</span></span>
          <span className="text-gray-500">Gemeten&nbsp;<span className="text-green-400 font-semibold">{zon.vandaagGemeten != null ? `${zon.vandaagGemeten} kWh` : '—'}</span></span>
          <span className="flex items-center gap-1 text-gray-500"><span className="inline-block w-3 h-3 rounded-sm bg-orange-400" />Morgen&nbsp;<span className="text-orange-400 font-semibold">{zon.morgenKwh} kWh</span></span>
        </div>
      </div>

      {/* Doorlopende grafiek: vandaag → morgen, gedeelde Y-as */}
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={aaneengesloten} barCategoryGap="10%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#6B7280' }}
            ticks={['V 00:00','V 03:00','V 06:00','V 09:00','V 12:00','V 15:00','V 18:00','V 21:00','M 00:00','M 03:00','M 06:00','M 09:00','M 12:00','M 15:00','M 18:00','M 21:00']}
            tickFormatter={v => v.slice(2)} />
          <YAxis tick={{ fontSize: 9, fill: '#6B7280' }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} width={28} />
          <Tooltip
            contentStyle={{ background: '#1F2937', border: '1px solid #4B5563', borderRadius: '8px', fontSize: 12, color: '#F9FAFB' }}
            labelStyle={{ color: '#D1D5DB', fontWeight: 600, marginBottom: 2 }}
            itemStyle={{ color: '#FCD34D' }}
            labelFormatter={l => `${l.startsWith('V') ? 'Vandaag' : 'Morgen'} ${l.slice(2)}`}
            formatter={v => [v >= 1000 ? `${(v/1000).toFixed(2)} kW` : `${Math.round(v)} W`]}
          />
          <ReferenceLine x={`M 00:00`} stroke="#4B5563" strokeDasharray="4 2" label={{ value: 'morgen', position: 'insideTopRight', fontSize: 9, fill: '#6B7280' }} />
          <Bar dataKey="watt" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {aaneengesloten.map((d, i) => (
              <Cell key={i} fill={d.dag === 'vandaag' ? '#F59E0B' : '#FB923C'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-xs text-gray-600">📍 Harkstede · 18 × 370Wp · Zuid 0° · 35° helling · Solcast</p>
    </div>
  );
}

function ProjectieCard({ label, value, sub, color }) {
  return (
    <div className="bg-gray-700 rounded-lg p-4 text-center">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-1">{sub}</p>
    </div>
  );
}

function InfoIcon({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="text-gray-500 hover:text-gray-300 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-10 top-full left-0 mt-2 w-56 bg-gray-700 text-gray-200 text-xs rounded-lg p-3 shadow-lg">
          {text}
          <button onClick={() => setOpen(false)} className="mt-2 text-gray-400 hover:text-white block">Sluiten ✕</button>
        </div>
      )}
    </div>
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

function LiveVandaag() {
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
    const iv = setInterval(fetchLive, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="bg-gradient-to-r from-green-900 to-emerald-800 rounded-xl p-5 mb-6 flex justify-between items-center">
      <div>
        <p className="text-green-300 text-sm font-medium">⚡ Vandaag (lopend)</p>
        <p className="text-3xl font-bold text-white mt-1">{loading ? '...' : `€${winst}`}</p>
        {tijd && <p className="text-green-400 text-xs mt-1">Bijgewerkt om {tijd} · ververst elke 15 min</p>}
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

function SeizoenProjectie({ maandActueel = {} }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [fout,    setFout]    = useState(null);

  useEffect(() => {
    fetch('/api/projectie?secret=Nummer14!')
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json);
        else setFout(json.error || 'Geen data');
      })
      .catch(e => setFout(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Verrijk projectiemaanden met actuele 2026-data
  const heeftActueel = Object.keys(maandActueel).length > 0;
  const merged = (data?.maanden || []).map(m => ({
    ...m,
    actueel: maandActueel[m.maand] ?? null,
  }));

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <div className="flex justify-between items-baseline flex-wrap gap-2 mb-3">
        <div>
          <h2 className="font-semibold text-gray-200">📅 Seizoensprojectie 2025 vs. 2026</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Wat zou de batterij hebben verdiend als die er in 2025 al had gestaan?
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500"/>
            Simulatie 2025
          </div>
          {heeftActueel && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="inline-block w-3 h-3 rounded-sm bg-cyan-400"/>
              Werkelijk 2026
            </div>
          )}
          {data && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Geschat jaartotaal</p>
              <p className="text-xl font-bold text-emerald-400">€{data.jaarTotaal?.toFixed(0)}</p>
            </div>
          )}
        </div>
      </div>

      {loading && <p className="text-gray-500 text-sm py-4">Prijzen ophalen &amp; simuleren… (kan ~10 s duren)</p>}
      {fout    && <p className="text-red-400  text-sm py-4">{fout}</p>}

      {data && (
        <>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={merged} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="maand" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `€${v}`} width={42} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const m = payload[0]?.payload;
                  return (
                    <div style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#F9FAFB' }}>
                      <p style={{ fontWeight: 700, marginBottom: 6 }}>{label}</p>
                      <p style={{ color: '#34D399' }}>Simulatie 2025: <strong>€{m.proj?.toFixed(2) ?? '—'}</strong></p>
                      {m.actueel != null && (
                        <p style={{ color: '#22D3EE' }}>Werkelijk 2026: <strong>€{m.actueel?.toFixed(2)}</strong></p>
                      )}
                      <p style={{ color: '#6B7280', marginTop: 6, borderTop: '1px solid #374151', paddingTop: 5 }}>
                        Export 2025: {m.exportKwh} kWh · Import: {m.importKwh} kWh
                      </p>
                      <p style={{ color: '#6B7280' }}>
                        spot p25 €{m.p25spot} · cons p75 €{m.p75}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="proj"    name="Simulatie 2025" radius={[3,3,0,0]} fill="#10B981" isAnimationActive={false} />
              <Bar dataKey="actueel" name="Werkelijk 2026"  radius={[3,3,0,0]} fill="#22D3EE" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-600 mt-2">
            P1 meetdata 2025 · EPEX spotprijzen week 2 per maand · 32 kWh Pylontech
            {data.vanCache ? ' · 📦 uit cache' : ' · 🔄 vers berekend'}
          </p>
        </>
      )}
    </div>
  );
}

function cumulatief(data) {
  let som = 0;
  return data.map(d => ({ datum: d.datum, cumulatief: +(som += parseFloat(d.winst_euro || 0)).toFixed(2) }));
}

// Groepeer dagdata per maandnaam (nl), sommeer winst_euro
function maandActueel(data) {
  const result = {};
  for (const d of data) {
    const key = MAAND_NAMEN[new Date(d.datum).getMonth()];
    result[key] = (result[key] || 0) + parseFloat(d.winst_euro || 0);
  }
  // Rond af op 2 decimalen
  for (const k in result) result[k] = +result[k].toFixed(2);
  return result;
}

// ── TenneT Onbalans Markt ──────────────────────────────────────────────────
const SPIKE_UP_DREMPEL   = 350; // €/MWh — boven dit = echt interessant (duidelijk boven EPEX+belasting)
const SPIKE_DOWN_DREMPEL = 0;   // €/MWh — onder dit (negatief) = interessant om te laden

// ESS setpunt waarden (gedeeld door TennetOnbalans + EssSetpuntControle)
const ESS_LADEN_WATT    =  9000; // +9 kW van net halen (gemeten max: 9.7 kW)
const ESS_ONTLADEN_WATT = -9000; // -9 kW naar net sturen
const ESS_AUTO_WATT     =    50; // Victron ESS standaard

function TennetOnbalans() {
  const [data,        setData]        = useState(null);
  const [live,        setLive]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [fout,        setFout]        = useState(null);
  const [cmdBezig,    setCmdBezig]    = useState(false);
  const [cmdBevestig, setCmdBevestig] = useState(null);

  async function laden() {
    setLoading(true);
    try {
      const res  = await fetch(`/api/tennet?secret=Nummer14!&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setData(json);
      else setFout(json.bericht || json.error || 'Geen data');
    } catch (e) { setFout(e.message); }
    setLoading(false);
  }

  async function stuurSpikeCommando(watt, label, reden) {
    setCmdBezig(true);
    setCmdBevestig(null);
    try {
      const res  = await fetch(`/api/stuur?secret=Nummer14!`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ watt, reden, bron: 'onbalans-spike' }),
      });
      const json = await res.json();
      if (json.success) {
        setCmdBevestig(`✓ ${label} gestuurd — Cerbo past toe binnen ~30 s`);
        setTimeout(() => setCmdBevestig(null), 6000);
      }
    } catch {}
    setCmdBezig(false);
  }

  async function ladenLive() {
    setLiveLoading(true);
    try {
      const res  = await fetch(`/api/tennet?secret=Nummer14!&live=true&t=${Date.now()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setLive(json);
    } catch {}
    setLiveLoading(false);
  }

  useEffect(() => {
    laden();
    ladenLive();
    const iv = setInterval(ladenLive, 30 * 1000);
    return () => clearInterval(iv);
  }, []);

  const stateBarKleur = (state) => {
    if (state === 1)  return '#f87171';
    if (state === -1) return '#60a5fa';
    if (state === 2)  return '#fb923c';
    return '#4b5563';
  };

  // Is het huidige moment een uitschieter?
  const lv           = live?.laatste;
  const isSpike      = lv && (lv.midPrijs >= SPIKE_UP_DREMPEL || lv.midPrijs <= SPIKE_DOWN_DREMPEL);
  const spikeRichting = lv?.midPrijs >= SPIKE_UP_DREMPEL ? 'up' : lv?.midPrijs <= SPIKE_DOWN_DREMPEL ? 'down' : null;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-200">⚡ Onbalans Markt (TenneT)</h2>
        <button onClick={laden} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">↻ verversen</button>
      </div>

      {/* ── Live indicator ── */}
      {isSpike ? (
        // UITSCHIETER — groot en opvallend
        <div className={`rounded-lg px-5 py-4 mb-4 border-2 ${
          spikeRichting === 'up'
            ? 'bg-red-950 border-red-500 animate-pulse'
            : 'bg-blue-950 border-blue-500 animate-pulse'
        }`}>
          <p className="text-xs font-semibold tracking-widest uppercase mb-1 text-yellow-400">
            🚨 Onbalans uitschieter
          </p>
          <p className={`text-2xl font-bold ${spikeRichting === 'up' ? 'text-red-300' : 'text-blue-300'}`}>
            {spikeRichting === 'up'
              ? `↑ ONTLADEN — €${lv.midPrijs}/MWh`
              : `↓ LADEN — €${lv.midPrijs}/MWh (negatief)`}
          </p>
          <p className="text-gray-300 text-sm mt-1">
            {spikeRichting === 'up'
              ? `Prijs boven €${SPIKE_UP_DREMPEL}/MWh — nu ontladen levert veel meer op dan EPEX`
              : `Prijs onder €${SPIKE_DOWN_DREMPEL}/MWh — nu laden kost niets of levert op`}
          </p>
          <p className="text-gray-500 text-xs mt-2">{lv.t} UTC · aFRR↑ {lv.afrrIn} MW / aFRR↓ {lv.afrrOut} MW</p>

          {/* Snelknop — nog niet actief */}
          <div className="mt-3">
            <span className="text-xs text-yellow-600 italic">
              ⚠️ Automatisch handelen nog niet actief — eerst Node-RED op Cerbo GX instellen
            </span>
          </div>
        </div>
      ) : (
        // Rustig — kleine neutrale balk
        <div className="rounded-lg px-4 py-2 mb-4 bg-gray-700 border border-gray-600 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500 inline-block"/>
            <p className="text-gray-400 text-sm">
              {liveLoading ? 'Live laden...' : lv
                ? `Onbalans rustig — €${lv.midPrijs}/MWh · aFRR↑ ${lv.afrrIn} / aFRR↓ ${lv.afrrOut} MW`
                : 'Geen live data'}
            </p>
          </div>
          {lv && <p className="text-gray-600 text-xs ml-auto">{lv.t} UTC · elke 30s · alert bij &gt;€{SPIKE_UP_DREMPEL} of &lt;€{SPIKE_DOWN_DREMPEL}/MWh</p>}
        </div>
      )}

      {/* ── Gisteren settlement ── */}
      {loading && <p className="text-gray-500 text-sm">Laden...</p>}
      {fout    && <p className="text-red-400 text-sm">{fout}</p>}

      {data && (
        <>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-3">
            Gisteren ({data.datum}) — settlement resultaat
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="border border-gray-700 rounded-lg p-3 text-center">
              <p className="text-red-400 text-xs mb-1">↑ UP periodes</p>
              <p className="text-white font-bold text-lg">{data.samenvatting.aantalUp}</p>
              <p className="text-gray-500 text-xs">max €{data.samenvatting.maxUpEurMwh}/MWh</p>
            </div>
            <div className="border border-gray-700 rounded-lg p-3 text-center">
              <p className="text-blue-400 text-xs mb-1">↓ DOWN periodes</p>
              <p className="text-white font-bold text-lg">{data.samenvatting.aantalDown}</p>
              <p className="text-gray-500 text-xs">max €{data.samenvatting.maxDownEurMwh}/MWh</p>
            </div>
            <div className="border border-gray-700 rounded-lg p-3 text-center">
              <p className="text-green-400 text-xs mb-1">Sim. spike winst</p>
              <p className="text-green-400 font-bold text-lg">€{data.samenvatting.simWinstUp.toFixed(2)}</p>
              <p className="text-gray-500 text-xs">{data.samenvatting.kwhPerPtu} kWh/PTU</p>
            </div>
            <div className="border border-gray-700 rounded-lg p-3 text-center">
              <p className="text-emerald-400 text-xs mb-1">Sim. totaal dag</p>
              <p className="text-emerald-400 font-bold text-lg">€{data.samenvatting.simTotaal.toFixed(2)}</p>
              <p className="text-gray-500 text-xs">UP + DOWN</p>
            </div>
          </div>

          <p className="text-gray-600 text-xs mb-2">Settlement prijzen per PTU (15 min) — rood=UP, blauw=DOWN</p>
          <ResponsiveContainer width="100%" height={70}>
            <BarChart data={data.grafiek} barCategoryGap={1} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Bar dataKey="shortageEurMwh" radius={0}>
                {data.grafiek.map((p, i) => (
                  <Cell key={i} fill={stateBarKleur(p.state)} />
                ))}
              </Bar>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload;
                  return (
                    <div className="bg-gray-900 text-xs text-gray-200 p-2 rounded border border-gray-700">
                      <p className="font-medium">{p.t}</p>
                      <p>{p.state === 1 ? '↑ UP' : p.state === -1 ? '↓ DOWN' : 'Neutraal'}</p>
                      <p>Shortage: €{p.shortageEurMwh}/MWh</p>
                      <p>Surplus:  €{p.surplusEurMwh}/MWh</p>
                    </div>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}

// ── ESS Grid Setpunt Bediening ─────────────────────────────────────────────
// Stuurt een grid-setpunt commando naar de DB.
// Node-RED op de Cerbo GX pollt /api/commando elke 30s en past het toe via MQTT:
//   Topic:   W/{portalId}/settings/0/Settings/CGwacs/AcPowerSetPoint
//   Payload: {"value": <watt>}
//
// Positief watt = importeren van net (batterij opladen)
// Negatief watt = exporteren naar net (batterij ontladen)
// 50            = ESS auto-modus (Victron standaard)

function EssSetpuntControle() {
  const [commando,     setCommando]    = useState(null);
  const [loading,      setLoading]     = useState(true);
  const [bezig,        setBezig]       = useState(false);
  const [toggleBezig,  setToggleBezig] = useState(false);
  const [controleAan,  setControleAan] = useState(false);
  const [bevestiging,  setBevestiging] = useState(null);
  const [fout,         setFout]        = useState(null);

  async function haalStatus() {
    setLoading(true);
    try {
      const [cmdRes, ctrlRes] = await Promise.all([
        fetch(`/api/stuur?secret=Nummer14!&t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/controle?secret=Nummer14!&t=${Date.now()}`, { cache: 'no-store' }),
      ]);
      const cmd  = await cmdRes.json();
      const ctrl = await ctrlRes.json();
      if (cmd.success)  setCommando(cmd.commando);
      if (ctrl.success) setControleAan(ctrl.controle_actief);
    } catch {}
    setLoading(false);
  }

  async function toggleControle() {
    setToggleBezig(true);
    setFout(null);
    try {
      const res  = await fetch(`/api/controle?secret=Nummer14!`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actief: !controleAan }),
      });
      const json = await res.json();
      if (json.success) setControleAan(json.controle_actief);
    } catch (e) { setFout(e.message); }
    setToggleBezig(false);
  }

  async function stuurHandmatig(watt, label, reden) {
    setBezig(true);
    setFout(null);
    try {
      const res  = await fetch(`/api/stuur?secret=Nummer14!`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ watt, reden, bron: 'handmatig' }),
      });
      const json = await res.json();
      if (json.success) {
        setCommando(json.commando);
        setBevestiging(label);
        setTimeout(() => setBevestiging(null), 4000);
      } else { setFout(json.error || 'Fout'); }
    } catch (e) { setFout(e.message); }
    setBezig(false);
  }

  useEffect(() => { haalStatus(); }, []);

  const huidigWatt = commando?.watt ?? null;
  const isLaden    = huidigWatt != null && huidigWatt >= 1000;
  const isOntladen = huidigWatt != null && huidigWatt <= -1000;
  const tijdLabel  = commando?.aangemaakt
    ? new Date(commando.aangemaakt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">

      {/* Header + toggle */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-200">🎛️ ESS Batterijbesturing</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Auto-besturing</span>
          <button
            onClick={toggleControle}
            disabled={toggleBezig}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              controleAan ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              controleAan ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
          <span className={`text-xs font-semibold ${controleAan ? 'text-green-400' : 'text-gray-500'}`}>
            {controleAan ? 'AAN' : 'UIT'}
          </span>
        </div>
      </div>

      {/* Status banner */}
      {controleAan ? (
        <div className="rounded-lg border border-green-700 bg-green-950 px-4 py-3 mb-4">
          <p className="text-green-300 text-sm font-semibold">✓ Algoritme stuurt batterij aan</p>
          <p className="text-green-700 text-xs mt-0.5">
            Elke aanroep van het algoritme schrijft automatisch het correcte setpunt.
            Node-RED past dit toe via MQTT op de Cerbo GX.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-700 bg-gray-750 px-4 py-3 mb-4">
          <p className="text-gray-400 text-sm font-semibold">Auto-besturing uitgeschakeld</p>
          <p className="text-gray-600 text-xs mt-0.5">
            Cerbo GX beheert de batterij zelf (ESS standaard). Gebruik de knoppen hieronder voor handmatige controle.
          </p>
        </div>
      )}

      {/* Huidig actief commando */}
      <div className="border border-gray-700 rounded-lg px-4 py-3 mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Huidig setpunt (DB)</p>
          <p className={`text-lg font-bold ${isLaden ? 'text-blue-400' : isOntladen ? 'text-orange-400' : 'text-green-400'}`}>
            {loading ? '…' : huidigWatt == null ? '—'
              : isLaden    ? `↓ LADEN  +${(huidigWatt/1000).toFixed(0)} kW`
              : isOntladen ? `↑ ONTLADEN  ${(huidigWatt/1000).toFixed(0)} kW`
              : controleAan ? `⏸ WACHTEN  (algoritme neutraal)` : `⚡ AUTO  (${huidigWatt} W)`}
          </p>
        </div>
        <div className="text-right text-xs text-gray-500">
          {tijdLabel && <p>{tijdLabel} · {commando?.bron ?? '—'}</p>}
          {commando?.reden && <p className="text-gray-600 italic truncate max-w-[200px]">{commando.reden}</p>}
          {commando?.uitgevoerd
            ? <p className="text-green-600">✓ ontvangen door Cerbo</p>
            : commando && <p className="text-yellow-600">⏳ wacht op Cerbo GX</p>}
        </div>
      </div>

      {/* Handmatige knoppen — altijd beschikbaar als override */}
      <p className="text-xs text-gray-500 mb-2">
        {controleAan ? 'Handmatige override (overschrijft algoritme tijdelijk):' : 'Handmatige besturing:'}
      </p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <button
          onClick={() => stuurHandmatig(ESS_LADEN_WATT, 'LADEN +9 kW', 'Handmatig: laden van net')}
          disabled={bezig}
          className="rounded-lg px-3 py-3 text-sm font-semibold border-2 bg-gray-700 border-gray-600 text-gray-300 hover:border-blue-500 hover:text-blue-300 transition-all disabled:opacity-50"
        >
          ↓ LADEN
          <span className="block text-xs font-normal mt-0.5 opacity-70">+9 kW van net</span>
        </button>
        <button
          onClick={() => stuurHandmatig(ESS_AUTO_WATT, 'AUTO', 'Handmatig: ESS auto')}
          disabled={bezig}
          className="rounded-lg px-3 py-3 text-sm font-semibold border-2 bg-gray-700 border-gray-600 text-gray-300 hover:border-green-500 hover:text-green-300 transition-all disabled:opacity-50"
        >
          ⚡ AUTO
          <span className="block text-xs font-normal mt-0.5 opacity-70">ESS beslist</span>
        </button>
        <button
          onClick={() => stuurHandmatig(ESS_ONTLADEN_WATT, 'ONTLADEN −9 kW', 'Handmatig: ontladen naar net')}
          disabled={bezig}
          className="rounded-lg px-3 py-3 text-sm font-semibold border-2 bg-gray-700 border-gray-600 text-gray-300 hover:border-orange-500 hover:text-orange-300 transition-all disabled:opacity-50"
        >
          ↑ ONTLADEN
          <span className="block text-xs font-normal mt-0.5 opacity-70">−9 kW naar net</span>
        </button>
      </div>

      {bevestiging && <p className="text-green-400 text-sm text-center">✓ {bevestiging} gestuurd — Node-RED past toe binnen ~30 s</p>}
      {fout        && <p className="text-red-400  text-sm text-center">{fout}</p>}

      <p className="text-gray-600 text-xs mt-3 text-center">
        Node-RED: <code className="text-gray-500">GET /api/commando</code> → <code className="text-gray-500">W/934962/vebus/276/Hub4/L1/AcPowerSetpoint</code>
      </p>
    </div>
  );
}
