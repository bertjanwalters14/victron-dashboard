export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Prijzen 4 april ophalen
    const prijsRes = await fetch(
      `https://api.energyzero.nl/v1/energyprices?fromDate=2026-04-04T00:00:00.000Z&tillDate=2026-04-04T23:59:59.000Z&interval=4&usageType=1&inclBtw=false`
    );
    const prijsData = await prijsRes.json();
    const prijzen = prijsData?.Prices || [];

    // Toon alle uurprijzen met all-in berekening
    const overzicht = prijzen.map(p => ({
      uur: new Date(p.readingDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }),
      spot:    p.price.toFixed(4),
      allIn:   ((p.price + 0.03 + 0.13) * 1.21).toFixed(4),
    }));

    // Bereken gemiddelde van 16:00-19:00
    const relevantUren = overzicht.filter(p => 
      ['16:00', '17:00', '18:00'].includes(p.uur)
    );

    return Response.json({
      allePrijzen: overzicht,
      relevantUren,
      gemSpot1619: (relevantUren.reduce((s, p) => s + parseFloat(p.spot), 0) / relevantUren.length).toFixed(4),
      gemAllin1619: (relevantUren.reduce((s, p) => s + parseFloat(p.allIn), 0) / relevantUren.length).toFixed(4),
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}