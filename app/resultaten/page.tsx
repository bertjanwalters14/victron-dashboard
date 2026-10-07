import DashboardClient from '../DashboardClient';
import { getEnergieData } from '@/lib/db';

// Hervalideer elke 6 uur — data verandert toch maar één keer per nacht.
// Dit voorkomt dat elke pageload een live Neon-query doet (quota-vreter).
export const revalidate = 21600;

export default async function Page() {
  let data: any[] = [];
  try {
    data = await getEnergieData();
  } catch (e) {
    console.error('DB error:', e);
  }
  // SOC komt NIET uit deze server-component (die cachet 6 uur) maar wordt client-side vers
  // opgehaald in DashboardClient, zodat de rest van de pagina de cache-bescherming behoudt.
  return <DashboardClient data={data} />;
}