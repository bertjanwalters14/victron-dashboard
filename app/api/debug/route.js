const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

function prijsAllin(spot) { return (spot + 0.03 + 0.13) * 1.21; }

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

    function berekenSom(veld) {
      return (records[veld] || []).reduce((s, [ts, kwh]) => s + kwh * prijsAllin(vindSpot(ts)), 0);
    }

    function totaalKwh(veld) {
      return (records[veld] || []).reduce((s, [, v]) => s + v, 0);
    }

    const BgKwh = totaalKwh('Bg');
    const BcKwh = totaalKwh('Bc');
    const GbKwh = totaalKwh('Gb');
    const accuKosten = (GbKwh + BgKwh + BcKwh) * 0.01;

    // 1. ZONDER batterij
    // Zon gaat direct naar net (Pg) of verbruikers (Pc)
    // Wat je van net koopt is Gc + Bc (zonder batterij koop je Bc van net)
    const zonderBatterij =
      berekenSom('Pg') +  // zon naar net
      berekenSom('Pc') +  // zon naar verbruikers (besparing)
      berekenSom('Pb') -  // zon die nu naar batterij gaat, zonder batterij naar net
      berekenSom('Gc') -  // wat je van net koopt
      berekenSom('Bc');   // zonder batterij koop je dit van net (extra kosten)

    // 2. MET batterij (huidige berekening)
    const metBatterij =
      berekenSom('Bg') +
      berekenSom('Bc') +
      berekenSom('Pc') -
      berekenSom('Gc') -
      berekenSom('Gb') -
      accuKosten;

    // 3. BATTERIJ BIJDRAGE
    const batterijBijdrage = metBatterij - zonderBatterij;

    return Response.json({
      datum,
      kwh: {
        Bg: BgKwh.toFixed(2),
        Bc: BcKwh.toFixed(2),
        Pc: totaalKwh('Pc').toFixed(2),
        Pg: totaalKwh('Pg').toFixed(2),
        Pb: totaalKwh('Pb').toFixed(2),
        Gc: totaalKwh('Gc').toFixed(2),
        Gb: GbKwh.toFixed(2),
      },
      resultaten: {
        zonder_batterij:    zonderBatterij.toFixed(2),
        met_batterij:       metBatterij.toFixed(2),
        batterij_bijdrage:  batterijBijdrage.toFixed(2),
      }
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}