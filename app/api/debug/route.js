export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SITE_ID = process.env.VICTRON_SITE_ID;
  const TOKEN   = process.env.VICTRON_API_TOKEN;

  try {
    // Probeer verschillende endpoints voor prijsinstellingen
    const [siteRes, dessRes] = await Promise.all([
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}`, 
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
      fetch(`https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/dynamic-ess-settings`,
        { headers: { 'x-authorization': `Token ${TOKEN}` } }),
    ]);

    const siteData = await siteRes.json();
    const dessData = await dessRes.json();

    return Response.json({
      site: siteData,
      dess: dessData,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}