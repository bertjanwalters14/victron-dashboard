import EssClient from '../EssClient';
import { neon } from '@neondatabase/serverless';
import { parseSchedule } from '@/lib/schedule';

// Altijd vers renderen: elke refresh leest direct de laatste stand uit de DB
// (voorkomt het "stale-while-revalidate"-effect waarbij je 2x moet verversen).
export const dynamic = 'force-dynamic';

export default async function EssPage() {
  let status: any = {};
  let forecast: any[] = [];
  let bijgewerkt: string | null = null;
  let laadVanNet = false;
  let keepCharged = false;
  let verkoopPauze = false;
  let laadVanNetSchedule = parseSchedule(null);
  let keepChargedSchedule = parseSchedule(null);
  let verkoopPauzeSchedule = parseSchedule(null);
  let reserveSoc = 25;

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT status, forecast, bijgewerkt FROM ess_live WHERE id = 1`;
    if (rows[0]) {
      status = rows[0].status || {};
      forecast = rows[0].forecast || [];
      bijgewerkt = rows[0].bijgewerkt as any;
    }
    const inst = await sql`SELECT sleutel, waarde FROM instellingen WHERE sleutel IN (
      'laad_van_net', 'keep_charged', 'verkoop_pauze', 'reserve_soc',
      'laad_van_net_schedule', 'keep_charged_schedule', 'verkoop_pauze_schedule'
    )`;
    const m: any = {};
    inst.forEach((r: any) => { m[r.sleutel] = r.waarde; });
    laadVanNet = m['laad_van_net'] === 'true';
    keepCharged = m['keep_charged'] === 'true';
    verkoopPauze = m['verkoop_pauze'] === 'true';
    laadVanNetSchedule = parseSchedule(m['laad_van_net_schedule']);
    keepChargedSchedule = parseSchedule(m['keep_charged_schedule']);
    verkoopPauzeSchedule = parseSchedule(m['verkoop_pauze_schedule']);
    const reserveSocRaw = Number(m['reserve_soc']);
    reserveSoc = (reserveSocRaw >= 10 && reserveSocRaw <= 40) ? reserveSocRaw : 25;
  } catch (e) {
    console.error('ESS live DB error:', e);
  }

  return <EssClient
    status={status} forecast={forecast} bijgewerkt={bijgewerkt}
    laadVanNet={laadVanNet} keepCharged={keepCharged} verkoopPauze={verkoopPauze}
    laadVanNetSchedule={laadVanNetSchedule} keepChargedSchedule={keepChargedSchedule} verkoopPauzeSchedule={verkoopPauzeSchedule}
    reserveSoc={reserveSoc}
  />;
}
