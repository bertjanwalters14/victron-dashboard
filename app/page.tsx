import DashboardClient from './DashboardClient';
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
  return <DashboardClient data={data} />;
}