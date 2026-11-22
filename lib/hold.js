// Samenvatting van de balans-hold voor de Live-pagina (kaart "Hold op de top"). Zuivere functie, met node te testen.
// De getallen zijn dezelfde als in ess_logic.js (v2.18): CEL_PACK_HERSTELD 0,010 V per pack, CEL_VERSCHIL_HERSTELD 0,030 V over alle cellen als terugval,
// BALANS_TOP_MIN_MS 2 uur op de top, BALANS_HOLD_MAX_MS 4 uur plafond. Wijzigen die daar, pas ze dan ook hier aan.
import { normaliseerCellen } from './cellen.js';

export const HOLD = { PACK_GRENS_MV: 10, SYSTEEM_GRENS_MV: 30, TOP_MIN_MINUTEN: 120, MAX_MINUTEN: 240 };

// status = ess_live.status (met .dbg), cellenRuw = ess_live.cellen, bijgewerktIso = tijdstip van de push.
// Geeft null als er geen hold is (en ook niet net afgerond).
export function holdSamenvatting(status, cellenRuw, bijgewerktIso) {
  const d = (status && status.dbg) || {};
  const actief = d.balansHoldActief === true;
  const klaar = !actief && d.holdKlaar === true;
  if (!actief && !klaar) return null;

  const topMin = Number.isFinite(d.topMinuten) ? d.topMinuten : null;
  const cellen = normaliseerCellen(cellenRuw);
  const diffs = Array.isArray(d.packDiffMv) ? d.packDiffMv : null;

  // Per pack (alleen als de sturing de celdata per pack gebruikt): verschil binnen het pack in mV
  let packs = null;
  if (d.packsBruikbaar === true && diffs && diffs.length) {
    packs = diffs.map((mv, i) => ({
      naam: (cellen && cellen.packs[i] && cellen.packs[i].pack) || String(i).padStart(2, '0'),
      mv: Number.isFinite(mv) ? mv : null,
      goed: Number.isFinite(mv) && mv <= HOLD.PACK_GRENS_MV,
      balancing: cellen && cellen.packs[i] ? cellen.packs[i].balancing : null,
    }));
  }
  const systeemMv = Number.isFinite(d.celVerschil) ? Math.round(d.celVerschil * 1000) : null;

  // Uiterlijk-tijd: de hold begon ongeveer toen de top begon (topMinuten geleden, gerekend vanaf de push)
  const pushMs = bijgewerktIso ? Date.parse(bijgewerktIso) : NaN;
  const uiterlijkMs = actief && topMin != null && Number.isFinite(pushMs) ? pushMs - topMin * 60000 + HOLD.MAX_MINUTEN * 60000 : null;

  return {
    actief,
    klaar,
    topMin,
    topNog: topMin == null ? null : Math.max(0, HOLD.TOP_MIN_MINUTEN - topMin),
    topVoldoende: topMin != null && topMin >= HOLD.TOP_MIN_MINUTEN,
    packs,
    systeemMv,
    allesGoed: packs ? packs.every(p => p.goed) : (systeemMv != null && systeemMv < HOLD.SYSTEEM_GRENS_MV),
    uiterlijkMs,
    piekVrij: d.pieksVrij === true,
  };
}
