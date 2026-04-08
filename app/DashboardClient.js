'use client';
import { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea } from 'recharts';

const BATTERIJ_KOSTEN   = 11252;
const INSTALLATIE_DATUM = new Date('2026-04-03');
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
            <p className="text-gray-400 mt-1">Installatie: 3 april 2026 · Investering: €{BATTERIJ_KOSTEN.toLocaleString('nl-NL')} <span className="text-green-600 text-xs">(incl. BTW teruggave)</span></p>
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
          <div className="grid grid-cols-3 gap-4">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="bg-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-gray-200 mb-4">Cumulatieve winst</h2>
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cumulatief(data)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="datum" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={d => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `€${v}`} />
                  <Tooltip formatter={v => [`€${v.toFixed(2)}`, 'Winst']} contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }} labelStyle={{ color: '#9CA3AF' }} />
                  <Line type="monotone" dataKey="cumulatief" stroke="#10B981" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
            )}
          </div>

          <div className="bg-gray-800 rounded-xl p-5">
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
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">Nog geen data beschikbaar</div>
            )}
          </div>
        </div>

        <OnbalansTegel />
        <BatterijRealisatie />
        <P1Vergelijking />

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
        <div className="grid grid-cols-2 gap-3">
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

  const vandaagData = (zon.grafiekData || []).filter(d => d.dag === 'vandaag');
  const morgenData  = (zon.grafiekData || []).filter(d => d.dag === 'morgen');

  const chartProps = {
    barCategoryGap: '15%',
    margin: { top: 4, right: 4, left: 0, bottom: 0 },
  };
  const axisProps = {
    xAxis: { tick: { fontSize: 9, fill: '#6B7280' }, interval: 1 },
    yAxis: { tick: { fontSize: 9, fill: '#6B7280' }, tickFormatter: v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v, width: 28 },
  };
  const tooltipStyle = {
    contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 11 },
    labelStyle:   { color: '#9CA3AF' },
    formatter:    v => [v >= 1000 ? `${(v/1000).toFixed(2)} kW` : `${v} W`],
  };

  return (
    <div className="border-t border-gray-700 pt-4 space-y-3">
      {/* Header + totalen */}
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-200">☀️ Zonneprognose</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-gray-500">Vandaag totaal&nbsp;<span className="text-amber-400 font-semibold">{zon.vandaagKwh} kWh</span></span>
          <span className="text-gray-500">Gemeten&nbsp;<span className="text-green-400 font-semibold">{zon.vandaagGemeten != null ? `${zon.vandaagGemeten} kWh` : '—'}</span></span>
          <span className="text-gray-500">Morgen&nbsp;<span className="text-orange-400 font-semibold">{zon.morgenKwh} kWh</span></span>
        </div>
      </div>

      {/* Twee aparte grafieken naast elkaar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Vandaag */}
        <div className="bg-gray-750 rounded-lg p-2 border border-gray-700">
          <p className="text-xs text-amber-400 font-medium mb-1 px-1">Vandaag</p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={vandaagData} {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="tijd" {...axisProps.xAxis} />
              <YAxis {...axisProps.yAxis} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="watt" fill="#F59E0B" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Morgen */}
        <div className="bg-gray-750 rounded-lg p-2 border border-gray-700">
          <p className="text-xs text-orange-400 font-medium mb-1 px-1">Morgen</p>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={morgenData} {...chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis dataKey="tijd" {...axisProps.xAxis} />
              <YAxis {...axisProps.yAxis} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="watt" fill="#FB923C" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-xs text-gray-600">📍 Harkstede · 18 × 370Wp · Zuid 180° · 35° helling · Forecast.Solar</p>
    </div>
  );
}

