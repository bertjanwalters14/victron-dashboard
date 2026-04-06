export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  const datum = searchParams.get('datum') || '2026-04-05';
  const start = Math.floor(new Date(datum + 'T00:00:00').getTime() / 1000);
  const end   = Math.floor(new Date(datum + 'T23:59:59').getTime() / 1000);

  try {
    const [dagRes, uurRes] = await Promise.all([
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=days&start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=kwh&interval=hours&start=${start}&end=${end}`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
    ]);

    const dagData = await dagRes.json();
    const uurData = await uurRes.json();

    return Response.json({
      dag_totals: dagData?.totals,
      uur_totals: uurData?.totals,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}