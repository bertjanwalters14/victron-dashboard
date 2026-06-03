'use server';

import { neon } from '@neondatabase/serverless';
import { revalidatePath } from 'next/cache';

// Server action: zet "laden uit net" aan/uit. Draait server-side (geen secret in de client nodig).
export async function setLaadVanNet(aan) {
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES ('laad_van_net', ${aan ? 'true' : 'false'}, NOW())
    ON CONFLICT (sleutel) DO UPDATE SET
      waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
  `;
  revalidatePath('/ess');
  return aan;
}