function BatterijRealisatie() {
  const [dagen, setDagen] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res  = await fetch(`/api/dagresultaat?secret=Nummer14!&t=${Date.now()}`, { cache: 'no-store' });
        const json = await res.json();
        if (json.success) setDagen(json.dagen);
      } catch(e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return null;
  if (!dagen.length) return null;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h2 className="font-semibold text-gray-200 mb-1">Batterij realisatie</h2>
      <p className="text-xs text-gray-500 mb-4">Gemeten kWh per dag op basis van live vermogensmeting</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 text-xs border-b border-gray-700">
              <th className="text-left py-2 pr-4">Dag</th>
              <th className="text-right py-2 px-3">Geladen</th>
              <th className="text-right py-2 px-3">Ontladen</th>
              <th className="text-right py-2 px-3">Zon</th>
              <th className="text-right py-2 px-3">Van net</th>
              <th className="text-right py-2 px-3">Teruggeleverd</th>
              <th className="text-right py-2 px-3">Beslissingen</th>
              <th className="text-right py-2 pl-3">Netto</th>
            </tr>
          </thead>
          <tbody>
            {dagen.map(d => {
              const b = d.beslissingen || {};
              const ladenAantal    = b.laden?.aantal    ?? 0;
              const ontladenAantal = b.ontladen?.aantal ?? 0;
              const wachtenAantal  = b.wachten?.aantal  ?? 0;
              return (
                <tr key={d.dag} className="border-b border-gray-700/50 hover:bg-gray-750">
                  <td className="py-2 pr-4 text-gray-300 font-medium">{d.dag.slice(5)}</td>
                  <td className="py-2 px-3 text-right text-green-400">{d.kwh_geladen > 0 ? `${d.kwh_geladen} kWh` : '—'}</td>
                  <td className="py-2 px-3 text-right text-red-400">{d.kwh_ontladen > 0 ? `${d.kwh_ontladen} kWh` : '—'}</td>
                  <td className="py-2 px-3 text-right text-yellow-400">{d.kwh_zon > 0 ? `${d.kwh_zon} kWh` : '—'}</td>
                  <td className="py-2 px-3 text-right text-blue-400">{d.kwh_van_net > 0 ? `${d.kwh_van_net} kWh` : '—'}</td>
                  <td className="py-2 px-3 text-right text-purple-400">{d.kwh_teruggeleverd > 0 ? `${d.kwh_teruggeleverd} kWh` : '—'}</td>
                  <td className="py-2 px-3 text-right text-gray-400 text-xs">
                    <span className="text-green-500">{ladenAantal}L</span>
                    {' · '}
                    <span className="text-red-500">{ontladenAantal}O</span>
                    {' · '}
                    <span className="text-orange-400">{wachtenAantal}W</span>
                  </td>
                  <td className="py-2 pl-3 text-right font-semibold">
                    {d.netto_resultaat != null
                      ? <span className={d.netto_resultaat >= 0 ? 'text-green-400' : 'text-red-400'}>€{d.netto_resultaat.toFixed(2)}</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-600 mt-3">L = laden · O = ontladen · W = wachten · Netto = waarde ontladen − kosten laden van net</p>
    </div>
  );
}

function P1Vergelijking() {
  const [maanden, setMaanden] = useState([]);
  const [open, setOpen]       = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // P1 data (2025) en Victron data (2026) parallel ophalen
        const [p1Res, vrmRes] = await Promise.all([
          fetch('/api/p1?secret=Nummer14!'),
          fetch('/api/energie?secret=Nummer14!'),
        ]);
        const p1Json  = await p1Res.json();
        const vrmJson = await vrmRes.json();

        const byMaand = {};

        // 2025 data uit P1
        if (p1Json.success) {
          p1Json.data.forEach(r => {
            const datum   = String(r.datum).slice(0,10);
            const maandNr = parseInt(datum.slice(5,7));
            const dag     = parseInt(datum.slice(8,10));
            if (!byMaand[maandNr]) byMaand[maandNr] = {};
            if (!byMaand[maandNr]["2025"]) byMaand[maandNr]["2025"] = {};
            byMaand[maandNr]["2025"][dag] = { imp: parseFloat(r.import_kwh) };
          });
        }

        // 2026 data uit Victron (energie_data)
        if (vrmJson.success && Array.isArray(vrmJson.data)) {
          vrmJson.data.forEach(r => {
            const datum   = String(r.datum).slice(0,10);
            const maandNr = parseInt(datum.slice(5,7));
            const dag     = parseInt(datum.slice(8,10));
            if (!byMaand[maandNr]) byMaand[maandNr] = {};
            if (!byMaand[maandNr]["2026"]) byMaand[maandNr]["2026"] = {};
            byMaand[maandNr]["2026"][dag] = { imp: parseFloat(r.net_import_kwh || 0) };
          });
        }

        const result = Object.entries(byMaand).sort(([a],[b]) => parseInt(a)-parseInt(b))
          .filter(([, jaren]) => jaren["2025"] && jaren["2026"])
          .map(([nr, jaren]) => {
            const n   = parseInt(nr);
            const j25 = jaren["2025"] || {}, j26 = jaren["2026"] || {};
            const dagen = Array.from(new Set([...Object.keys(j25),...Object.keys(j26)].map(Number))).sort((a,b)=>a-b);
            return {
              nr: n, label: MAAND_NAMEN[n-1], dagen, j25, j26,
              tot25imp: Object.values(j25).reduce((s,v)=>s+v.imp,0),
              tot26imp: Object.values(j26).reduce((s,v)=>s+v.imp,0),
            };
          });
        setMaanden(result);
      } catch(e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="bg-gray-800 rounded-xl p-5 mb-6 text-gray-500 text-sm">P1 data laden...</div>;

  return (
    <div className="bg-gray-800 rounded-xl p-5 mb-6">
      <h2 className="font-semibold text-gray-200 mb-1">⚡ Netverbruik vergelijking</h2>
      <p className="text-xs text-gray-500 mb-4">2025 (zonder batterij) vs 2026 (met batterij) · vanaf 3 april</p>
      <div className="flex gap-4 text-xs text-gray-400 mb-3">
        <span>🔴 Import 2025 → <span className="text-green-400">Import 2026</span> · minder is beter</span>
      </div>
      {maanden.map(m => (
        <div key={m.nr} className="mb-2 border border-gray-700 rounded-lg overflow-hidden">
          <div
            onClick={() => setOpen(o => ({...o, [m.nr]: !o[m.nr]}))}
            className="flex justify-between items-center px-4 py-3 bg-gray-700 cursor-pointer hover:bg-gray-600 select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{open[m.nr] ? "▼" : "▶"}</span>
              <span className="text-sm font-medium text-gray-200 capitalize">{m.label}</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <span className="text-gray-400">
                Import: <span className="text-red-400">{m.tot25imp.toFixed(1)}</span> → <span className="text-green-400">{m.tot26imp.toFixed(1)}</span> kWh
              </span>
              {m.tot26imp > 0 && m.tot25imp > 0 && (
                <span className={`font-bold text-base ${m.tot26imp < m.tot25imp ? 'text-green-400' : 'text-red-400'}`}>
                  {m.tot26imp < m.tot25imp ? "▼" : "▲"} {Math.abs(m.tot26imp - m.tot25imp).toFixed(1)} kWh
                </span>
              )}
            </div>
          </div>
          {open[m.nr] && (
            <div className="px-4 pb-3 overflow-x-auto">
              <table className="w-full text-xs mt-2">
                                  <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 text-gray-500 font-normal">Dag</th>
                    <th className="text-right py-2 text-red-400 font-normal">Import 2025</th>
                    <th className="text-right py-2 text-green-400 font-normal">Import 2026</th>
                    <th className="text-right py-2 text-gray-400 font-normal">Verschil</th>
                  </tr>
                </thead>
                <tbody>
                  {m.dagen.map(dag => {
                    const d25 = m.j25[dag], d26 = m.j26[dag];
                    const verschil = d25 && d26 ? (d26.imp - d25.imp).toFixed(2) : null;
                    return (
                      <tr key={dag} className="border-b border-gray-700">
                        <td className="py-1 text-gray-400">{dag}</td>
                        <td className="py-1 text-right text-red-400">{d25 ? d25.imp.toFixed(2) : "—"}</td>
                        <td className="py-1 text-right text-green-400">{d26 ? d26.imp.toFixed(2) : "—"}</td>
                        <td className={`py-1 text-right font-medium ${verschil < 0 ? 'text-green-400' : verschil > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {verschil !== null ? (verschil > 0 ? "+" : "") + verschil : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
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

function cumulatief(data) {
  let som = 0;
  return data.map(d => ({ datum: d.datum, cumulatief: +(som += parseFloat(d.winst_euro || 0)).toFixed(2) }));
}