import JaaroverzichtClient from '../JaaroverzichtClient';
import { getEnergieData } from '@/lib/db';

export const revalidate = 21600;

export default async function JaaroverzichtPage() {
  let data: any[] = [];
  try {
    data = await getEnergieData();
  } catch (e) {
    console.error('DB error:', e);
  }
  return <JaaroverzichtClient data={data} />;
}
