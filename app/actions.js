'use server';

import { neon } from '@neondatabase/serverless';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { sessieTokenOk, SESSIE_COOKIE } from '@/lib/auth';

// Elke actie is een openbaar POST-eindpunt, dus controleert zelf de sessie (de proxy doet dat ook, dit is de tweede slot).
async function vereisInlog() {
  const token = (await cookies()).get(SESSIE_COOKIE)?.value;
  if (!(await sessieTokenOk(token))) throw new Error('Niet ingelogd');
}

// Server action: zet "laden uit net" aan/uit. Draait server-side (geen secret in de client nodig).
export async function setLaadVanNet(aan) {
  await vereisInlog();
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
  await vereisInlog();
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
  await vereisInlog();
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

// Server action: stelt de verkoop-bodem in (RESERVE_SOC in ess_logic.js, standaard 25%). Lager tijdens
// bv. vakantie: minder huisverbruik nodig als nachtbuffer, dus mag verder doorverkopen. Geklemd 10-40
// (zelfde grenzen als de UI-slider en de fallback in ess_logic.js) zodat een rare waarde nooit doorkomt.
export async function setReserveSoc(pct) {
  await vereisInlog();
  const sql = neon(process.env.DATABASE_URL);
  const v = Math.max(10, Math.min(40, Math.round(Number(pct)) || 25));
  await sql`
    INSERT INTO instellingen (sleutel, waarde, bijgewerkt)
    VALUES ('reserve_soc', ${String(v)}, NOW())
    ON CONFLICT (sleutel) DO UPDATE SET
      waarde = EXCLUDED.waarde, bijgewerkt = EXCLUDED.bijgewerkt
  `;
  revalidatePath('/ess');
  return v;
}

// Server action: slaat een tijdschema op voor één van de drie knoppen. Het schema kan de
// knop alleen tijdelijk AANzetten binnen [start, end) -- buiten dat venster geldt de
// handmatige stand gewoon (zie lib/schedule.js voor de logica die dit toepast).
const SCHEMA_SLEUTELS = ['laad_van_net', 'keep_charged', 'verkoop_pauze'];
export async function setSchedule(key, { enabled, start, end }) {
  await vereisInlog();
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
