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

// Server action: zet "accu altijd vol houden" aan/uit.
export async function setKeepCharged(aan) {
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES ('keep_charged', ${aan ? 'true' : 'false'}, NOW())
    ON CONFLICT (sleutel) DO UPDATE SET
      waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
  `;
  revalidatePath('/ess');
  return aan;
}

// Server action: pauzeert alleen VERKOPEN (verder alles normaal, geen geforceerd laden).
export async function setVerkoopPauze(aan) {
  const sql = neon(process.env.DATABASE_URL);
  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES ('verkoop_pauze', ${aan ? 'true' : 'false'}, NOW())
    ON CONFLICT (sleutel) DO UPDATE SET
      waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
  `;
  revalidatePath('/ess');
  return aan;
}

// Server action: slaat een tijdschema op voor één van de drie knoppen. Het schema kan de
// knop alleen tijdelijk AANzetten binnen [start, end) -- buiten dat venster geldt de
// handmatige stand gewoon (zie lib/schedule.js voor de logica die dit toepast).
const SCHEMA_SLEUTELS = ['laad_van_net', 'keep_charged', 'verkoop_pauze'];
export async function setSchedule(key, { enabled, start, end }) {
  if (!SCHEMA_SLEUTELS.includes(key)) throw new Error('Onbekende schema-sleutel: ' + key);
  const sql = neon(process.env.DATABASE_URL);
  const config = JSON.stringify({ enabled: !!enabled, start: start || '12:00', end: end || '18:00' });
  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES (${key + '_schedule'}, ${config}, NOW())
    ON CONFLICT (sleutel) DO UPDATE SET
      waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
  `;
  revalidatePath('/ess');
  return { enabled: !!enabled, start: start || '12:00', end: end || '18:00' };
}
