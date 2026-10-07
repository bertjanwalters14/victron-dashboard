'use client';
import { useState } from 'react';
import TabBar from './TabBar';

const VOORSCHOT_PER_MAAND = 15;

// Maanden van vóór de Victron-installatie (4 april 2026) -- geen VRM-data, dus overgenomen uit
// de ANWB-app zelf (screenshot van de gebruiker). "Werkelijk" daar is de netto energiekosten die
// maand (positief = kosten, negatief = credit) -- exact hetzelfde begrip als netto_kosten hieronder;
// bevestigd doordat de overlappende maanden (april-september) op een paar euro na overeenkomen met
// de VRM-berekening. Volledige kalendermaanden, dus het volle voorschot, geen pro-rata nodig.
const HANDMATIGE_MAANDEN = [
  // Contractjaar 9 nov 2024 -- 9 nov 2025. Maandcijfers uit de ANWB-app; die tellen NIET precies op
  // tot het bedrag van de echte jaarafrekening (factuur 300007999, zie WERKELIJKE_EINDSTAND) -- een
  // verschil van ~€196,53 dat niet aan één specifieke maand toe te wijzen is (bevestigd: gebruiker
  // haalde alle 12 maanden uit dezelfde app-weergave). Daarom is de eindstand van déze cyclus
  // hieronder overschreven met het echte factuurbedrag; de maandrijen tonen alleen het patroon.
  { jaar: 2024, maandIdx: 10, nettoKosten: 119.30 }, // november
  { jaar: 2024, maandIdx: 11, nettoKosten: 180.88 }, // december
  { jaar: 2025, maandIdx: 0, nettoKosten: 225 },  // januari
  { jaar: 2025, maandIdx: 1, nettoKosten: 145 },  // februari
  { jaar: 2025, maandIdx: 2, nettoKosten: -71 },  // maart
  { jaar: 2025, maandIdx: 3, nettoKosten: -89 },  // april
  { jaar: 2025, maandIdx: 4, nettoKosten: -116 }, // mei
  { jaar: 2025, maandIdx: 5, nettoKosten: -94 },  // juni
  { jaar: 2025, maandIdx: 6, nettoKosten: -105 }, // juli
  { jaar: 2025, maandIdx: 7, nettoKosten: -126 }, // augustus
  { jaar: 2025, maandIdx: 8, nettoKosten: -81 },  // september
  { jaar: 2025, maandIdx: 9, nettoKosten: 4 },    // oktober
  // Contractjaar 9 nov 2025 -- 9 nov 2026 (lopend).
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

// Contractjaar loopt niet met het kalenderjaar mee maar met de ingangsdatum: 9 november.
// Elke 9e november begint een nieuwe cyclus (net als ANWB's eigen jaarafrekening).
const ANKER_JAAR = 2025, ANKER_MAAND = 10; // november = index 10

// Officiële, definitieve eindstand per afgesloten cyclus-index (uit de echte jaarafrekening-factuur),
// waar bekend. Deze heeft voorrang op de opgetelde maandcijfers -- die zijn immers een app-weergave
// die niet gegarandeerd precies aansluit (zie toelichting bij HANDMATIGE_MAANDEN).
const WERKELIJKE_EINDSTAND = {
  '-1': 8.71, // 9 nov 2024 -- 9 nov 2025, factuur 300007999: €8,71 te betalen
};

function daysInMonth(jaar, maandIdx) {
  return new Date(jaar, maandIdx + 1, 0).getDate();
}

// Vaste namenlijst i.p.v. toLocaleDateString('nl-NL', ...): die laatste kan op de Vercel-server
// (mogelijk beperkte ICU-locale-data) iets anders uitvoeren dan in de browser, wat een React
// hydration-mismatch gaf (error #418) en daarmee de uitklap-knoppen liet doodvallen.
const MAAND_NAMEN = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

function maandNaam(jaar, maandIdx) {
  return `${MAAND_NAMEN[maandIdx]} ${jaar}`;
}

function contractCyclus(jaar, maandIdx) {
  const maandenSindsAnker = (jaar - ANKER_JAAR) * 12 + (maandIdx - ANKER_MAAND);
  return Math.floor(maandenSindsAnker / 12);
}

function cyclusLabel(cyclusIdx) {
  const startJaar = ANKER_JAAR + cyclusIdx;
  const eindJaar = startJaar + 1;
  return `9 nov ${startJaar} – 8 nov ${eindJaar}`;
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

// Groepeert de maanden per contractjaar-cyclus en houdt het cumulatieve saldo per cyclus
// bij (begint dus opnieuw bij 0 zodra een nieuwe cyclus start op 9 november).
function berekenCycli(maanden) {
  const perCyclus = new Map();
  for (const m of maanden) {
    const idx = contractCyclus(m.jaar, m.maandIdx);
    if (!perCyclus.has(idx)) perCyclus.set(idx, { idx, label: cyclusLabel(idx), maanden: [] });
    perCyclus.get(idx).maanden.push(m);
  }
  return [...perCyclus.values()]
    .sort((a, b) => b.idx - a.idx) // meest recente cyclus eerst
    .map(c => {
      let cumulatief = 0;
      const maandenMetSaldo = c.maanden.map(m => {
        const saldo = m.nettoKosten - m.voorschot; // negatief = je krijgt terug, positief = je betaalt bij
        cumulatief += saldo;
        return { ...m, saldo, cumulatief };
      });
      const officieel = WERKELIJKE_EINDSTAND[String(c.idx)];
      return {
        ...c,
        maanden: maandenMetSaldo,
        totaal: officieel ?? cumulatief,
        berekendTotaal: cumulatief,
        isOfficieel: officieel != null,
      };
    });
}

function CyclusSectie({ cyclus, isHuidig }) {
  const [open, setOpen] = useState(isHuidig); // lopend jaar staat open, afgesloten jaren dicht

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left bg-gray-800 rounded-xl p-5 hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-xs mb-1 flex items-center gap-2">
              <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
              Contractjaar {cyclus.label}{isHuidig && <span className="text-gray-500"> (lopend)</span>}
            </p>
            <p className={`text-3xl md:text-4xl font-bold ${cyclus.totaal <= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {cyclus.totaal > 0 ? '+' : ''}€{cyclus.totaal.toFixed(2)}
            </p>
            {cyclus.isOfficieel && <p className="text-gray-500 text-xs mt-0.5">Officiële jaarafrekening van ANWB</p>}
          </div>
        </div>
        {isHuidig && (
          <p className="text-gray-500 text-xs mt-2">
            Werkelijke kosten min betaald voorschot — negatief (groen) is wat je terugkrijgt,
            positief (rood) is wat je bijbetaalt. Eigen, consistente boekhouding, geen voorspelling
            van ANWB's exacte eindafrekening: die kan extra correcties bevatten (bv.
            energiebelasting-vermindering) die hier niet in zitten.
          </p>
        )}
        {cyclus.isOfficieel && Math.abs(cyclus.berekendTotaal - cyclus.totaal) > 0.5 && (
          <p className="text-gray-500 text-xs mt-2">
            De losse maandcijfers hieronder (uit de ANWB-app) tellen zelf op tot €{cyclus.berekendTotaal.toFixed(2)}
            {' '}— een verschil van €{Math.abs(cyclus.berekendTotaal - cyclus.totaal).toFixed(2)} met de officiële
            afrekening dat niet aan één maand toe te wijzen is. Het bedrag hierboven is het echte, betaalde bedrag;
            de tabel toont alleen het maandpatroon.
          </p>
        )}
      </button>

      {open && (
        <div className="bg-gray-800 rounded-xl overflow-hidden mt-3">
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
              {cyclus.maanden.map(r => (
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function JaaroverzichtClient({ data }) {
  const maanden = berekenMaanden(data);
  const cycli = berekenCycli(maanden);

  return (
    <main className="min-h-screen bg-gray-950 text-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8">
        <TabBar />
        <h1 className="text-2xl md:text-3xl font-bold mb-6">Jaaroverzicht</h1>

        {cycli.length === 0 && (
          <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-500">Nog geen data beschikbaar</div>
        )}
        {cycli.map((c, i) => <CyclusSectie key={c.idx} cyclus={c} isHuidig={i === 0} />)}

        <p className="text-center text-gray-600 text-xs mt-2">
          Werkelijke kosten = echt verbruik/teruglevering × echte EnergyZero-uurprijzen, all-in.
          Voorschot = €{VOORSCHOT_PER_MAAND}/maand, evenredig verdeeld over de dagen met data.
          Contractjaar loopt van 9 november t/m 8 november, gelijk aan de ANWB-jaarafrekening.
        </p>
      </div>
    </main>
  );
}
