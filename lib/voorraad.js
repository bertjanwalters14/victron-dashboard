// Voorraadmutatie van de batterij-meerwaarde (nov 2026), gedeeld door /api/sync (dagwaarden) en /api/live
// ("Vandaag"), zodat die twee nooit uit elkaar lopen.
//
// De meerwaarde per dag telde alleen wat BINNEN die dag gekocht en gebruikt is. Wat er aan het eind van de
// dag nog in de accu zit (of juist uit de voorraad van gisteren kwam) telde niet mee, dus een dag met laden
// zag er slecht uit en de dag erna te goed (16-11: -4,71, 17-11: +5,57, samen +0,86). Nu telt de verandering
// van het SOC over de dag mee, gewaardeerd tegen een VASTE prijs per opgeslagen kWh (ongeveer de gemiddelde
// inkoopprijs 0,26 / laadrendement 0,955). Een vaste prijs is bewust: de mutaties van opeenvolgende dagen
// heffen elkaar dan exact op, over weken verandert het totaal nauwelijks (alleen het verschil tussen begin-
// en eindvoorraad), de verdeling per dag wordt eerlijker.

const SITE_ID = process.env.VICTRON_SITE_ID;
const TOKEN   = process.env.VICTRON_API_TOKEN;

export const BATT_KWH       = 32;
export const VOORRAAD_PRIJS = 0.27;   // EUR per opgeslagen kWh

// SOC aan het begin en eind van het venster (eerste en laatste kwartier uit VRM). null als VRM niets geeft.
export async function haalSocRand(start, end) {
  try {
    const res = await fetch(
      `https://vrmapi.victronenergy.com/v2/installations/${SITE_ID}/stats?type=custom&attributeCodes[]=SOC&interval=15mins&start=${start}&end=${end}`,
      { headers: { 'x-authorization': `Token ${TOKEN}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const reeks = (json?.records?.SOC || []).filter(([, v]) => typeof v === 'number');
    if (reeks.length < 2) return null;
    return { begin: reeks[0][1], eind: reeks[reeks.length - 1][1] };
  } catch {
    return null;
  }
}

// (SOC eind - SOC begin) x capaciteit x vaste prijs. Zonder SOC-data: 0 (zoals voor deze wijziging).
export function voorraadMutatie(socRand) {
  return socRand ? ((socRand.eind - socRand.begin) / 100) * BATT_KWH * VOORRAAD_PRIJS : 0;
}
