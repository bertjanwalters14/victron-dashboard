const fs   = require('fs');
const path = require('path');

// Pas dit aan naar jouw CSV bestandslocatie
const CSV_PAD = path.join(__dirname, '..', 'P1e-2022-5-01-2026-4-07.csv');
const API_URL = 'https://victron-dashboard.vercel.app/api/p1?secret=Nummer14!';
const START_DATUM = new Date('2025-04-03');

function parseCSV(inhoud) {
  const regels = inhoud.trim().split('\n');
  const headers = regels[0].split(',').map(h => h.trim().replace(/"/g,''));
  return regels.slice(1).map(regel => {
    const waarden = regel.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = waarden[i]?.trim().replace(/"/g,''));
    return obj;
  });
}

async function importeer() {
  console.log('CSV inlezen...');
  const inhoud = fs.readFileSync(CSV_PAD, 'utf8');
  const rijen  = parseCSV(inhoud);
  console.log(`${rijen.length} rijen gevonden`);

  // Sorteer op datum
  rijen.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  // Bereken delta per dag (cumulatief → per dag)
  const byDag = {};
  for (let i = 1; i < rijen.length; i++) {
    const prev = rijen[i-1], curr = rijen[i];
    const datum = String(curr.time).slice(0,10);
    if (new Date(datum) < START_DATUM) continue;

    const imp = Math.max(0,
      ((parseFloat(curr['Import T1 kWh'])||0) + (parseFloat(curr['Import T2 kWh'])||0)) -
      ((parseFloat(prev['Import T1 kWh'])||0) + (parseFloat(prev['Import T2 kWh'])||0))
    ) / 1000;

    const exp = Math.max(0,
      ((parseFloat(curr['Export T1 kWh'])||0) + (parseFloat(curr['Export T2 kWh'])||0)) -
      ((parseFloat(prev['Export T1 kWh'])||0) + (parseFloat(prev['Export T2 kWh'])||0))
    ) / 1000;

    byDag[datum] = {
      datum,
      import_kwh: +imp.toFixed(3),
      export_kwh: +exp.toFixed(3),
    };
  }

  const data = Object.values(byDag);
  console.log(`${data.length} dagen vanaf april 2025`);
  console.log('Eerste dag:', data[0]);
  console.log('Laatste dag:', data[data.length-1]);

  // Verstuur naar API
  console.log('Uploaden naar database...');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: data }),
  });

  const result = await res.json();
  console.log('Resultaat:', result);
}

importeer().catch(console.error);