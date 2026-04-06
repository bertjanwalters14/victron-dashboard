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
    const res = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/dynamic-ess-kpis?start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}