export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const datum = searchParams.get('datum') || new Date().toISOString().split('T')[0];

  try {
    // EnergyZero prijzen
    const ezRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=${datum}T00:00:00.000Z&tillDate=${datum}T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const ezData = await ezRes.json();
    const ezPrijzen = (ezData?.Prices || []).map(p => ({
      uur: new Date(p.readingDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }),
      ez_spot:  p.price.toFixed(4),
      ez_allIn: ((p.price + 0.03 + 0.13) * 1.21).toFixed(4),
    }));

    // ENTSO-E prijzen (Nederland biedzone)
    const vandaag = new Date(datum + 'T00:00:00Z');
    const morgen  = new Date(vandaag.getTime() + 86400000);
    const entsoRes = await fetch(
      `https://web-api.tp.entsoe.eu/api?securityToken=&documentType=A44&in_Domain=10YNL----------L&out_Domain=10YNL----------L&periodStart=${vandaag.toISOString().slice(0,10).replace(/-/g,'')}0000&periodEnd=${morgen.toISOString().slice(0,10).replace(/-/g,'')}0000`
    );
    const entsoText = await entsoRes.text();

    return Response.json({
      datum,
      energyzero: ezPrijzen,
      entso_raw:  entsoText.slice(0, 500), // eerste 500 chars
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}