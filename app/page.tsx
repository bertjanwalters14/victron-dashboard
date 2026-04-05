import DashboardClient from './DashboardClient';
import { getEnergieData } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Page() {
  let data: any[] = [];
  try {
    data = await getEnergieData();
  } catch (e) {
    console.error('DB error:', e);
  }
  return <DashboardClient data={data} />;
}