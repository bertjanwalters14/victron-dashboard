export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  const gisteren = new Date();
  gisteren.setDate(gisteren.getDate() - 1);
  const datumStr = gisteren.toISOString().split('T')[0];
  const start = Math.floor(new Date(datumStr + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datumStr + 'T23:59:59').getTime() / 1000);

  try {
    // Probeer DESS prices endpoint
    const [r1, r2, r3] = await Promise.all([
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/dynamic-ess-prices?start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/price-data?start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
    ]);

    return Response.json({
      dessprijzen: await r1.json(),
      pricedata:   await r2.json(),
      uurstats:    await r3.json(),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}