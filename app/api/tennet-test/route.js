export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.TENNET_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'TENNET_API_KEY niet gevonden in environment' });
  }

  const nu       = new Date();
  const dagStart = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate(), 0, 0, 0));

  function fmt(d) {
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const mm = String(d.getUTCMonth()+1).padStart(2,'0');
    const yy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2,'0');
    const mi = String(d.getUTCMinutes()).padStart(2,'0');
    const ss = String(d.getUTCSeconds()).padStart(2,'0');
    return `${dd}-${mm}-${yy} ${hh}:${mi}:${ss}`;
  }

  const url = `https://api.tennet.eu/publications/v1/settlement-prices?date_from=${encodeURIComponent(fmt(dagStart))}&date_to=${encodeURIComponent(fmt(nu))}`;

  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey, Accept: 'application/json' },
    });

    const body = await res.text();

    return Response.json({
      status:     res.status,
      statusText: res.statusText,
      url,
      keyPrefix:  apiKey.slice(0, 8) + '...',
      body:       body.slice(0, 2000), // max 2000 chars
    });
  } catch (err) {
    return Response.json({ error: err.message, url });
  }
}
