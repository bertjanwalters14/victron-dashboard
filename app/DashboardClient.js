'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const BATTERIJ_KOSTEN  = 13500;
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
    <main className="min-h-screen bg-gray-950 text-white p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">⚡ Victron Batterij ROI</h1>
      <p className="text-gray-400 text-sm mb-6">Installatie: 3 april 2026 · €13.500</p>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card label="Totale winst"    value={`€${totaalWinst.toFixed(2)}`}  color="text-green-400" />
        <Card label="ROI"             value={`${roiPct.toFixed(2)}%`}        color="text-blue-400" />
        <Card label="Gem. dagwinst"   value={`€${gemDagwinst.toFixed(2)}`}   color="text-yellow-400" />
        <Card
          label="Terugverdiend op"
          value={terugverdienDatum
            ? terugverdienDatum.toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' })
            : '—'}
          color="text-purple-400"
        />
      </div>

      {/* Voortgangsbalk */}
      <div className="bg-gray-800 rounded-xl p-4 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-400">Terugverdien voortgang</span>
          <span className="font-semibold">{roiPct.toFixed(2)}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-4">
          <div
            className="bg-gradient-to-r from-green-500 to-emerald-400 h-4 rounded-full transition-all"
            style={{ width: `${Math.min(roiPct, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>€0</span><span>€13.500</span>
        </div>
      </div>

      {/* Grafiek */}
      <div className="bg-gray-800 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Cumulatieve winst</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={cumulatief(data)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="datum" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `€${v}`} />
            <Tooltip formatter={v => `€${v.toFixed(2)}`} contentStyle={{ background: '#1F2937', border: 'none' }} />
            <Line type="monotone" dataKey="cumulatief" stroke="#10B981" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recente dagen */}
      <div className="bg-gray-800 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Recente dagen</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500 text-xs">
              <th className="text-left py-1">Datum</th>
              <th className="text-right py-1">Zon (kWh)</th>
              <th className="text-right py-1">Winst</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().slice(0, 10).map(d => (
              <tr key={d.datum} className="border-t border-gray-700">
                <td className="py-1 text-gray-300">
                  {new Date(d.datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
                </td>
                <td className="py-1 text-right text-yellow-400">{parseFloat(d.solar_yield_kwh).toFixed(1)}</td>
                <td className="py-1 text-right text-green-400">€{parseFloat(d.winst_euro).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Card({ label, value, color }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
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