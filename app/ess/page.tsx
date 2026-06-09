import EssClient from '../EssClient';
import { neon } from '@neondatabase/serverless';

// Vers genoeg om de live-sturing te volgen, maar niet elke load een query.
export const revalidate = 60;

export default async function EssPage() {
  let status: any = {};
  let forecast: any[] = [];
  let bijgewerkt: string | null = null;
  let laadVanNet = false;
  let keepCharged = false;

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT status, forecast, bijgewerkt FROM ess_live WHERE id = 1`;
    if (rows[0]) {
      status = rows[0].status || {};
      forecast = rows[0].forecast || [];
      bijgewerkt = rows[0].bijgewerkt as any;
    }
    const inst = await sql`SELECT sleutel, waarde FROM instellingen WHERE sleutel IN ('laad_van_net', 'keep_charged')`;
    const m: any = {};
    inst.forEach((r: any) => { m[r.sleutel] = r.waarde; });
    laadVanNet = m['laad_van_net'] === 'true';
    keepCharged = m['keep_charged'] === 'true';
  } catch (e) {
    console.error('ESS live DB error:', e);
  }

  return <EssClient status={status} forecast={forecast} bijgewerkt={bijgewerkt} laadVanNet={laadVanNet} keepCharged={keepCharged} />;
}
