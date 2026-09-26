import JaaroverzichtClient from '../JaaroverzichtClient';
import { getEnergieData } from '@/lib/db';

// Hervalideer elke 6 uur, zelfde reden als de hoofdpagina: data verandert maar
// één keer per nacht, dagelijks live opnieuw bevragen is onnodige Neon-belasting.
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
