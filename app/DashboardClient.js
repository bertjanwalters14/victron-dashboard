'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const BATTERIJ_KOSTEN   = 13500;
const INSTALLATIE_DATUM = new Date('2026-04-03');

export default function DashboardClient({ data }) {
  const totaalWinst   = data.reduce((s, d) => s + parseFloat(d.winst_euro || 0), 0);
  const dagenActief   = Math.max(1, Math.floor((new Date() - INSTALLATIE_DATUM) / 86400000));
  const gemDagwinst   = totaalWinst / dagenActief;
  const dagenTerugverdiend = gemDagwinst > 0 ? BATTERIJ_KOSTEN / gemDagwinst : null;
  const terugverdienDatum  = dagenTerugverdiend
    ? new Date(INSTALLATIE_DATUM.getTime() + dagenTerugverdiend * 86400000)
    : null;
  const roiPct = (totaalWinst / BATTERIJ_KOSTEN) * 100;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold">⚡ Victron Batterij ROI</h1>
          <p className="text-gray-400 mt-1">Installatie: 3 april 2026 · Investering: €13.500</p>
        </div>

        {/* KPI Cards - 2 kolommen op mobiel, 4 op desktop */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          <Card label="Totale winst"    value={`€${totaalWinst.toFixed(2)}`}  color="text-green-400" sub="sinds installatie" />
          <Card label="ROI"             value={`${roiPct.toFixed(2)}%`}        color="text-blue-400"  sub="van €13.500" />
          <Card label="Gem. dagwinst"   value={`€${gemDagwinst.toFixed(2)}`}   color="text-yellow-400" sub="per dag gemiddeld" />
          <Card
            label="Terugverdiend op"
            value={terugverdienDatum
              ? terugverdienDatum.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })
              : '—'}
            color="text-purple-400"
            sub={dagenTerugverdiend ? `over ${Math.round(dagenTerugverdiend)} dagen` : 'nog berekening nodig'}
          />
        </div>

        {/* Voortgangsbalk */}
        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-gray-300 font-medium">Terugverdien voortgang</span>
            <span className="text-white font-bold text-lg">{roiPct.toFixed(2)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-5">
            <div
              className="bg-gradient-to-r from-green-500 to-emerald-400 h-5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(roiPct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>€0</span>
            <span>€{(BATTERIJ_KOSTEN / 2).toLocaleString('nl-NL')}</span>
            <span>€{BATTERIJ_KOSTEN.toLocaleString('nl-NL')}</span>
          </div>
        </div>

        {/* Grafiek + Tabel - naast elkaar op desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

          {/* Grafiek */}
          <div className="bg-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-gray-200 mb-4">Cumulatieve winst</h2>
            {data.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cumulatief(data)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="datum" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={d => String(d).slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `€${v}`} />
                  <Tooltip
                    formatter={v => [`€${v.toFixed(2)}`, 'Winst']}
                    contentStyle={{ background: '#1F2937', border: 'none', borderRadius: '8px' }}
                    labelStyle={{ color: '#9CA3AF' }}
                  />
                  <Line type="monotone" dataKey="cumulatief" stroke="#10B981" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-500 text-sm">
                Nog geen data beschikbaar
              </div>
            )}
          </div>

          {/* Recente dagen */}
          <div className="bg-gray-800 rounded-xl p-5">
            <h2 className="font-semibold text-gray-200 mb-4">Recente dagen</h2>
            {data.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-gray-700">
                      <th className="text-left py-2">Datum</th>
                      <th className="text-right py-2">Zon (kWh)</th>
                      <th className="text-right py-2">Net export</th>
                      <th className="text-right py-2">Winst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data].reverse().slice(0, 8).map(d => (
                      <tr key={d.datum} className="border-b border-gray-700 hover:bg-gray-750">
                        <td className="py-2 text-gray-300">
                          {new Date(d.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                        </td>
                        <td className="py-2 text-right text-yellow-400">{parseFloat(d.solar_yield_kwh || 0).toFixed(1)}</td>
                        <td className="py-2 text-right text-blue-400">{parseFloat(d.net_export_kwh || 0).toFixed(2)}</td>
                        <td className="py-2 text-right text-green-400 font-medium">€{parseFloat(d.winst_euro || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                Nog geen data beschikbaar
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs">
          Data wordt elke dag om 06:00 automatisch bijgewerkt · Victron Site {process.env.NEXT_PUBLIC_VICTRON_SITE_ID || '934962'}
        </p>

      </div>
    </main>
  );
}

function Card({ label, value, color, sub }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 md:p-5">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl md:text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function cumulatief(data) {
  let som = 0;
  return data.map(d => ({
    datum: d.datum,
    cumulatief: +(som += parseFloat(d.winst_euro || 0)).toFixed(2)
  }));
}