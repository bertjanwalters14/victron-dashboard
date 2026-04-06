export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  try {
    const res = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/settings`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}