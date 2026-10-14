import { neon } from '@neondatabase/serverless';
import { unstable_cache } from 'next/cache';

// De ruwe knopstanden uit Neon (handmatige stand, schema's, slider, push-token), gecachet onder de tag 'knoppen'.
// Node-RED haalt /api/laadvannet elke minuut op; zonder cache zou dat Neon non-stop wakker houden (zie CLAUDE.md,
// "Neon compute-uren opgebrand"). Met de cache gaat er alleen een query naar Neon als er iets verandert: de
// server actions roepen updateTag('knoppen') aan (direct vers bij de volgende poll), en daarnaast ververst de cache
// elk uur vanzelf. Het EFFECTIEVE resultaat (schema's t.o.v. de klok van dit moment) rekent de route per aanvraag
// uit, dus een schema gaat op de juiste minuut aan/uit zonder dat de cache verloopt.
// Een DB-fout gooit hier door en wordt dus NIET gecachet; de route vangt hem op (zoals eerder).
export const KNOPPEN_TAG = 'knoppen';

const SLEUTELS = [
  'laad_van_net', 'keep_charged', 'verkoop_pauze', 'reserve_soc',
  'laad_van_net_schedule', 'keep_charged_schedule', 'verkoop_pauze_schedule', 'push_nu',
];

export const leesKnoppenRuw = unstable_cache(
  async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL niet ingesteld');
    if (process.env.KNOPPEN_LOG) console.log('KNOPPEN: query naar Neon');   // alleen voor diagnose/test: telt de echte DB-aanroepen
    const sql = neon(url);
    const rows = await sql`SELECT sleutel, waarde FROM instellingen WHERE sleutel = ANY(${SLEUTELS})`;
    const m = {};
    rows.forEach(r => { m[r.sleutel] = r.waarde; });
    return m;
  },
  ['knoppen-ruw'],
  { tags: [KNOPPEN_TAG], revalidate: 3600 }
);
