'use client';

const VOORSCHOT_PER_MAAND = 15;

// Maanden van vóór de Victron-installatie (4 april 2026) -- geen VRM-data, dus overgenomen uit
// de ANWB-app zelf (screenshot van de gebruiker). "Werkelijk" daar is de netto energiekosten die
// maand (positief = kosten, negatief = credit) -- exact hetzelfde begrip als netto_kosten hieronder;
// bevestigd doordat de overlappende maanden (april-september) op een paar euro na overeenkomen met
// de VRM-berekening. Volledige kalendermaanden, dus het volle voorschot, geen pro-rata nodig.
const HANDMATIGE_MAANDEN = [
  { jaar: 2025, maandIdx: 10, nettoKosten: 76.65 },   // november
  { jaar: 2025, maandIdx: 11, nettoKosten: 144.77 },  // december
  { jaar: 2026, maandIdx: 0,  nettoKosten: 239.51 },  // januari
  { jaar: 2026, maandIdx: 1,  nettoKosten: 146.83 },  // februari
  { jaar: 2026, maandIdx: 2,  nettoKosten: -7.24 },   // maart
].map(m => ({
  ...m,
  key: `${m.jaar}-${String(m.maandIdx + 1).padStart(2, '0')}`,
  voorschot: VOORSCHOT_PER_MAAND,
  dagen: null,
  bron: 'anwb',
}));

function daysInMonth(jaar, maandIdx) {
  return new Date(jaar, maandIdx + 1, 0).getDate();
}

function maandNaam(jaar, maandIdx) {
  return new Date(jaar, maandIdx, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
}

// Groepeert de dagrijen per kalendermaand en rekent per dag een evenredig deel van het
// vaste voorschot toe -- zo klopt ook de eerste (installatie-)maand en de lopende maand,
// zonder aparte pro-rata-uitzonderingen nodig te hebben.
function berekenMaanden(data) {
  const perMaand = new Map();
  for (const r of data) {
    if (r.netto_kosten == null) continue; // dagen van vóór deze tracking bestond
    const d = new Date(r.datum + 'T12:00:00');
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!perMaand.has(key)) {
      perMaand.set(key, {
        key, jaar: d.getFullYear(), maandIdx: d.getMonth(),
        nettoKosten: 0, voorschot: 0, dagen: 0,
      });
    }
    const m = perMaand.get(key);
    m.nettoKosten += parseFloat(r.netto_kosten);
    m.voorschot += VOORSCHOT_PER_MAAND / daysInMonth(d.getFullYear(), d.getMonth());
    m.dagen += 1;
    m.bron = 'vrm';
  }
  return [...perMaand.values(), ...HANDMATIGE_MAANDEN].sort((a, b) => a.key.localeCompare(b.key));
}

export default function JaaroverzichtClient({ data }) {
  const maanden = berekenMaanden(data);
  let cumulatief = 0;
  const rijen = maanden.map(m => {
    const saldo = m.nettoKosten - m.voorschot; // negatief = je krijgt terug, positief = je betaalt bij
    cumulatief += saldo;
    return { ...m, saldo, cumulatief };
  });
  const totaalSaldo = rijen.length ? rijen[rijen.length - 1].cumulatief : 0;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">
        <div className="flex items-center gap-3 mb-6">
          <a href="/" className="text-gray-400 hover:text-white text-xl">←</a>
          <h1 className="text-2xl md:text-3xl font-bold">Jaaroverzicht</h1>
        </div>

        <div className="bg-gray-800 rounded-xl p-5 mb-6">
          <p className="text-gray-400 text-xs mb-1">Opgebouwd saldo t.o.v. voorschot</p>
          <p className={`text-3xl md:text-4xl font-bold ${totaalSaldo <= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totaalSaldo > 0 ? '+' : ''}€{totaalSaldo.toFixed(2)}
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Werkelijke kosten min betaald voorschot, cumulatief sinds nov 2025 — negatief (groen) is
            wat je terugkrijgt, positief (rood) is wat je bijbetaalt. Eigen, consistente boekhouding,
            geen voorspelling van ANWB's exacte eindafrekening: die kan extra correcties bevatten
            (bv. energiebelasting-vermindering) die hier niet in zitten.
          </p>
        </div>

        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-gray-400 text-[11px] sm:text-xs border-b border-gray-700">
                <th className="text-left font-normal p-2 sm:p-3">Maand</th>
                <th className="text-right font-normal p-2 sm:p-3">Kosten</th>
                <th className="text-right font-normal p-2 sm:p-3 hidden sm:table-cell">Voorschot</th>
                <th className="text-right font-normal p-2 sm:p-3">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map(r => (
                <tr key={r.key} className="border-b border-gray-700/50 last:border-0">
                  <td className="p-2 sm:p-3 capitalize">
                    {maandNaam(r.jaar, r.maandIdx)}
                    {r.bron === 'anwb' && <span className="text-gray-600 text-[10px] sm:text-xs ml-1 sm:ml-2 whitespace-nowrap" title="Overgenomen uit de ANWB-app, geen VRM-data beschikbaar">(ANWB)</span>}
                  </td>
                  <td className="p-2 sm:p-3 text-right text-gray-300 whitespace-nowrap">€{r.nettoKosten.toFixed(2)}</td>
                  <td className="p-2 sm:p-3 text-right text-gray-300 whitespace-nowrap hidden sm:table-cell">€{r.voorschot.toFixed(2)}</td>
                  <td className={`p-2 sm:p-3 text-right font-medium whitespace-nowrap ${r.saldo <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {r.saldo > 0 ? '+' : ''}€{r.saldo.toFixed(2)}
                  </td>
                </tr>
              ))}
              {rijen.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-gray-500">Nog geen data beschikbaar</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Werkelijke kosten = echt verbruik/teruglevering × echte EnergyZero-uurprijzen, all-in.
          Voorschot = €{VOORSCHOT_PER_MAAND}/maand, evenredig verdeeld over de dagen met data.
        </p>
      </div>
    </main>
  );
}
