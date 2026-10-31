import MachinesClient from '../MachinesClient';
import { neon } from '@neondatabase/serverless';

// Altijd vers: de pagina leest alleen de laatste forecast (prijs + zon per uur) die Node-RED naar Neon pusht.
// Eén query per bezoek; dat is hetzelfde als de Live-pagina en houdt Neon niet wakker tussen bezoeken.
export const dynamic = 'force-dynamic';

export default async function MachinesPage() {
  let forecast: any[] = [];
  let bijgewerkt: string | null = null;
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT forecast, bijgewerkt FROM ess_live WHERE id = 1`;
    if (rows[0]) {
      forecast = rows[0].forecast || [];
      bijgewerkt = rows[0].bijgewerkt ? new Date(rows[0].bijgewerkt as any).toISOString() : null;
    }
  } catch (e) {
    console.error('DB error (machines):', e);
  }
  return <MachinesClient forecast={forecast} bijgewerkt={bijgewerkt} />;
}
