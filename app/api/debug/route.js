const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function prijsInkoop(spot)  { return (spot + 0.03 + 0.13) * 1.21; } // volle all-in
function prijsKosten(spot)  { return (spot + 0.03) * 1.21; }         // zonder EB
function prijsSpot(spot)    { return spot * 1.21; }                   // alleen BTW

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const datum = searchParams.get('datum') || (() => {
    const g = new Date();
    g.setDate(g.getDate() - 1);
    return g.toISOString().split('T')[0];
  })();

  const start = Math.floor(new Date(datum + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datum + 'T23:59:59').getTime() / 1000);

  try {
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const records = (await victronRes.json())?.records || {};

    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datum}T00:00:00.000Z&tillDate=${datum}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijzen = (await prijsRes.json())?.Prices || [];

    const prijsPerUur = {};
    for (const p of prijzen) {
      const uur = new Date(p.readingDate).getTime();
      prijsPerUur[uur] = p.price;
    }

    function vindSpot(tsMs) {
      const d = new Date(tsMs);
      d.setMinutes(0, 0, 0);
      return prijsPerUur[d.getTime()] ?? 0.10;
    }

    function berekenSom(veld, prijsFn) {
      return (records[veld] || []).reduce((s, [ts, kwh]) => s + kwh * prijsFn(vindSpot(ts)), 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    // Baten altijd met volle all-in prijs
    const winstBg = berekenSom('Bg', prijsInkoop);
    const winstBc = berekenSom('Bc', prijsInkoop);
    const winstPc = berekenSom('Pc', prijsInkoop);

    // Kosten varianten
    const kostenGc_allin    = berekenSom('Gc', prijsInkoop);
    const kostenGc_zonderEB = berekenSom('Gc', prijsKosten);
    const kostenGc_spot     = berekenSom('Gc', prijsSpot);
    const kostenGb_allin    = berekenSom('Gb', prijsInkoop);
    const kostenGb_zonderEB = berekenSom('Gb', prijsKosten);

    const GbKwh      = totaalKwh('Gb');
    const BgKwh      = totaalKwh('Bg');
    const BcKwh      = totaalKwh('Bc');
    const accuKosten = (GbKwh + BgKwh + BcKwh) * 0.01;

    // Formule 1: alles all-in
    const f1 = winstBg + winstBc + winstPc - kostenGc_allin - kostenGb_allin - accuKosten;

    // Formule 4: baten all-in, kosten zonder EB
    const f4 = winstBg + winstBc + winstPc - kostenGc_zonderEB - kostenGb_zonderEB - accuKosten;

    // Formule 5: baten all-in, kosten alleen spot×BTW
    const f5 = winstBg + winstBc + winstPc - kostenGc_spot - berekenSom('Gb', prijsSpot) - accuKosten;

    // Echte batterij winst berekening
    const winstBg_bat  = berekenSom('Bg', prijsInkoop);  // duur verkopen
    const kostenPb_bat = berekenSom('Pb', prijsInkoop);  // zon die je anders direct had verkocht
    const winstBc_bat  = berekenSom('Bc', prijsInkoop);  // vermeden inkoop
    const kostenGb_bat = berekenSom('Gb', prijsInkoop);  // laadkosten
    const accuKosten2  = (totaalKwh('Gb') + totaalKwh('Bg') + totaalKwh('Bc')) * 0.01;

    const echteWinst = winstBg_bat - kostenPb_bat + winstBc_bat - kostenGb_bat - accuKosten2;

    return Response.json({
      datum,
      kwh: {
        Bg: BgKwh.toFixed(2), Bc: BcKwh.toFixed(2),
        Pc: totaalKwh('Pc').toFixed(2), Pg: totaalKwh('Pg').toFixed(2),
        Pb: totaalKwh('Pb').toFixed(2),
        Gc: totaalKwh('Gc').toFixed(2), Gb: GbKwh.toFixed(2),
      },
      huidig_dashboard: f1.toFixed(2),
      echte_batterij_winst: {
        winstBg:    winstBg_bat.toFixed(2),
        minPb:      `-${kostenPb_bat.toFixed(2)}`,
        winstBc:    winstBc_bat.toFixed(2),
        minGb:      `-${kostenGb_bat.toFixed(2)}`,
        minAccu:    `-${accuKosten2.toFixed(2)}`,
        totaal:     echteWinst.toFixed(2),
      },
      verwacht_victron: '?'
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}