export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  // Gisteren
  const gisteren = new Date();
  gisteren.setDate(gisteren.getDate() - 1);
  const datumStr = gisteren.toISOString().split('T')[0];
  const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

  try {
    // Kwartierdata ophalen van Victron
    const victronRes = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=15mins&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const data = await victronRes.json();

    // Energieprijzen per kwartier ophalen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datumStr}T00:00:00.000Z&tillDate=${datumStr}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();

    return Response.json({
      victron_records: Object.keys(data?.records || {}),
      victron_sample: {
        Bg: data?.records?.Bg?.slice(0, 3),
        Bc: data?.records?.Bc?.slice(0, 3),
        Gc: data?.records?.Gc?.slice(0, 3),
        Gb: data?.records?.Gb?.slice(0, 3),
        Pc: data?.records?.Pc?.slice(0, 3),
      },
      prijzen_sample: prijsData?.Prices?.slice(0, 3),
      totaal_kwartieren_victron: data?.records?.Bg?.length,
      totaal_kwartieren_prijzen: prijsData?.Prices?.length,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}