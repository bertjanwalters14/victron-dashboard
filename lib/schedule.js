// Tijdschema-logica voor de drie ESS-knoppen (laad_van_net, keep_charged, verkoop_pauze).
// Een schema kan alleen de knop tijdelijk AANzetten binnen [start, end) (Europe/Amsterdam);
// buiten dat venster geldt gewoon de handmatige stand. Zo blijft de handknop de basis,
// en is het schema een "boost"-venster erboven, niet een vervanging.

export function parseSchedule(raw) {
  if (!raw) return { enabled: false, start: '12:00', end: '18:00' };
  try {
    const s = JSON.parse(raw);
    return {
      enabled: !!s.enabled,
      start: /^\d{2}:\d{2}$/.test(s.start) ? s.start : '12:00',
      end: /^\d{2}:\d{2}$/.test(s.end) ? s.end : '18:00',
    };
  } catch {
    return { enabled: false, start: '12:00', end: '18:00' };
  }
}

function nuHHMM() {
  return new Date().toLocaleTimeString('nl-NL', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function isScheduleActive(schedule) {
  if (!schedule || !schedule.enabled) return false;
  const nu = nuHHMM();
  if (schedule.start <= schedule.end) return nu >= schedule.start && nu < schedule.end;
  return nu >= schedule.start || nu < schedule.end;   // schema loopt over midnacht (bv. 22:00-06:00)
}

export function effectiveState(manual, schedule) {
  return isScheduleActive(schedule) || !!manual;
}
