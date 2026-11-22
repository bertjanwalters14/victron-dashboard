'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { vraagPush } from './actions';

// "Ververs nu": vraagt Node-RED om nu de status (en de celdata per pack) naar de app te pushen, en wacht tot die er is.
// Hoe het werkt: de server action zet een nieuw push-token; Node-RED haalt /api/laadvannet elke minuut op, ziet het nieuwe token, herberekent
// en pusht 4 seconden later. Dat duurt dus ongeveer een minuut (hooguit twee). We kijken elke 15 seconden of `bijgewerkt` is veranderd
// (niet de klokken vergelijken: die kunnen een paar seconden schelen) en roepen dan `naPush` aan om de nieuwe gegevens te tonen.
// Alleen op verzoek, dus Neon wordt alleen wakker als jij op de knop drukt.
export function useVerversNu(naPush) {
  const [fase, setFase] = useState('rust');   // 'rust' | 'wacht' | 'klaar' | 'mislukt'
  const lopend = useRef(0);
  const actueel = useRef(naPush);
  useEffect(() => { actueel.current = naPush; }, [naPush]);
  useEffect(() => () => { lopend.current = -1; }, []);   // bij weggaan van de pagina stoppen met wachten

  const leesBijgewerkt = async () => {
    const j = await (await fetch('/api/ess-status')).json();
    return j && j.bijgewerkt ? String(j.bijgewerkt) : null;
  };

  const vraag = useCallback(async () => {
    const id = Date.now();
    lopend.current = id;
    setFase('wacht');
    let basis = null;
    try { basis = await leesBijgewerkt(); } catch { /* zonder basis: elke wijziging telt */ }
    try { await vraagPush(); } catch { if (lopend.current === id) setFase('mislukt'); return; }
    for (let i = 0; i < 12; i++) {   // elke 15 s, tot 3 minuten
      await new Promise(r => setTimeout(r, 15000));
      if (lopend.current !== id) return;
      try {
        const nu = await leesBijgewerkt();
        if (nu && nu !== basis) {
          await actueel.current();
          if (lopend.current === id) { setFase('klaar'); setTimeout(() => { if (lopend.current === id) setFase('rust'); }, 5000); }
          return;
        }
      } catch { /* volgende ronde */ }
    }
    if (lopend.current === id) setFase('mislukt');
  }, []);

  return { fase, vraag };
}

export const VERVERS_TEKST = {
  rust: 'Ververs nu',
  wacht: 'Wacht op de Cerbo… (ca. 1 min)',
  klaar: 'Bijgewerkt',
  mislukt: 'Geen antwoord, probeer opnieuw',
};
